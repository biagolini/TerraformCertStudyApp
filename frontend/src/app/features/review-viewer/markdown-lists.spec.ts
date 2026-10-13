import { parseMarkdown } from './markdown-renderer.component';

const levels = (md: string) =>
  parseMarkdown(md).flatMap((b) => (b.kind === 'ul' || b.kind === 'ol' ? [{ kind: b.kind, levels: b.items.map((i) => i.level) }] : []));

describe('parseMarkdown lists', () => {
  it('reads nesting from indentation, with 2 or 4 spaces', () => {
    expect(levels('- a\n  - b\n    - c\n- d')).toEqual([{ kind: 'ul', levels: [0, 1, 2, 0] }]);
    expect(levels('- a\n    - b\n- c')).toEqual([{ kind: 'ul', levels: [0, 1, 0] }]);
  });

  it('keeps a nested numbered item inside its bullet list', () => {
    expect(levels('- a\n  1. b\n  2. c\n- d')).toEqual([{ kind: 'ul', levels: [0, 1, 1, 0] }]);
  });

  it('keeps a loose list (blank lines between items) as one nested list', () => {
    expect(levels('- a\n\n  - b\n\n  - c\n\n- d\n\nText')).toEqual([{ kind: 'ul', levels: [0, 1, 1, 0] }]);
  });

  it('still splits top-level lists of different kinds', () => {
    expect(levels('- a\n1. b')).toEqual([
      { kind: 'ul', levels: [0] },
      { kind: 'ol', levels: [0] },
    ]);
  });
});
