/**
 * Targeted edits the note copilot returns when the student applies a change
 * (see CONCEPT_APPLY_REQUEST). The model used to return the whole note, and a
 * long note does not fit in one reply: a reply cut at the output limit
 * replaced a 31 KB note with its first 8 KB. Edits name a section by its
 * heading and carry only the new text, so the reply stays small and every
 * part of the note the edit does not touch is kept byte for byte.
 */
export type NoteEditAction = 'replace_text' | 'insert_after' | 'replace' | 'append';

export interface NoteEdit {
  action: NoteEditAction;
  /** Heading line of the target section as the model copied it; null for append and replace_text. */
  section: string | null;
  content: string;
  /** replace_text only: the exact passage of the note that `content` replaces. */
  old?: string;
}

export interface NoteEditResult {
  markdown: string;
  applied: number;
  /** Sections or passages named by an edit that the note does not have (or has more than once). */
  missing: string[];
}

/** Edit blocks of a reply. The closing `=== END EDIT ===` is optional (models
 * often drop it): a block runs to the next `=== EDIT ===` or the end of the
 * reply. A reply cut off at the output limit is rejected before parsing, by
 * its stop reason, not here. */
export function parseNoteEdits(reply: string): NoteEdit[] {
  const edits: NoteEdit[] = [];
  for (const chunk of reply.split(/^\s*===\s*EDIT\s*===\s*$/im).slice(1)) {
    const parts = chunk.split(/^\s*===\s*CONTENT\s*===\s*$/im);
    if (parts.length < 2) continue;
    const header = parts[0];
    // replace_text carries the passage being replaced between OLD and CONTENT.
    const oldSplit = header.split(/^\s*===\s*OLD\s*===\s*$/im);
    const old = oldSplit.length > 1 ? oldSplit.slice(1).join('\n').trim() : '';
    const body = parts.slice(1).join('\n').replace(/^\s*===\s*END EDIT\s*===\s*$[\s\S]*/im, '');
    const action = /^\s*ACTION:\s*(replace_text|insert_after|replace|append)\s*$/im.exec(oldSplit[0])?.[1]?.toLowerCase() as NoteEditAction | undefined;
    if (!action) continue;
    if (action === 'replace_text') {
      const content = stripFence(body.trim()).trim();
      if (old) edits.push({ action, section: null, old: stripFence(old).trim(), content });
      continue;
    }
    const rawSection = /^\s*SECTION:\s*(.*)$/im.exec(header)?.[1]?.trim() ?? '';
    const section = action === 'append' || !rawSection || /^none$/i.test(rawSection) ? null : rawSection;
    if (action !== 'append' && !section) continue;
    const content = stripFence(body.trim()).trim();
    if (content) edits.push({ action, section, content });
  }
  return edits;
}

/** Applies the edits in order; an edit whose section cannot be found is skipped and reported. */
export function applyNoteEdits(markdown: string, edits: NoteEdit[]): NoteEditResult {
  let lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let applied = 0;
  const missing: string[] = [];
  for (const edit of edits) {
    const block = edit.content.split('\n');
    if (edit.action === 'replace_text') {
      const text = lines.join('\n');
      const at = findPassage(text, edit.old!);
      if (!at) {
        missing.push(`"${edit.old!.slice(0, 60)}${edit.old!.length > 60 ? '…' : ''}"`);
        continue;
      }
      lines = (text.slice(0, at.start) + edit.content + text.slice(at.end)).split('\n');
      applied++;
      continue;
    }
    if (edit.action === 'append') {
      lines = [...trimEnd(lines), '', ...block, ''];
      applied++;
      continue;
    }
    const range = findSection(lines, edit.section!);
    if (!range) {
      missing.push(edit.section!);
      continue;
    }
    if (edit.action === 'replace') {
      const withHeading = headingOf(block[0]) ? block : [lines[range.start], '', ...block];
      lines = [...lines.slice(0, range.start), ...withHeading, '', ...lines.slice(range.end)];
    } else {
      const before = trimEnd(lines.slice(0, range.end));
      lines = [...before, '', ...block, '', ...lines.slice(range.end)];
    }
    applied++;
  }
  return { markdown: collapseBlankRuns(lines).join('\n').trim() + '\n', applied, missing };
}

/** Where `passage` occurs in `text`, only if exactly once: first verbatim,
 * then ignoring differences in spacing (models often reflow whitespace). */
function findPassage(text: string, passage: string): { start: number; end: number } | null {
  const first = text.indexOf(passage);
  if (first >= 0) return text.indexOf(passage, first + 1) < 0 ? { start: first, end: first + passage.length } : null;
  const words = passage.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return null;
  const matches = [...text.matchAll(new RegExp(words.join('\\s+'), 'g'))];
  return matches.length === 1 ? { start: matches[0].index!, end: matches[0].index! + matches[0][0].length } : null;
}

interface Heading {
  level: number;
  text: string;
}

function headingOf(line: string | undefined): Heading | null {
  const m = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line ?? '');
  return m ? { level: m[1].length, text: normalize(m[2]) } : null;
}

function normalize(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Lines [start, end) of the section under the named heading: up to the next heading of the same or a higher level. */
function findSection(lines: string[], section: string): { start: number; end: number } | null {
  const wanted = headingOf(section) ?? { level: 0, text: normalize(section.replace(/^#+\s*/, '')) };
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    const h = headingOf(lines[i]);
    if (!h) continue;
    if (start >= 0 && h.level <= level) return { start, end: i };
    if (start < 0 && h.text === wanted.text && (wanted.level === 0 || h.level === wanted.level)) {
      start = i;
      level = h.level;
    }
  }
  return start >= 0 ? { start, end: lines.length } : null;
}

function stripFence(text: string): string {
  const m = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n\s*```\s*$/i.exec(text);
  return m ? m[1] : text;
}

function trimEnd(lines: string[]): string[] {
  const out = [...lines];
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

function collapseBlankRuns(lines: string[]): string[] {
  return lines.filter((line, i) => line.trim() !== '' || i === 0 || lines[i - 1].trim() !== '');
}
