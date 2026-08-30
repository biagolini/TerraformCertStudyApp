import { Injectable, computed, inject, signal } from '@angular/core';
import { Question, correctLetters as questionCorrectLetters } from '../models/question.model';
import { Pack } from '../models/pack.model';
import { DEFAULT_QUIZ_SETTINGS, QuizAnswer, QuizPhase, QuizScope, QuizSettings } from '../models/quiz.model';
import { PacksService } from './packs.service';
import { QuestionsService } from './questions.service';

interface ScopePools {
  examPacks: Pack[];
  counts: Record<QuizScope, number>;
  questions: Record<QuizScope, Question[]>;
}

const SCOPES: QuizScope[] = ['pack', 'exam', 'all'];

@Injectable({ providedIn: 'root' })
export class QuizService {
  private readonly packs = inject(PacksService);
  private readonly questionsService = inject(QuestionsService);

  private readonly settingsState = signal<QuizSettings>({ ...DEFAULT_QUIZ_SETTINGS, domains: [] });
  private readonly questionsState = signal<Question[]>([]);
  private readonly answersState = signal<Record<string, QuizAnswer>>({});
  private readonly currentIndexState = signal(0);
  private readonly phaseState = signal<QuizPhase>('setup');

  readonly settings = this.settingsState.asReadonly();
  readonly questions = this.questionsState.asReadonly();
  readonly phase = this.phaseState.asReadonly();

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
    if (!q) return { selected: [], checked: false, correct: false };
    return this.answersState()[q.id] ?? { selected: [], checked: false, correct: false };
  });

  readonly isMultiSelect = computed(() => questionCorrectLetters(this.currentQuestion() ?? { alternatives: [] }).length > 1);

  readonly progress = computed(() => ({
    index: this.currentIndexState(),
    total: this.questionsState().length,
  }));

  readonly answeredFlags = computed(() =>
    this.questionsState().map((q) => (this.answersState()[q.id]?.selected.length ?? 0) > 0),
  );

  readonly score = computed(() => {
    const checked = Object.values(this.answersState()).filter((a) => a.checked);
    return {
      correct: checked.filter((a) => a.correct).length,
      answered: checked.length,
      total: this.questionsState().length,
    };
  });

  readonly domainBreakdown = computed(() => {
    const answers = this.answersState();
    const byDomain = new Map<string, { correct: number; total: number }>();
    for (const q of this.questionsState()) {
      const entry = byDomain.get(q.domain) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (answers[q.id]?.correct) entry.correct += 1;
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
    this.setAnswer(q.id, { selected, checked: false, correct: false });
  }

  /** Grades the current question immediately (instant-feedback mode). */
  checkAnswer(): void {
    const q = this.currentQuestion();
    if (!q) return;
    const answer = this.currentAnswer();
    if (answer.selected.length === 0 || answer.checked) return;
    const correct = sameSet(answer.selected, questionCorrectLetters(q));
    this.setAnswer(q.id, { ...answer, checked: true, correct });
  }

  next(): void {
    this.currentIndexState.update((i) => Math.min(i + 1, this.questionsState().length - 1));
  }

  previous(): void {
    this.currentIndexState.update((i) => Math.max(i - 1, 0));
  }

  goTo(index: number): void {
    if (index < 0 || index >= this.questionsState().length) return;
    this.currentIndexState.set(index);
  }

  /** Grades every answered question and moves to the results screen (exam-simulation mode). */
  finish(): void {
    const graded: Record<string, QuizAnswer> = {};
    for (const q of this.questionsState()) {
      const existing = this.answersState()[q.id] ?? { selected: [], checked: false, correct: false };
      const correct = existing.selected.length > 0 && sameSet(existing.selected, questionCorrectLetters(q));
      graded[q.id] = { ...existing, checked: true, correct };
    }
    this.answersState.set(graded);
    this.phaseState.set('results');
  }

  reset(): void {
    this.questionsState.set([]);
    this.answersState.set({});
    this.currentIndexState.set(0);
    this.phaseState.set('setup');
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
