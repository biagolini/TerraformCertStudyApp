import { Pack } from '../models/pack.model';
import { QuizAttemptAnswer } from '../models/quiz-attempt.model';
import { resolveResumePack, scoreAnswer, synthesizeQuestionFromAnswer } from './quiz.service';

describe('scoreAnswer', () => {
  it('scores an exact single-answer match as 1, regardless of partial credit', () => {
    expect(scoreAnswer(['B'], ['B'], false)).toBe(1);
    expect(scoreAnswer(['B'], ['B'], true)).toBe(1);
  });

  it('scores a wrong single-answer pick as 0, regardless of partial credit', () => {
    expect(scoreAnswer(['B'], ['A'], false)).toBe(0);
    expect(scoreAnswer(['B'], ['A'], true)).toBe(0);
  });

  it('without partial credit, a multi-select question is all-or-nothing', () => {
    expect(scoreAnswer(['A', 'C'], ['A'], false)).toBe(0);
    expect(scoreAnswer(['A', 'C'], ['A', 'C'], false)).toBe(1);
    expect(scoreAnswer(['A', 'C'], ['A', 'B', 'C'], false)).toBe(0);
  });

  it('with partial credit, scores the fraction of required correct letters selected', () => {
    expect(scoreAnswer(['A', 'C'], ['A'], true)).toBe(0.5);
    expect(scoreAnswer(['A', 'C'], ['A', 'C'], true)).toBe(1);
    expect(scoreAnswer(['A', 'C', 'D'], ['A'], true)).toBeCloseTo(1 / 3);
  });

  it('never exceeds 1 even with extra wrong picks under partial credit', () => {
    expect(scoreAnswer(['A', 'C'], ['A', 'C', 'D'], true)).toBe(1);
  });

  it('scores no selection as 0', () => {
    expect(scoreAnswer(['A'], [], false)).toBe(0);
    expect(scoreAnswer(['A'], [], true)).toBe(0);
  });
});

function makeAnswer(overrides: Partial<QuizAttemptAnswer> = {}): QuizAttemptAnswer {
  return {
    questionId: 'q1',
    title: 'A question',
    domain: 'General',
    selected: ['B'],
    correctLetters: ['B'],
    score: 1,
    checked: true,
    stemSnapshot: 'What is the answer?',
    alternativesSnapshot: [
      { letter: 'A', text: 'Wrong' },
      { letter: 'B', text: 'Right' },
    ],
    highlights: {},
    strikethroughs: {},
    note: '',
    timeSpentSeconds: 12,
    markedForReview: false,
    ...overrides,
  };
}

describe('synthesizeQuestionFromAnswer', () => {
  it('rebuilds a Question purely from the frozen snapshot, with no comment text', () => {
    const q = synthesizeQuestionFromAnswer(makeAnswer(), 'pack-1');
    expect(q.id).toBe('q1');
    expect(q.packId).toBe('pack-1');
    expect(q.stem).toBe('What is the answer?');
    expect(q.alternatives).toEqual([
      { letter: 'A', text: 'Wrong', isCorrect: false, comment: '' },
      { letter: 'B', text: 'Right', isCorrect: true, comment: '' },
    ]);
  });
});

function makePack(overrides: Partial<Pack> = {}): Pack {
  return {
    id: 'pack-1',
    name: 'AWS Certified DevOps Engineer',
    description: '',
    version: '',
    domains: [],
    color: '#6c5ce7',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('resolveResumePack', () => {
  const attempt = { packId: 'pack-1', examSlug: 'aws-certified-devops-engineer', examName: 'AWS Certified DevOps Engineer', partialCredit: true };

  it('resolves by exact pack id first', () => {
    const target = makePack({ id: 'pack-1' });
    const result = resolveResumePack([makePack({ id: 'other' }), target], attempt);
    expect(result).toBe(target);
  });

  it('falls back to matching by exam slug when the pack id is gone', () => {
    const target = makePack({ id: 'renamed-id', name: 'AWS Certified DevOps Engineer' });
    const result = resolveResumePack([makePack({ id: 'unrelated', name: 'Something else' }), target], attempt);
    expect(result).toBe(target);
  });

  it('falls back to a minimal partial-credit-only stand-in when both lookups miss, never the wrong active pack', () => {
    const result = resolveResumePack([makePack({ id: 'unrelated', name: 'Unrelated exam' })], attempt);
    expect(result.id).toBe('pack-1');
    expect(result.name).toBe('AWS Certified DevOps Engineer');
    expect(result.allowPartialCredit).toBe(true);
    expect(result.examDurationMinutes).toBeUndefined();
    expect(result.examTotalQuestions).toBeUndefined();
  });
});
