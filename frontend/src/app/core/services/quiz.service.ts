import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Question, correctLetters as questionCorrectLetters } from '../models/question.model';
import { Pack } from '../models/pack.model';
import { QuizAttempt, QuizAttemptAnswer, QuizAttemptStatus } from '../models/quiz-attempt.model';
import { DEFAULT_QUIZ_SETTINGS, QuizAnswer, QuizPhase, QuizScope, QuizSettings } from '../models/quiz.model';
import { slugify } from '../utils/file-splitter.util';
import { TextRange, toggleRanges } from '../utils/text-range.util';
import { PacksService } from './packs.service';
import { QuestionsService } from './questions.service';
import { QuizAttemptsService } from './quiz-attempts.service';

interface ScopePools {
  examPacks: Pack[];
  counts: Record<QuizScope, number>;
  questions: Record<QuizScope, Question[]>;
}

export interface QuizClock {
  remainingSeconds: number;
  overtime: boolean;
}

export interface QuestionAnnotations {
  /** Keyed by block id: `'stem'` or an alternative's letter. */
  highlights: Partial<Record<string, TextRange[]>>;
  strikethroughs: Partial<Record<string, TextRange[]>>;
  note: string;
}

const EMPTY_ANSWER: QuizAnswer = { selected: [], checked: false, correct: false, score: 0 };
const EMPTY_ANNOTATIONS: QuestionAnnotations = { highlights: {}, strikethroughs: {}, note: '' };

/** Exact match -> 1/0. Under partial credit, a multi-select question scores the
 * fraction of required correct letters actually selected (never > 1). Single-answer
 * questions always score 0 or 1 either way. */
export function scoreAnswer(correct: string[], selected: string[], partialCredit: boolean): number {
  if (selected.length === 0 || correct.length === 0) return 0;
  const exact = sameSet(selected, correct);
  if (!partialCredit) return exact ? 1 : 0;
  const correctSet = new Set(correct);
  const hits = selected.filter((l) => correctSet.has(l)).length;
  return Math.min(1, hits / correct.length);
}

/** Whether a pack has enough info configured to run the exam clock. */
export function hasTimerConfig(pack: Pack): boolean {
  return !!(pack.examTotalQuestions && pack.examDurationMinutes);
}

/** Formats seconds as `M:SS` — minutes are NOT zero-padded or capped (e.g. `208:35`). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Re-scores an attempt as if it had ended the moment the time limit was reached:
 * any answer last touched AFTER that moment is treated as wrong/unanswered. This is
 * an approximation — only the latest selection per question is stored, not a full
 * change history, so an answer touched both before and after the buzzer can't be
 * split into "what it was at the buzzer" vs. "what it became after". */
export function attemptScoreAtTimeLimit(
  attempt: QuizAttempt,
): { totalScore: number; maxScore: number; scorePercent: number } | null {
  if (!attempt.timeLimitReachedAt) return null;
  const cutoff = attempt.timeLimitReachedAt;
  const totalScore = attempt.answers.reduce((sum, a) => {
    const disqualified = a.answeredAt !== undefined && a.answeredAt > cutoff;
    return sum + (disqualified ? 0 : a.score);
  }, 0);
  const maxScore = attempt.maxScore;
  const scorePercent = maxScore === 0 ? 0 : Math.round((totalScore / maxScore) * 10000) / 100;
  return { totalScore, maxScore, scorePercent };
}

@Injectable({ providedIn: 'root' })
export class QuizService {
  private readonly packs = inject(PacksService);
  private readonly questionsService = inject(QuestionsService);
  private readonly attemptsService = inject(QuizAttemptsService);

