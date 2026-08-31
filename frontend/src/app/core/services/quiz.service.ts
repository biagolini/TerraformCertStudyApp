import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Question, correctLetters as questionCorrectLetters } from '../models/question.model';
import { Pack } from '../models/pack.model';
import { QuizAttempt, QuizAttemptAnswer } from '../models/quiz-attempt.model';
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
  private readonly timeLimitReachedAtState = signal<number | null>(null);
  private readonly annotationsState = signal<Record<string, QuestionAnnotations>>({});
  private readonly timeSpentState = signal<Record<string, number>>({});
  private readonly reviewFlagsState = signal<Record<string, boolean>>({});
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private activePackAtStart: Pack | null = null;

  readonly settings = this.settingsState.asReadonly();
  readonly questions = this.questionsState.asReadonly();
  readonly phase = this.phaseState.asReadonly();
  readonly lastAttempt = this.lastAttemptState.asReadonly();
  readonly timeLimitReachedAt = this.timeLimitReachedAtState.asReadonly();

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
    const settings = this.settingsState();
    if (!settings.trackTime || !hasTimerConfig(this.timerPack())) return null;

    if (settings.mode === 'instant') {
      const remainingSeconds = this.perQuestionSeconds() - (Date.now() - this.questionStartedAtState()) / 1000;
      return { remainingSeconds, overtime: remainingSeconds < 0 };
    }
    const remainingSeconds = this.totalSeconds() - (Date.now() - this.startedAt) / 1000;
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
  }

  /** Grades the current question immediately (instant-feedback mode). */
  checkAnswer(): void {
    const q = this.currentQuestion();
    if (!q) return;
    const answer = this.currentAnswer();
    if (answer.selected.length === 0 || answer.checked) return;
    const score = scoreAnswer(questionCorrectLetters(q), answer.selected, this.allowsPartialCredit());
    this.setAnswer(q.id, { ...answer, checked: true, correct: score === 1, score });
  }

  next(): void {
    this.flushTimeSpent();
    this.currentIndexState.update((i) => Math.min(i + 1, this.questionsState().length - 1));
    this.questionStartedAtState.set(Date.now());
  }

  previous(): void {
    this.flushTimeSpent();
    this.currentIndexState.update((i) => Math.max(i - 1, 0));
    this.questionStartedAtState.set(Date.now());
  }

  goTo(index: number): void {
    if (index < 0 || index >= this.questionsState().length) return;
    this.flushTimeSpent();
    this.currentIndexState.set(index);
    this.questionStartedAtState.set(Date.now());
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

    const attempt = this.buildAttempt(graded, partialCredit);
    this.lastAttemptState.set(attempt);
    this.phaseState.set('results');

    void this.attemptsService.save(attempt).then((ok) => {
      if (!ok) console.error('[QuizService] Failed to save quiz attempt — it will not appear in History.');
    });
  }

  viewHistory(): void {
    this.phaseState.set('history');
  }

  reset(): void {
    this.clearTicker();
    this.questionsState.set([]);
    this.answersState.set({});
    this.currentIndexState.set(0);
    this.lastAttemptState.set(null);
    this.timeLimitReachedAtState.set(null);
    this.annotationsState.set({});
    this.timeSpentState.set({});
    this.reviewFlagsState.set({});
    this.phaseState.set('setup');
  }

  private flushTimeSpent(): void {
    const q = this.currentQuestion();
    if (!q) return;
    const elapsed = (Date.now() - this.questionStartedAtState()) / 1000;
    if (elapsed <= 0) return;
    this.timeSpentState.update((prev) => ({ ...prev, [q.id]: (prev[q.id] ?? 0) + elapsed }));
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

  private buildAttempt(answers: Record<string, QuizAnswer>, partialCredit: boolean): QuizAttempt {
    const pack = this.activePackAtStart ?? this.packs.activePack();
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
      id: crypto.randomUUID(),
      examSlug: slugify(pack.name) || 'exam',
      examName: pack.name,
      scope: this.settingsState().scope,
      mode: this.settingsState().mode,
      partialCredit,
      answers: answerRecords,
      totalScore,
      maxScore,
      scorePercent,
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      timeLimitReachedAt: this.timeLimitReachedAtState() ?? undefined,
    };
  }

  private setAnswer(questionId: string, answer: QuizAnswer): void {
    this.answersState.update((prev) => ({ ...prev, [questionId]: answer }));
  }
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
