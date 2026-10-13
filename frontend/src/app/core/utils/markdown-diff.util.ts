import { diffItems } from './line-diff.util';

export interface DiffSegment {
  kind: 'same' | 'add' | 'del';
  /** Markdown of one or more whole blocks, rendered as-is in the review. */
  markdown: string;
  /** Lines in this segment, for the "N added, M removed" summary. */
  lines: number;
}

/**
 * Splits Markdown into the blocks a reader sees: paragraphs, headings, each
 * top-level list item (with its nested lines), tables and fenced code. A
 * block-level diff can then be rendered as formatted text, with each changed
 * block shown whole — a line diff would cut through a list or a code fence.
 */
export function markdownBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence = false;
  const flush = () => {
    if (current.length) blocks.push(current.join('\n'));
    current = [];
  };
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (fence) {
      current.push(line);
      if (trimmed.startsWith('```')) {
        fence = false;
        flush();
      }
      continue;
    }
    if (trimmed.startsWith('```')) {
      flush();
      current.push(line);
      fence = true;
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const topLevelItem = /^([-*+]|\d+[.)])\s+/.test(line);
    if (/^#{1,6}\s/.test(trimmed)) {
      flush();
      blocks.push(line);
      continue;
    }
    if (topLevelItem) flush();
    current.push(line);
  }
  flush();
  return blocks;
}

/** Block diff of two notes, with neighbouring blocks of the same kind merged
 * into one segment (an unchanged run renders as one stretch of the note). */
export function diffMarkdown(before: string, after: string): DiffSegment[] {
  const segments: DiffSegment[] = [];
  for (const item of diffItems(markdownBlocks(before), markdownBlocks(after))) {
    const last = segments[segments.length - 1];
    const lines = item.text.split('\n').length;
    // A list item merged with the previous one keeps them in one list; other blocks need a blank line.
    const joiner = /^([-*+]|\d+[.)])\s+/.test(item.text) ? '\n' : '\n\n';
    if (last && last.kind === item.kind) {
      last.markdown += joiner + item.text;
      last.lines += lines;
    } else segments.push({ kind: item.kind, markdown: item.text, lines });
  }
  return segments;
}