  private readonly settingsState = signal<QuizSettings>({ ...DEFAULT_QUIZ_SETTINGS, domains: [] });
  private readonly questionsState = signal<Question[]>([]);
  private readonly answersState = signal<Record<string, QuizAnswer>>({});
  private readonly currentIndexState = signal(0);
  private readonly phaseState = signal<QuizPhase>('setup');
  private readonly lastAttemptState = signal<QuizAttempt | null>(null);
  private readonly tickState = signal(0);
  private readonly questionStartedAtState = signal(0);
  private readonly questionCheckedAtState = signal<number | null>(null);
  private readonly timeLimitReachedAtState = signal<number | null>(null);
  private readonly pausedState = signal(false);
  private pausedAt: number | null = null;
  private accumulatedPausedMs = 0;
  /** Snapshot of `accumulatedPausedMs` taken whenever `questionStartedAtState` resets —
   * lets flushTimeSpent()/clock exclude only the pause time that happened DURING the
   * current question, not pauses from earlier questions in the same attempt. */
  private questionStartedPausedMs = 0;
  private readonly annotationsState = signal<Record<string, QuestionAnnotations>>({});
  private readonly timeSpentState = signal<Record<string, number>>({});
  private readonly reviewFlagsState = signal<Record<string, boolean>>({});
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private activePackAtStart: Pack | null = null;
  /** Stable across the whole session (set once at start()/resume()) so every
   * in-progress sync and the final finish() save overwrite the same DynamoDB item. */
  private attemptId = '';
  private annotationSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly ANNOTATION_SYNC_DEBOUNCE_MS = 3000;

  readonly settings = this.settingsState.asReadonly();
  readonly questions = this.questionsState.asReadonly();
  readonly phase = this.phaseState.asReadonly();
  readonly lastAttempt = this.lastAttemptState.asReadonly();
  readonly timeLimitReachedAt = this.timeLimitReachedAtState.asReadonly();
  readonly paused = this.pausedState.asReadonly();

  /** Whether the ACTIVE pack (before a quiz starts) has timer config — drives the Quiz Setup toggles. */
  readonly timerAvailable = computed(() => hasTimerConfig(this.packs.activePack()));

  /** Total exam seconds (duration + accommodation, if used) for the pack the running/last-started quiz used. */
  readonly totalSeconds = computed(() => {
    const pack = this.timerPack();
    if (!hasTimerConfig(pack)) return 0;
    const minutes =
      (pack.examDurationMinutes ?? 0) + (this.settingsState().useAccommodation ? pack.accommodationMinutes ?? 0 : 0);
    return minutes * 60;
  });

  /** Per-question seconds, paced against the exam's OFFICIAL question count (not this session's). */
  readonly perQuestionSeconds = computed(() => {
    const pack = this.timerPack();
    if (!hasTimerConfig(pack) || !pack.examTotalQuestions) return 0;
    return this.totalSeconds() / pack.examTotalQuestions;
  });

  /** Live clock: per-question countdown in instant mode, whole-attempt countdown in exam mode.
   * Ticks every second; null when time tracking is off or the pack has no timer config. */
  readonly clock = computed<QuizClock | null>(() => {
    this.tickState();
    this.pausedState();
    const settings = this.settingsState();
    if (!settings.trackTime || !hasTimerConfig(this.timerPack())) return null;

    const pausedMs = this.currentPausedMs();

    if (settings.mode === 'instant') {
      // Frozen the instant checkAnswer() is called, so reading the explanation
      // afterward doesn't keep draining the per-question countdown.
      const checkedAt = this.questionCheckedAtState();
      const reference = checkedAt ?? Date.now();
      const pausedDuringQuestion = pausedMs - this.questionStartedPausedMs;
      const remainingSeconds =
        this.perQuestionSeconds() - (reference - this.questionStartedAtState() - pausedDuringQuestion) / 1000;
      return { remainingSeconds, overtime: remainingSeconds < 0 };
    }
    const remainingSeconds = this.totalSeconds() - (Date.now() - this.startedAt - pausedMs) / 1000;
    return { remainingSeconds, overtime: remainingSeconds < 0 };
  });

  constructor() {
    // Robustly captures the moment the exam-wide clock hits zero, exactly once,
    // regardless of whether the UI happens to be showing the time's-up dialog.
    effect(() => {
      const c = this.clock();
      if (
        c?.overtime &&
        this.settingsState().mode === 'exam' &&
        this.phaseState() === 'running' &&
        this.timeLimitReachedAtState() === null
      ) {
        this.timeLimitReachedAtState.set(Date.now());
      }
    });
  }

