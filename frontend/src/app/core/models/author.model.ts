/**
 * Who writes question banks — an instructor, a publisher, or "Me". Shared by
 * every certification, persisted as `AUTHOR#{id}`. Banks keep the author's
 * name as plain text (`QuestionBank.author`), so renaming an author rewrites
 * the name on its banks, and deleting one reassigns them first.
 */
export interface BankAuthor {
  id: string;
  name: string;
  /** Website or profile link, if any. */
  url: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export type BankAuthorDraft = Pick<BankAuthor, 'name' | 'url' | 'notes'>;

export const EMPTY_AUTHOR_DRAFT: BankAuthorDraft = { name: '', url: '', notes: '' };

/** Names compare trimmed and case-insensitively, so "me" and "Me " are the same author. */
export function sameAuthorName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}
