import { describe, expect, it } from 'vitest';
import { Question } from '../models/question.model';
import { buildConceptProposalRequest } from './assistant-prompt.util';

const QUESTION = {
  id: 'q1',
  domain: 'Storage',
  stem: 'Which storage class fits rarely accessed data?',
  alternatives: [
    { letter: 'A', text: 'Option one', isCorrect: true, comment: 'Correct because of the retrieval cost.' },
    { letter: 'B', text: 'Option two', isCorrect: false, comment: 'Wrong because of latency.' },
  ],
  generalComment: 'The answer is A.',
} as unknown as Question;

describe('buildConceptProposalRequest', () => {
  it('carries the answer key and explanations once the answer was shown', () => {
    const text = buildConceptProposalRequest(QUESTION, ['B'], []);
    expect(text).toContain('[KEY: correct]');
    expect(text).toContain('Correct because of the retrieval cost.');
  });

  it('leaves out the answer key, explanations and the pick while the answer is hidden', () => {
    const text = buildConceptProposalRequest(QUESTION, ['B'], [{ role: 'assistant', content: 'secret' }], true);
    expect(text).toContain('Option one');
    expect(text).toContain('Option two');
    expect(text).not.toContain('KEY');
    expect(text).not.toContain('Correct because');
    expect(text).not.toContain('Wrong because');
    expect(text).not.toContain('The answer is A.');
    expect(text).not.toContain('secret');
    expect(text).not.toContain("STUDENT'S ANSWER");
  });
});
