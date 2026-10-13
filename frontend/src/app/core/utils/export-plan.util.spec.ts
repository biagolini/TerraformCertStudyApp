import { collectAttemptQuestions, exportFileName, matchesAttemptFilter, planExportFiles, sanitizeFilePrefix } from './export-plan.util';
import { Question } from '../models/question.model';
import { QuizAttempt, QuizAttemptAnswer } from '../models/quiz-attempt.model';

function question(id: string, domain: string): Question {
  return {
    id,
    packId: 'p',
    bankId: 'b',
    title: id,
    domain,
    stem: '',
    alternatives: [],
    metadata: { topics: [], relatedServices: [] },
    createdAt: 0,
    updatedAt: 0,
  };
}

function answer(questionId: string, score: number, markedForReview = false): QuizAttemptAnswer {
  return {
    questionId,
    title: questionId,
    domain: 'D1',
    selected: score > 0 ? ['A'] : [],
    correctLetters: ['A'],
    score,
    checked: true,
    stemSnapshot: '',
    alternativesSnapshot: [],
    highlights: {},
    strikethroughs: {},
    note: '',
    timeSpentSeconds: 0,
    markedForReview,
  };
}

function attempt(id: string, finishedAt: number, answers: QuizAttemptAnswer[]): QuizAttempt {
  return {
    id,
    status: 'FINISHED',
    packId: 'p',
    examSlug: 'p',
    examName: 'Exam',
    scope: 'pack',
    mode: 'exam',
    partialCredit: true,
    settings: {} as QuizAttempt['settings'],
    answers,
    currentIndex: 0,
    totalScore: 0,
    maxScore: answers.length,
    scorePercent: 0,
    startedAt: finishedAt - 1,
    finishedAt,
  };
}

describe('planExportFiles', () => {
  const ten = Array.from({ length: 10 }, (_, i) => question(`a${i}`, 'A'));
  const two = [question('b0', 'B'), question('b1', 'B')];

  it('combines domain split with balanced size batches', () => {
    const files = planExportFiles([...two, ...ten], { maxPerFile: 6, byDomain: true }, ['A', 'B']);
    expect(files.map((f) => [f.domain, f.part, f.totalParts, f.questions.length])).toEqual([
      ['A', 1, 2, 5],
      ['A', 2, 2, 5],
      ['B', 1, 1, 2],
    ]);
  });

  it('splits by size only', () => {
    const files = planExportFiles([...ten, ...two], { maxPerFile: 6, byDomain: false });
    expect(files.map((f) => f.questions.length)).toEqual([6, 6]);
    expect(files.every((f) => f.domain === null)).toBe(true);
  });

  it('keeps a single file without any split', () => {
    expect(planExportFiles(ten, { maxPerFile: null, byDomain: false }).length).toBe(1);
    expect(planExportFiles([], { maxPerFile: 6, byDomain: true })).toEqual([]);
  });
});

describe('collectAttemptQuestions', () => {
  it('dedupes questions across attempts and merges wrong/flagged', () => {
    const entries = collectAttemptQuestions([
      attempt('late', 20, [answer('q1', 1, true), answer('q3', 0)]),
      attempt('early', 10, [answer('q1', 0.5), answer('q2', 1)]),
    ]);
    expect(entries.map((e) => e.questionId)).toEqual(['q1', 'q2', 'q3']);
    const q1 = entries[0];
    expect(q1.wrong).toBe(true); // partial credit counts as wrong
    expect(q1.flagged).toBe(true);
    expect(q1.answers.map((a) => a.attemptId)).toEqual(['early', 'late']);
    expect(entries[1].wrong).toBe(false);
    expect(entries[2].wrong).toBe(true); // unanswered counts as wrong
  });

  it('filters by status', () => {
    const right = { wrong: false, flagged: false };
    const guessed = { wrong: false, flagged: true };
    const missed = { wrong: true, flagged: false };
    expect([right, guessed, missed].filter((e) => matchesAttemptFilter(e, 'wrong'))).toEqual([missed]);
    expect([right, guessed, missed].filter((e) => matchesAttemptFilter(e, 'flagged'))).toEqual([guessed]);
    expect([right, guessed, missed].filter((e) => matchesAttemptFilter(e, 'wrongOrFlagged'))).toEqual([guessed, missed]);
    expect([right, guessed, missed].filter((e) => matchesAttemptFilter(e, 'all')).length).toBe(3);
  });
});

describe('export file names', () => {
  it('sanitizes a custom prefix without changing its case', () => {
    expect(sanitizeFilePrefix('  My export/1 ')).toBe('My-export1');
    expect(sanitizeFilePrefix('my-export.md')).toBe('my-export');
    expect(sanitizeFilePrefix('a:*?"<>|b')).toBe('ab');
    expect(sanitizeFilePrefix(' -- ')).toBe('');
  });

  it('adds domain number and part only when they apply', () => {
    expect(exportFileName('my-export', { part: 1, totalParts: 1 }, null)).toBe('my-export.md');
    expect(exportFileName('my-export', { part: 2, totalParts: 2 }, null)).toBe('my-export-2-of-2.md');
    expect(exportFileName('my-export', { part: 1, totalParts: 1 }, 6)).toBe('my-export-d6.md');
    expect(exportFileName('my-export', { part: 1, totalParts: 2 }, 3)).toBe('my-export-d3-1-of-2.md');
  });
});

describe('collectAttemptQuestions options', () => {
  const five = attempt('a', 10, ['q1', 'q2', 'q3', 'q4', 'q5'].map((id, i) => answer(id, i % 2 === 0 ? 0 : 1)));
  const other = attempt('b', 20, ['q6', 'q7', 'q8'].map((id) => answer(id, 1)));

  it('applies each attempt its own range, with open bounds', () => {
    const ids = (ranges: Record<string, { from?: number | null; to?: number | null }>) =>
      collectAttemptQuestions([five, other], { ranges }).map((e) => e.questionId);
    expect(ids({ a: { from: 2, to: 3 }, b: { from: 3 } })).toEqual(['q2', 'q3', 'q8']);
    expect(ids({ a: { to: 2 } })).toEqual(['q1', 'q2', 'q6', 'q7', 'q8']);
    expect(ids({ a: { from: 4, to: 2 } })).toEqual(['q6', 'q7', 'q8']);
  });

  it('skips unanswered questions when asked', () => {
    // answer() leaves score-0 rows unanswered (nothing selected).
    expect(collectAttemptQuestions([five], { skipUnanswered: true }).map((e) => e.questionId)).toEqual(['q2', 'q4']);
  });

  it('grades with the given scorer (in-progress exam-mode attempts)', () => {
    const graded = collectAttemptQuestions([five], { scoreOf: () => 1 });
    expect(graded.every((e) => !e.wrong)).toBe(true);
  });
});
