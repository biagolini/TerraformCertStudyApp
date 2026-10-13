import { applyAlternativeOrder, hasPositionalAlternatives, shuffleAlternatives, toSourceLetters } from './alternative-shuffle.util';
import { Question, withValidLetters } from '../models/question.model';

function question(texts: string[], correct = 'B'): Question {
  return {
    id: 'q1', packId: 'p', bankId: 'b', title: 't', domain: 'd', stem: 's',
    alternatives: texts.map((text, i) => {
      const letter = 'ABCDE'[i];
      return { letter, text, isCorrect: letter === correct, comment: `about ${letter}` };
    }),
    metadata: { topics: [], relatedServices: [] }, createdAt: 0, updatedAt: 0,
  };
}

// Deterministic "random": reverses a 4-item list under Fisher–Yates.
const reverse = () => 0;

describe('alternative shuffle', () => {
  it('reorders, relabels by position and keeps each comment and answer key with its text', () => {
    const shuffled = shuffleAlternatives(question(['one', 'two', 'three', 'four']), reverse);
    expect(shuffled.alternatives.map((a) => a.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(shuffled.alternatives.map((a) => a.text)).toEqual(['two', 'three', 'four', 'one']);
    const correct = shuffled.alternatives.find((a) => a.isCorrect)!;
    expect(correct.text).toBe('two');
    expect(correct.sourceLetter).toBe('B');
    expect(correct.comment).toBe('about B');
  });

  it('keeps positional questions in their original order', () => {
    const q = question(['EC2', 'S3', 'All of the above']);
    expect(hasPositionalAlternatives(q)).toBe(true);
    expect(shuffleAlternatives(q, reverse)).toBe(q);
    expect(hasPositionalAlternatives(question(['Todas as anteriores', 'x']))).toBe(true);
    expect(hasPositionalAlternatives(question(['A and B', 'x']))).toBe(true);
    expect(hasPositionalAlternatives(question(['Use Amazon S3 and CloudFront', 'x']))).toBe(false);
  });

  it('rebuilds the shown order from a snapshot and maps answers back to bank letters', () => {
    const bank = question(['one', 'two', 'three', 'four']);
    const shown = shuffleAlternatives(bank, reverse);
    const snapshot = shown.alternatives.map((a) => ({ letter: a.letter, text: a.text, sourceLetter: a.sourceLetter }));
    expect(applyAlternativeOrder(bank, snapshot).alternatives.map((a) => a.text)).toEqual(['two', 'three', 'four', 'one']);
    expect(toSourceLetters(['A', 'D'], snapshot)).toEqual(['B', 'A']);
  });

  it('leaves attempts without a shuffled order untouched', () => {
    const bank = question(['one', 'two']);
    const snapshot = bank.alternatives.map((a) => ({ letter: a.letter, text: a.text }));
    expect(applyAlternativeOrder(bank, snapshot)).toBe(bank);
    expect(toSourceLetters(['B'], snapshot)).toEqual(['B']);
  });

  it('relabels bullet or lowercase letters A, B, C… by position and keeps valid ones', () => {
    const bullets = question(['one', 'two', 'three']);
    bullets.alternatives.forEach((a) => (a.letter = '-'));
    expect(withValidLetters(bullets).alternatives.map((a) => a.letter)).toEqual(['A', 'B', 'C']);
    const lower = question(['one', 'two']);
    lower.alternatives.forEach((a) => (a.letter = a.letter.toLowerCase()));
    expect(withValidLetters(lower).alternatives.map((a) => a.letter)).toEqual(['A', 'B']);
    const ok = question(['one', 'two']);
    expect(withValidLetters(ok)).toBe(ok);
  });

  it('shows the bank order when a saved order repeats an alternative', () => {
    const bank = question(['one', 'two', 'three']);
    const broken = ['A', 'B', 'C'].map((letter) => ({ letter, text: 'one', sourceLetter: '-' }));
    expect(applyAlternativeOrder(bank, broken)).toBe(bank);
  });

  it('restores a shuffled order by text after the bank letters were repaired', () => {
    const bank = question(['one', 'two', 'three']);
    const snapshot = [
      { letter: 'A', text: 'three', sourceLetter: '-' },
      { letter: 'B', text: 'one', sourceLetter: '-' },
      { letter: 'C', text: 'two', sourceLetter: '-' },
    ];
    const shown = applyAlternativeOrder(bank, snapshot);
    expect(shown.alternatives.map((a) => a.text)).toEqual(['three', 'one', 'two']);
    expect(shown.alternatives.find((a) => a.isCorrect)?.letter).toBe('C');
  });
});
