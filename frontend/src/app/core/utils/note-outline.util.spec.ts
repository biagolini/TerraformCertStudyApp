import { hasChildren, noteOutline, visibleOutline } from './note-outline.util';

const NOTE = [
  '# Storage',
  'Intro',
  '## Block storage',
  '### Volume types',
  '#### Details',
  '```',
  '# not a heading',
  '```',
  '## **File** storage',
  '# Networking',
  '## [Routing](https://example.com)',
].join('\n');

describe('noteOutline', () => {
  it('lists headings in order with level and plain text, skipping code fences', () => {
    expect(noteOutline(NOTE)).toEqual([
      { index: 0, level: 1, text: 'Storage' },
      { index: 1, level: 2, text: 'Block storage' },
      { index: 2, level: 3, text: 'Volume types' },
      { index: 3, level: 4, text: 'Details' },
      { index: 4, level: 2, text: 'File storage' },
      { index: 5, level: 1, text: 'Networking' },
      { index: 6, level: 2, text: 'Routing' },
    ]);
  });
});

describe('visibleOutline', () => {
  const items = noteOutline(NOTE);

  it('limits rows to the chosen depth', () => {
    expect(visibleOutline(items, 3, new Set()).map((i) => i.index)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(visibleOutline(items, 1, new Set()).map((i) => i.index)).toEqual([0, 5]);
  });

  it('hides the descendants of a collapsed heading only', () => {
    expect(visibleOutline(items, 3, new Set([0])).map((i) => i.index)).toEqual([0, 5, 6]);
    expect(visibleOutline(items, 6, new Set([1])).map((i) => i.index)).toEqual([0, 1, 4, 5, 6]);
  });

  it('knows which headings have children within the depth', () => {
    expect(hasChildren(items, items[1], 3)).toBe(true);
    expect(hasChildren(items, items[2], 3)).toBe(false);
    expect(hasChildren(items, items[2], 4)).toBe(true);
  });
});
