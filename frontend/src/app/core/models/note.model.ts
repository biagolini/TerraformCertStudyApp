/**
 * Study note metadata, persisted as `NOTE#{id}` in the general table. The
 * Markdown body is NOT stored here: it lives in the private assets bucket at
 * `notes/{sub}/{id}/document.md` (and attached images under
 * `notes/{sub}/{id}/images/`), so a long note never runs into DynamoDB's
 * 400 KB item limit and is not re-downloaded by every `GET /data`.
 */
export interface Note {
  id: string;
  packId: string;
  title: string;
  tags: string[];
  /** First characters of the body, refreshed on every save, for list previews and search. */
  excerpt: string;
  wordCount: number;
  createdAt: number;
  updatedAt: number;
}

export type NoteSortField = 'updatedAt' | 'createdAt' | 'title' | 'wordCount';
export type NoteSortDir = 'asc' | 'desc';
export interface NoteSort {
  field: NoteSortField;
  dir: NoteSortDir;
}
/** How the notes list is shown: cards (default) or a table. */
export type NoteListView = 'cards' | 'table';
export const NOTE_LIST_VIEWS: NoteListView[] = ['cards', 'table'];
export const NOTE_SORT_FIELDS: NoteSortField[] = ['updatedAt', 'createdAt', 'title', 'wordCount'];
/** The list's order before sorting existed: last modified first. */
export const DEFAULT_NOTE_SORT: NoteSort = { field: 'updatedAt', dir: 'desc' };

/** Notes in the chosen order. Titles compare by locale, ignoring case and accents;
 * ties fall back to the last modified first, so the order is stable. */
export function sortNotes(notes: readonly Note[], sort: NoteSort, locale: string): Note[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const compare = (a: Note, b: Note): number => {
    switch (sort.field) {
      case 'title':
        return collator.compare(a.title.trim(), b.title.trim());
      case 'wordCount':
        return a.wordCount - b.wordCount;
      default:
        return a[sort.field] - b[sort.field];
    }
  };
  return [...notes].sort((a, b) => sign * compare(a, b) || b.updatedAt - a.updatedAt);
}

export const NOTE_EXCERPT_LENGTH = 240;

export function noteExcerpt(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTE_EXCERPT_LENGTH);
}

export function countWords(markdown: string): number {
  const words = markdown.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/** One saved version of a note body (S3 object version), newest first in lists. */
export interface NoteVersion {
  versionId: string;
  savedAt: number;
  size: number;
  isLatest: boolean;
}
