/** One heading of a study note, in document order. `index` is its position
 * among all headings, which is also its position among the `[data-level]`
 * elements MarkdownRendererComponent renders, so the outline can scroll to it. */
export interface OutlineItem {
  index: number;
  level: number;
  text: string;
}

export const NOTE_OUTLINE_DEFAULT_DEPTH = 3;

/** Headings of a Markdown body, read the same way the renderer reads them:
 * `#`…`######` at the start of a line, ignoring fenced code blocks. */
export function noteOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let inFence = false;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.replace(/\t/g, '  ').trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (match) items.push({ index: items.length, level: match[1].length, text: plainText(match[2]) });
  }
  return items;
}

/** Outline rows to show: up to `depth` levels, minus the descendants of collapsed rows. */
export function visibleOutline(items: OutlineItem[], depth: number, collapsed: ReadonlySet<number>): OutlineItem[] {
  const shown: OutlineItem[] = [];
  let hideBelow: number | null = null;
  for (const item of items) {
    if (hideBelow !== null && item.level > hideBelow) continue;
    hideBelow = null;
    if (item.level > depth) continue;
    shown.push(item);
    if (collapsed.has(item.index)) hideBelow = item.level;
  }
  return shown;
}

/** Whether a heading has sub-headings within the shown depth (so it can collapse). */
export function hasChildren(items: OutlineItem[], item: OutlineItem, depth: number): boolean {
  const next = items[item.index + 1];
  return !!next && next.level > item.level && next.level <= depth;
}

function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .trim();
}
