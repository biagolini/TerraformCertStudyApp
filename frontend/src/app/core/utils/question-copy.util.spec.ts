import { describe, expect, it } from 'vitest';
import { formatQuestionForCopy } from './question-copy.util';

const labels = {
  questionHeading: 'Question',
  optionsHeading: 'Options',
  answerHeading: 'Answer key',
  commentsHeading: 'Comments',
  studentChoseOne: 'The student chose option',
  studentChoseMany: 'The student chose options',
  correctOne: 'Correct option',
  correctMany: 'Correct options',
  generalComment: 'General comment',
};

const question = {
  stem: 'Which service stores objects?',
  alternatives: [
    { letter: 'A', text: 'Amazon S3', isCorrect: true, comment: 'Object storage.' },
    { letter: 'B', text: 'Amazon EBS', isCorrect: false, comment: 'Block storage.' },
    { letter: 'C', text: 'Amazon VPC', isCorrect: false, comment: '' },
  ],
  generalComment: 'S3 is the object store.',
};

describe('formatQuestionForCopy', () => {
  it('copies only the stem and alternatives before the answer is revealed', () => {
    const text = formatQuestionForCopy(question, { reveal: false, selected: ['B'], labels });
    expect(text).toBe(
      [
        '# Question',
        '',
        'Which service stores objects?',
        '',
        '# Options',
        '',
        '## A',
        '',
        'Amazon S3',
        '',
        '## B',
        '',
        'Amazon EBS',
        '',
        '## C',
        '',
        'Amazon VPC',
        '',
      ].join('\n'),
    );
    expect(text).not.toContain('Object storage');
    expect(text).not.toContain('Correct');
  });

  it('adds the answer, the pick and the comments once revealed', () => {
    const text = formatQuestionForCopy(question, { reveal: true, selected: ['B'], labels });
    expect(text).toBe(
      [
        '# Question',
        '',
        'Which service stores objects?',
        '',
        '# Options',
        '',
        '## A',
        '',
        'Amazon S3',
        '',
        '## B',
        '',
        'Amazon EBS',
        '',
        '## C',
        '',
        'Amazon VPC',
        '',
        '# Answer key',
        '',
        'Correct option: A',
        '',
        'The student chose option B',
        '',
        '# Comments',
        '',
        '## A',
        '',
        'Object storage.',
        '',
        '## B',
        '',
        'Block storage.',
        '',
        '## General comment',
        '',
        'S3 is the object store.',
        '',
      ].join('\n'),
    );
  });

  it('uses the plural labels for multi-answer questions and picks', () => {
    const multi = { ...question, alternatives: question.alternatives.map((a) => ({ ...a, isCorrect: a.letter !== 'C' })) };
    const text = formatQuestionForCopy(multi, { reveal: true, selected: ['A', 'B'], labels });
    expect(text).toContain('Correct options: A, B');
    expect(text).toContain('The student chose options A, B');
  });
});
