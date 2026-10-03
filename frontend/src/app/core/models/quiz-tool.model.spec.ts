import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUIZ_TOOL_ORDER,
  MAX_QUIZ_TOOLBAR_ROWS,
  QUIZ_TOOLS,
  isQuizToolId,
  resolveQuizToolOrder,
  splitQuizToolRows,
} from './quiz-tool.model';

describe('resolveQuizToolOrder', () => {
  it('returns every tool in the given order', () => {
    const order = ['note', 'highlight', 'strikethrough', 'clearMarks', 'translate', 'checkAnswer', 'nextQuestion'];
    expect(resolveQuizToolOrder(order).map((t) => t.id)).toEqual(order);
  });

  it('appends tools missing from a stale stored order', () => {
    const resolved = resolveQuizToolOrder(['note', 'highlight']);
    expect(resolved.slice(0, 2).map((t) => t.id)).toEqual(['note', 'highlight']);
    expect(resolved).toHaveLength(QUIZ_TOOLS.length);
  });

  it('ignores unknown and duplicated ids', () => {
    const resolved = resolveQuizToolOrder(['nope', 'note', 'note']);
    expect(resolved.map((t) => t.id)).toEqual([
      'note',
      ...DEFAULT_QUIZ_TOOL_ORDER.filter((id) => id !== 'note'),
    ]);
  });
});

describe('isQuizToolId', () => {
  it('accepts known ids only', () => {
    expect(isQuizToolId('highlight')).toBe(true);
    expect(isQuizToolId('nope')).toBe(false);
    expect(isQuizToolId(3)).toBe(false);
  });
});

describe('splitQuizToolRows', () => {
  it('keeps everything on one row by default', () => {
    expect(splitQuizToolRows([1, 2, 3, 4, 5], 1)).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('gives the remainder to the earlier rows', () => {
    expect(splitQuizToolRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2, 3], [4, 5]]);
    expect(splitQuizToolRows([1, 2, 3, 4, 5], 3)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('never creates a row without at least one item', () => {
    expect(splitQuizToolRows([1, 2], 3)).toEqual([[1], [2]]);
    expect(splitQuizToolRows([1], 3)).toEqual([[1]]);
    expect(splitQuizToolRows([], 3)).toEqual([]);
  });

  it('clamps out-of-range row counts', () => {
    expect(splitQuizToolRows([1, 2, 3, 4], 0)).toEqual([[1, 2, 3, 4]]);
    expect(splitQuizToolRows([1, 2, 3, 4], -2)).toEqual([[1, 2, 3, 4]]);
    expect(splitQuizToolRows([1, 2, 3, 4], 99)).toHaveLength(MAX_QUIZ_TOOLBAR_ROWS);
  });
});
