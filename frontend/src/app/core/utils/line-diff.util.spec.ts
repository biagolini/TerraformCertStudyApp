import { diffLines } from './line-diff.util';

const kinds = (a: string, b: string) => diffLines(a, b).map((l) => `${l.kind[0]}:${l.text}`);

describe('diffLines', () => {
  it('marks an inserted line between unchanged ones', () => {
    expect(kinds('a\nb\nc', 'a\nb\nnew\nc')).toEqual(['s:a', 's:b', 'a:new', 's:c']);
  });

  it('shows a changed line as removed then added', () => {
    expect(kinds('a\nold\nc', 'a\nnew\nc')).toEqual(['s:a', 'd:old', 'a:new', 's:c']);
  });

  it('keeps every line of both texts', () => {
    const before = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 150', 'line 150 edited\nline 150b');
    const diff = diffLines(before, after);
    expect(diff.filter((l) => l.kind !== 'add').map((l) => l.text).join('\n')).toBe(before);
    expect(diff.filter((l) => l.kind !== 'del').map((l) => l.text).join('\n')).toBe(after);
    expect(diff.filter((l) => l.kind !== 'same')).toHaveLength(3);
  });
});
