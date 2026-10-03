/**
 * One source of questions inside a certification: a practice exam, an
 * instructor's set, the user's own hand-written questions. Persisted as
 * `BANK#{id}` in the general table; every `Question` points at exactly one
 * bank through `bankId`.
 */
export interface QuestionBank {
  id: string;
  /** The certification (Pack) this bank belongs to. */
  packId: string;
  name: string;
  /** Who wrote it (instructor, vendor, "Me"). Used to group banks in the UI. */
  author: string;
  version: string;
  /** Link to the original material, if any. */
  sourceUrl: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export type QuestionBankDraft = Pick<QuestionBank, 'name' | 'author' | 'version' | 'sourceUrl' | 'description'>;

export const EMPTY_BANK_DRAFT: QuestionBankDraft = { name: '', author: '', version: '', sourceUrl: '', description: '' };
