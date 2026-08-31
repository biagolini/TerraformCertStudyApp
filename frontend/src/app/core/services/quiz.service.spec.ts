import { scoreAnswer } from './quiz.service';

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
