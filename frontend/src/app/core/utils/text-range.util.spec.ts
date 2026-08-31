import { normalizeRanges, toggleRanges } from './text-range.util';

describe('normalizeRanges', () => {
  it('sorts and merges overlapping ranges', () => {
    expect(normalizeRanges([{ start: 10, end: 20 }, { start: 0, end: 5 }, { start: 15, end: 25 }])).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 25 },
    ]);
  });

  it('merges touching ranges', () => {
    expect(normalizeRanges([{ start: 0, end: 10 }, { start: 10, end: 20 }])).toEqual([{ start: 0, end: 20 }]);
  });

  it('drops empty/inverted ranges', () => {
    expect(normalizeRanges([{ start: 5, end: 5 }, { start: 0, end: 3 }])).toEqual([{ start: 0, end: 3 }]);
  });
});

describe('toggleRanges', () => {
  it('adds a fresh range when nothing overlaps', () => {
    expect(toggleRanges([], { start: 5, end: 10 })).toEqual([{ start: 5, end: 10 }]);
  });

  it('removes a range that exactly matches an existing one', () => {
    expect(toggleRanges([{ start: 5, end: 10 }], { start: 5, end: 10 })).toEqual([]);
  });

  it('removes a selection fully covered by a larger existing range, splitting it', () => {
    expect(toggleRanges([{ start: 0, end: 20 }], { start: 5, end: 10 })).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 20 },
    ]);
  });

  it('removes a selection covered by the union of two adjacent existing ranges', () => {
    expect(toggleRanges([{ start: 0, end: 10 }, { start: 10, end: 20 }], { start: 5, end: 15 })).toEqual([
      { start: 0, end: 5 },
      { start: 15, end: 20 },
    ]);
  });

  it('expands (unions) when the selection only partially overlaps an existing range', () => {
    expect(toggleRanges([{ start: 0, end: 5 }], { start: 0, end: 10 })).toEqual([{ start: 0, end: 10 }]);
  });

  it('expands (unions) when the selection spans a marked and an unmarked part', () => {
    expect(toggleRanges([{ start: 0, end: 5 }], { start: 3, end: 12 })).toEqual([{ start: 0, end: 12 }]);
  });

  it('unions two disjoint marked ranges when the new selection bridges them', () => {
    expect(toggleRanges([{ start: 0, end: 5 }, { start: 15, end: 20 }], { start: 4, end: 16 })).toEqual([
      { start: 0, end: 20 },
    ]);
  });
});
