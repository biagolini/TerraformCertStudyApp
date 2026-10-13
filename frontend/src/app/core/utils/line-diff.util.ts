export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

/** Line diff of two texts (longest common subsequence), for showing a
 * proposed note change: removed lines, then added ones, in document order.
 * The shared head and tail are skipped before the quadratic part, so a
 * small edit to a long note stays cheap. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);

  // lcs[i][j] = length of the common subsequence of x[i..] and y[j..].
  const lcs = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      middle.push({ kind: 'same', text: x[i++] });
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) middle.push({ kind: 'del', text: x[i++] });
    else middle.push({ kind: 'add', text: y[j++] });
  }
  while (i < x.length) middle.push({ kind: 'del', text: x[i++] });
  while (j < y.length) middle.push({ kind: 'add', text: y[j++] });

  return [
    ...a.slice(0, head).map((text) => ({ kind: 'same' as const, text })),
    ...middle,
    ...a.slice(a.length - tail).map((text) => ({ kind: 'same' as const, text })),
  ];
}
