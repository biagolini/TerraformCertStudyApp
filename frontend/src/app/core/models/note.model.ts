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