  /** Per-scope question pools, derived once from the packs/questions the app already loaded. */
  readonly scopePools = computed<ScopePools>(() => {
    const all = this.questionsService.allQuestions();
    const packs = this.packs.packs();
    const active = this.packs.activePack();
    const examName = active.name.trim().toLowerCase();
    const examPacks = packs.filter((p) => p.name.trim().toLowerCase() === examName);
    const examPackIds = new Set(examPacks.map((p) => p.id));

    const questions: Record<QuizScope, Question[]> = {
      pack: all.filter((q) => q.packId === active.id),
      exam: all.filter((q) => examPackIds.has(q.packId)),
      all,
    };

    return {
      examPacks,
      counts: { pack: questions.pack.length, exam: questions.exam.length, all: questions.all.length },
      questions,
    };
  });

  domainsForScope(scope: QuizScope): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const q of this.scopePools().questions[scope]) {
      counts.set(q.domain, (counts.get(q.domain) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }

  readonly currentIndex = this.currentIndexState.asReadonly();

  readonly currentQuestion = computed<Question | null>(
    () => this.questionsState()[this.currentIndexState()] ?? null,
  );

  readonly currentAnswer = computed<QuizAnswer>(() => {
    const q = this.currentQuestion();
    if (!q) return EMPTY_ANSWER;
    return this.answersState()[q.id] ?? EMPTY_ANSWER;
  });

  readonly isMultiSelect = computed(() => questionCorrectLetters(this.currentQuestion() ?? { alternatives: [] }).length > 1);

  readonly progress = computed(() => ({
    index: this.currentIndexState(),
    total: this.questionsState().length,
  }));

  readonly currentAnnotations = computed<QuestionAnnotations>(() => {
    const q = this.currentQuestion();
    if (!q) return EMPTY_ANNOTATIONS;
    return this.annotationsState()[q.id] ?? EMPTY_ANNOTATIONS;
  });

  /** Whether the current question has any highlight/strikethrough mark at all —
   * drives disabling the "Clear marks" toolbar button when there's nothing to clear. */
  readonly hasCurrentMarks = computed(() => {
    const ann = this.currentAnnotations();
    return Object.values(ann.highlights).some((r) => r && r.length > 0) ||
      Object.values(ann.strikethroughs).some((r) => r && r.length > 0);
  });

  readonly answeredFlags = computed(() =>
    this.questionsState().map((q) => (this.answersState()[q.id]?.selected.length ?? 0) > 0),
  );

  readonly reviewFlags = computed(() => {
    const flags = this.reviewFlagsState();
    return this.questionsState().map((q) => flags[q.id] ?? false);
  });

  readonly isCurrentFlagged = computed(() => {
    const q = this.currentQuestion();
    return q ? (this.reviewFlagsState()[q.id] ?? false) : false;
  });

  readonly flaggedCount = computed(() => this.reviewFlags().filter(Boolean).length);

  /** `correct` is the sum of each checked answer's score — fractional under partial credit. */
  readonly score = computed(() => {
    const checked = Object.values(this.answersState()).filter((a) => a.checked);
    return {
      correct: checked.reduce((sum, a) => sum + a.score, 0),
      answered: checked.length,
      total: this.questionsState().length,
    };
  });

  /** Per-domain breakdown; `correct` sums score (fractional under partial credit).
   * `timeSeconds` sums time-spent — lets Results/History surface "which domain is slow",
   * not just "which domain is weak". Time-spent tracking runs regardless of the
   * optional exam-clock feature. */
  readonly domainBreakdown = computed(() => {
    const answers = this.answersState();
    const times = this.timeSpentState();
    const byDomain = new Map<string, { correct: number; total: number; timeSeconds: number }>();
    for (const q of this.questionsState()) {
      const entry = byDomain.get(q.domain) ?? { correct: 0, total: 0, timeSeconds: 0 };
      entry.total += 1;
      entry.correct += answers[q.id]?.score ?? 0;
      entry.timeSeconds += times[q.id] ?? 0;
      byDomain.set(q.domain, entry);
    }
    return [...byDomain.entries()].map(([domain, v]) => ({ domain, ...v }));
  });

  readonly answerByQuestionId = computed(() => this.answersState());

  start(settings: QuizSettings): void {
    const pool = this.scopePools().questions[settings.scope];
    const filtered =
      settings.domains.length === 0 ? pool : pool.filter((q) => settings.domains.includes(q.domain));
    const ordered = settings.shuffle ? shuffle(filtered) : filtered;
    const selected = ordered.slice(0, Math.max(1, Math.min(settings.count, ordered.length)));

    this.attemptId = crypto.randomUUID();
    this.settingsState.set(settings);
    this.questionsState.set(selected);
    this.currentIndexState.set(0);
    this.answersState.set({});
    this.lastAttemptState.set(null);
    this.timeLimitReachedAtState.set(null);
    this.annotationsState.set({});
    this.timeSpentState.set({});
    this.reviewFlagsState.set({});
    this.startedAt = Date.now();
    this.questionStartedAtState.set(this.startedAt);
    this.questionCheckedAtState.set(null);
    this.pausedState.set(false);
    this.pausedAt = null;
    this.accumulatedPausedMs = 0;
    this.questionStartedPausedMs = 0;
    this.activePackAtStart = this.packs.activePack();

    this.clearTicker();
    if (settings.trackTime) {
      this.tickInterval = setInterval(() => this.tickState.update((t) => t + 1), 1000);
    }

    this.phaseState.set(selected.length > 0 ? 'running' : 'setup');
  }

  toggleOption(letter: string): void {
    const q = this.currentQuestion();
    if (!q) return;
    const existing = this.currentAnswer();
    if (existing.checked) return;

    let selected: string[];
    if (this.isMultiSelect()) {
      const set = new Set(existing.selected);
      if (set.has(letter)) set.delete(letter);
      else set.add(letter);
      selected = [...set];
    } else {
      selected = [letter];
    }
    this.setAnswer(q.id, { selected, checked: false, correct: false, score: 0, answeredAt: Date.now() });
    this.syncInProgress();
  }

  /** Grades the current question immediately (instant-feedback mode). */
  checkAnswer(): void {
    const q = this.currentQuestion();
    if (!q) return;
    const answer = this.currentAnswer();
    if (answer.selected.length === 0 || answer.checked) return;
    const score = scoreAnswer(questionCorrectLetters(q), answer.selected, this.allowsPartialCredit());
    this.setAnswer(q.id, { ...answer, checked: true, correct: score === 1, score });
    this.questionCheckedAtState.set(Date.now());
    this.syncInProgress();
  }

  next(): void {
    this.flushTimeSpent();
    this.currentIndexState.update((i) => Math.min(i + 1, this.questionsState().length - 1));
    this.beginQuestionTiming();
    this.syncInProgress();
  }

  previous(): void {
    this.flushTimeSpent();
    this.currentIndexState.update((i) => Math.max(i - 1, 0));
    this.beginQuestionTiming();
    this.syncInProgress();
  }

  goTo(index: number): void {
    if (index < 0 || index >= this.questionsState().length) return;
    this.flushTimeSpent();
    this.currentIndexState.set(index);
    this.beginQuestionTiming();
    this.syncInProgress();
  }

  /** Pauses the running clock — accumulated elapsed/remaining time is frozen until
   * unpause(), rather than just stopping the display tick (which alone would leave
   * the underlying wall-clock math to silently balloon and jump on resume). */
  pause(): void {
    if (this.pausedState() || this.phaseState() !== 'running') return;
    this.pausedState.set(true);
    this.pausedAt = Date.now();
    this.clearTicker();
  }

  unpause(): void {
    if (!this.pausedState()) return;
    this.accumulatedPausedMs += Date.now() - (this.pausedAt ?? Date.now());
    this.pausedAt = null;
    this.pausedState.set(false);
    if (this.settingsState().trackTime) {
      this.tickInterval = setInterval(() => this.tickState.update((t) => t + 1), 1000);
    }
  }

  /** Toggles a highlight/strikethrough range for the current question's block
   * (`'stem'` or an alternative's letter) — see text-range.util.ts for the rule. */
  toggleAnnotation(kind: 'highlight' | 'strike', blockId: string, range: TextRange): void {
    const q = this.currentQuestion();
    if (!q) return;
    const current = this.annotationsState()[q.id] ?? EMPTY_ANNOTATIONS;
    const key: 'highlights' | 'strikethroughs' = kind === 'highlight' ? 'highlights' : 'strikethroughs';
    const updatedForBlock = toggleRanges(current[key][blockId] ?? [], range);
    const updated: QuestionAnnotations = { ...current, [key]: { ...current[key], [blockId]: updatedForBlock } };
    this.annotationsState.update((prev) => ({ ...prev, [q.id]: updated }));
    this.scheduleAnnotationSync();
  }

  /** Removes every highlight/strikethrough mark from the current question in one
   * shot — the escape hatch for when reselecting the exact original range to
   * toggle a mark off (see toggleRanges' full-coverage rule) is too fiddly,
   * especially on touch. Leaves the note text untouched. */
  clearAnnotations(): void {
    const q = this.currentQuestion();
    if (!q) return;
    const current = this.annotationsState()[q.id] ?? EMPTY_ANNOTATIONS;
    this.annotationsState.update((prev) => ({
      ...prev,
      [q.id]: { ...current, highlights: {}, strikethroughs: {} },
    }));
    this.scheduleAnnotationSync();
  }

  toggleReviewFlag(): void {
    const q = this.currentQuestion();
    if (!q) return;
    this.reviewFlagsState.update((prev) => ({ ...prev, [q.id]: !(prev[q.id] ?? false) }));
  }

  setNote(text: string): void {
    const q = this.currentQuestion();
    if (!q) return;
    const current = this.annotationsState()[q.id] ?? EMPTY_ANNOTATIONS;
    this.annotationsState.update((prev) => ({ ...prev, [q.id]: { ...current, note: text } }));
    this.scheduleAnnotationSync();
  }

  /** Grades every answered question, builds + persists the attempt, and moves to results. */
  finish(): void {
    this.flushTimeSpent();
    const partialCredit = this.allowsPartialCredit();
    const graded: Record<string, QuizAnswer> = {};
    for (const q of this.questionsState()) {
      const existing = this.answersState()[q.id] ?? EMPTY_ANSWER;
      const score = scoreAnswer(questionCorrectLetters(q), existing.selected, partialCredit);
      graded[q.id] = { ...existing, checked: true, correct: score === 1, score };
    }
    this.answersState.set(graded);
    this.clearTicker();
    this.cancelAnnotationDebounce();

    const attempt = this.snapshotAttempt('FINISHED');
    this.lastAttemptState.set(attempt);
    this.phaseState.set('results');

    void this.attemptsService.save(attempt).then((ok) => {
      if (!ok) console.error('[QuizService] Failed to save quiz attempt — it will not appear in History.');
    });
  }

  /** Restores an in-progress attempt exactly as it was left off, on this or another
   * device. Reuses the attempt's own id/examSlug/startedAt so every subsequent sync
   * and the eventual finish() overwrite the same DynamoDB item. */
  resume(attempt: QuizAttempt): void {
    this.clearTicker();
    this.cancelAnnotationDebounce();
    this.attemptId = attempt.id;
    this.settingsState.set(attempt.settings);

    const questions = attempt.answers.map(
      (a) => this.questionsService.getById(a.questionId) ?? synthesizeQuestionFromAnswer(a, attempt.packId),
    );
    this.questionsState.set(questions);

    const answers: Record<string, QuizAnswer> = {};
    const annotations: Record<string, QuestionAnnotations> = {};
    const times: Record<string, number> = {};
    const flags: Record<string, boolean> = {};
    for (const a of attempt.answers) {
      answers[a.questionId] = {
        selected: a.selected,
        checked: a.checked,
        correct: a.score === 1,
        score: a.score,
        answeredAt: a.answeredAt,
      };
      annotations[a.questionId] = { highlights: a.highlights, strikethroughs: a.strikethroughs, note: a.note };
      times[a.questionId] = a.timeSpentSeconds;
      flags[a.questionId] = a.markedForReview;
    }
    this.answersState.set(answers);
    this.annotationsState.set(annotations);
    this.timeSpentState.set(times);
    this.reviewFlagsState.set(flags);
    this.currentIndexState.set(Math.max(0, Math.min(attempt.currentIndex, questions.length - 1)));
    this.lastAttemptState.set(null);

    this.startedAt = attempt.startedAt;
    this.timeLimitReachedAtState.set(attempt.timeLimitReachedAt ?? null);
    // Deliberately NOT restored from the attempt — always reset to "now" so the
    // offline gap between sessions isn't wrongly counted as time on this question.
    // A resumed session never carries over a stale in-progress pause either.
    this.questionCheckedAtState.set(null);
    this.pausedState.set(false);
    this.pausedAt = null;
    this.accumulatedPausedMs = 0;
    this.questionStartedPausedMs = 0;
    this.questionStartedAtState.set(Date.now());

    this.activePackAtStart = resolveResumePack(this.packs.packs(), attempt);

    if (attempt.settings.trackTime) {
      this.tickInterval = setInterval(() => this.tickState.update((t) => t + 1), 1000);
    }
    this.phaseState.set(questions.length > 0 ? 'running' : 'setup');
  }

  viewHistory(): void {
    this.phaseState.set('history');
  }

  reset(): void {
    this.clearTicker();
    this.cancelAnnotationDebounce();
    this.questionsState.set([]);
    this.answersState.set({});
    this.currentIndexState.set(0);
    this.lastAttemptState.set(null);
    this.timeLimitReachedAtState.set(null);
    this.annotationsState.set({});
    this.timeSpentState.set({});
    this.reviewFlagsState.set({});
    this.questionCheckedAtState.set(null);
    this.pausedState.set(false);
    this.pausedAt = null;
    this.accumulatedPausedMs = 0;
    this.questionStartedPausedMs = 0;
    this.phaseState.set('setup');
  }

  private flushTimeSpent(): void {
    const q = this.currentQuestion();
    if (!q) return;
    const pausedDuringQuestion = this.currentPausedMs() - this.questionStartedPausedMs;
    const elapsed = (Date.now() - this.questionStartedAtState()) / 1000 - pausedDuringQuestion / 1000;
    if (elapsed <= 0) return;
    this.timeSpentState.update((prev) => ({ ...prev, [q.id]: (prev[q.id] ?? 0) + elapsed }));
  }

  /** Resets the per-question timing baseline (start time, checked-at freeze, and the
   * paused-ms snapshot flushTimeSpent()/clock diff against) — called whenever the
   * current question changes. */
  private beginQuestionTiming(): void {
    this.questionStartedAtState.set(Date.now());
    this.questionCheckedAtState.set(null);
    this.questionStartedPausedMs = this.currentPausedMs();
  }

  private currentPausedMs(): number {
    return this.accumulatedPausedMs + (this.pausedAt !== null ? Date.now() - this.pausedAt : 0);
  }

  private timerPack(): Pack {
    return this.activePackAtStart ?? this.packs.activePack();
  }

  private clearTicker(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private allowsPartialCredit(): boolean {
    return this.activePackAtStart?.allowPartialCredit ?? this.packs.activePack().allowPartialCredit ?? false;
  }

  /** Builds the full attempt blob from CURRENT state as-is (no forced grading) —
   * used both for eager/debounced in-progress syncs and, after finish() grades
   * every question, for the final save. Both cases overwrite the same DynamoDB
   * item, since `id`/`examSlug`/`startedAt` never change across a session. */
  private snapshotAttempt(status: QuizAttemptStatus): QuizAttempt {
    const pack = this.activePackAtStart ?? this.packs.activePack();
    const answers = this.answersState();
    const annotations = this.annotationsState();
    const times = this.timeSpentState();
    const flags = this.reviewFlagsState();
    const answerRecords: QuizAttemptAnswer[] = this.questionsState().map((q) => {
      const a = answers[q.id] ?? EMPTY_ANSWER;
      const ann = annotations[q.id] ?? EMPTY_ANNOTATIONS;
      return {
        questionId: q.id,
        title: q.title,
        domain: q.domain,
        selected: a.selected,
        correctLetters: questionCorrectLetters(q),
        score: a.score,
        answeredAt: a.answeredAt,
        checked: a.checked,
        stemSnapshot: q.stem,
        alternativesSnapshot: q.alternatives.map((alt) => ({ letter: alt.letter, text: alt.text })),
        highlights: ann.highlights,
        strikethroughs: ann.strikethroughs,
        note: ann.note,
        timeSpentSeconds: times[q.id] ?? 0,
        markedForReview: flags[q.id] ?? false,
      };
    });
    const totalScore = answerRecords.reduce((sum, a) => sum + a.score, 0);
    const maxScore = answerRecords.length;
    const scorePercent = maxScore === 0 ? 0 : Math.round((totalScore / maxScore) * 10000) / 100;

    return {
      id: this.attemptId,
      status,
      packId: pack.id,
      examSlug: slugify(pack.name) || 'exam',
      examName: pack.name,
      scope: this.settingsState().scope,
      mode: this.settingsState().mode,
      partialCredit: this.allowsPartialCredit(),
      settings: this.settingsState(),
      answers: answerRecords,
      currentIndex: this.currentIndexState(),
      totalScore,
      maxScore,
      scorePercent,
      startedAt: this.startedAt,
      finishedAt: status === 'FINISHED' ? Date.now() : undefined,
      timeLimitReachedAt: this.timeLimitReachedAtState() ?? undefined,
    };
  }

  /** Fire-and-forget: never awaited by callers, so navigation/answering always
   * returns immediately regardless of network state. Failures are swallowed and
   * logged inside StorageService, never surfaced here as a blocking error. */
  private syncInProgress(): void {
    if (this.phaseState() !== 'running') return;
    this.cancelAnnotationDebounce();
    void this.attemptsService.syncInProgress(this.snapshotAttempt('IN_PROGRESS'));
  }

  private scheduleAnnotationSync(): void {
    if (this.phaseState() !== 'running') return;
    if (this.annotationSyncTimer) clearTimeout(this.annotationSyncTimer);
    this.annotationSyncTimer = setTimeout(() => {
      this.annotationSyncTimer = null;
      void this.attemptsService.syncInProgress(this.snapshotAttempt('IN_PROGRESS'));
    }, QuizService.ANNOTATION_SYNC_DEBOUNCE_MS);
  }

  private cancelAnnotationDebounce(): void {
    if (this.annotationSyncTimer) {
      clearTimeout(this.annotationSyncTimer);
      this.annotationSyncTimer = null;
    }
  }

  private setAnswer(questionId: string, answer: QuizAnswer): void {
    this.answersState.update((prev) => ({ ...prev, [questionId]: answer }));
  }
}

/** Best-effort reconstruction of a `Question` for a resumed session when the live
 * question row is gone (deleted since the attempt was saved). Built purely from the
 * attempt's own frozen snapshot — no `comment`/rationale text was ever frozen into
 * `alternativesSnapshot`, so a resumed already-checked question loses its rationale
 * in this fallback path. Accepted, documented degradation for a rare edge case. */
export function synthesizeQuestionFromAnswer(a: QuizAttemptAnswer, packId: string): Question {
  return {
    id: a.questionId,
    packId,
    title: a.title,
    domain: a.domain,
    stem: a.stemSnapshot,
    alternatives: a.alternativesSnapshot.map((alt) => ({
      letter: alt.letter,
      text: alt.text,
      isCorrect: a.correctLetters.includes(alt.letter),
      comment: '',
    })),
    metadata: { topics: [], relatedServices: [] },
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Resolves the pack an in-progress attempt should use for exam-rule lookups
 * (timer config, partial credit). Tries the exact pack by id first (picks up any
 * edits made since the attempt was saved), then falls back to matching by exam
 * name for a deleted pack. NEVER falls back to the currently active pack — that
 * would silently apply an unrelated exam's timer rules to this resumed session.
 * When both lookups miss, returns a minimal stand-in carrying only the attempt's
 * own `partialCredit` flag and no timer fields, so `hasTimerConfig()` naturally
 * evaluates false rather than showing numbers from the wrong exam. */
export function resolveResumePack(packs: Pack[], attempt: Pick<QuizAttempt, 'packId' | 'examSlug' | 'examName' | 'partialCredit'>): Pack {
  const byId = packs.find((p) => p.id === attempt.packId);
  if (byId) return byId;
  const bySlug = packs.find((p) => slugify(p.name) === attempt.examSlug);
  if (bySlug) return bySlug;
  return {
    id: attempt.packId,
    name: attempt.examName,
    description: '',
    version: '',
    domains: [],
    color: '#7f8c9c',
    createdAt: 0,
    updatedAt: 0,
    allowPartialCredit: attempt.partialCredit,
  };
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((v) => setB.has(v));
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
