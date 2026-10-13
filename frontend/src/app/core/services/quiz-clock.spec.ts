import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pack } from '../models/pack.model';
import { Question } from '../models/question.model';
import { DEFAULT_QUIZ_SETTINGS, QuizSettings } from '../models/quiz.model';
import { PacksService } from './packs.service';
import { QuestionsService } from './questions.service';
import { QuizAttemptsService } from './quiz-attempts.service';
import { QuizService } from './quiz.service';

function question(id: string): Question {
  return {
    id,
    packId: 'p1',
    bankId: 'b1',
    title: id,
    domain: 'D1',
    stem: 'Stem',
    alternatives: [
      { letter: 'A', text: 'Right', isCorrect: true, comment: '' },
      { letter: 'B', text: 'Wrong', isCorrect: false, comment: '' },
    ],
    metadata: {} as Question['metadata'],
    createdAt: 0,
    updatedAt: 0,
  };
}

function setup(pack: Partial<Pack>) {
  const active = signal<Pack>({
    id: 'p1',
    name: 'Exam',
    description: '',
    version: '',
    domains: [],
    color: '#000',
    createdAt: 0,
    updatedAt: 0,
    ...pack,
  });
  const questions = [question('q1'), question('q2')];
  TestBed.configureTestingModule({
    providers: [
      { provide: PacksService, useValue: { activePack: active, packs: () => [active()] } },
      { provide: QuestionsService, useValue: { allQuestions: () => questions, getById: (id: string) => questions.find((q) => q.id === id) } },
      { provide: QuizAttemptsService, useValue: { syncInProgress: vi.fn(async () => true), save: vi.fn(async () => true) } },
    ],
  });
  return TestBed.inject(QuizService);
}

const instant = (overrides: Partial<QuizSettings> = {}): QuizSettings => ({
  ...DEFAULT_QUIZ_SETTINGS,
  domains: [],
  mode: 'instant',
  shuffle: false,
  count: 2,
  trackTime: true,
  ...overrides,
});

describe('QuizService per-question clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('paces against each exam own duration and official question count, accommodation included', () => {
    const quiz = setup({ examDurationMinutes: 180, examTotalQuestions: 75, accommodationMinutes: 30 });
    quiz.start(instant());
    expect(quiz.perQuestionSeconds()).toBe(144);
    quiz.start(instant({ useAccommodation: true }));
    expect(quiz.perQuestionSeconds()).toBe(168);
  });

  it('gives a different budget to an exam with the same question count but less time', () => {
    const quiz = setup({ examDurationMinutes: 130, examTotalQuestions: 65 });
    quiz.start(instant());
    expect(quiz.perQuestionSeconds()).toBe(120);
  });

  it('shows the per-question clock in instant mode even with the old "Track time" switch off', () => {
    const quiz = setup({ examDurationMinutes: 130, examTotalQuestions: 65 });
    quiz.start(instant({ trackTime: false }));
    vi.advanceTimersByTime(10_000);
    expect(quiz.clock()?.remainingSeconds).toBeCloseTo(110);
  });

  it('has no clock when the certification lacks an official question count', () => {
    const quiz = setup({ examDurationMinutes: 130 });
    quiz.start(instant());
    expect(quiz.clock()).toBeNull();
  });

  it('counts down, then goes into overtime instead of stopping at zero', () => {
    const quiz = setup({ examDurationMinutes: 130, examTotalQuestions: 65 });
    quiz.start(instant());
    vi.advanceTimersByTime(100_000);
    expect(quiz.clock()?.remainingSeconds).toBeCloseTo(20);
    vi.advanceTimersByTime(30_000);
    expect(quiz.clock()?.overtime).toBe(true);
    expect(quiz.clock()?.remainingSeconds).toBeCloseTo(-10);
  });

  it('restarting the time zeroes it and the restarted count is what gets recorded', () => {
    const quiz = setup({ examDurationMinutes: 130, examTotalQuestions: 65 });
    quiz.start(instant());
    vi.advanceTimersByTime(600_000);
    quiz.resetCurrentQuestionTime();
    expect(quiz.liveTimeSpent('q1')).toBe(0);
    vi.advanceTimersByTime(30_000);
    quiz.next();
    expect(quiz.timeSpentById()['q1']).toBeCloseTo(30);
  });

  it('stops counting at the check, also across a revisit', () => {
    const quiz = setup({ examDurationMinutes: 130, examTotalQuestions: 65 });
    quiz.start(instant());
    vi.advanceTimersByTime(40_000);
    quiz.toggleOption('A');
    quiz.checkAnswer();
    vi.advanceTimersByTime(300_000);
    expect(quiz.liveTimeSpent('q1')).toBeCloseTo(40);
    quiz.next();
    quiz.previous();
    vi.advanceTimersByTime(60_000);
    expect(quiz.liveTimeSpent('q1')).toBeCloseTo(40);
    quiz.resetCurrentQuestionTime();
    expect(quiz.liveTimeSpent('q1')).toBeCloseTo(40);
  });
});
