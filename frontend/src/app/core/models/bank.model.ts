/**
 * A question bank is one practice exam (or question set) for the
 * certification it belongs to. It is identified by who wrote it and which
 * version it is; the certification itself comes from the workspace URL
 * (`packId`), so the user never types it. Persisted as `BANK#{id}` in the
 * general table; every `Question` points at exactly one bank via `bankId`.
 */
export interface QuestionBank {
  id: string;
  /** The certification (Pack) this bank belongs to, taken from the workspace context. */
  packId: string;
  /** Instructor, vendor or "Me". Required when the user creates a bank. */
  author: string;
  /** Which practice exam or edition, e.g. "Practice exam 2", "v3". */
  version: string;
  /** Link to the original material, if any. */
  sourceUrl: string;
  /** Free notes about the bank. */
  description: string;
  createdAt: number;
  updatedAt: number;
}

export type QuestionBankDraft = Pick<QuestionBank, 'author' | 'version' | 'sourceUrl' | 'description'>;

export const EMPTY_BANK_DRAFT: QuestionBankDraft = { author: '', version: '', sourceUrl: '', description: '' };

/** Display label derived from author and version; `fallback` (translated by the caller) when both are empty. */
export function bankLabel(bank: Pick<QuestionBank, 'author' | 'version'>, fallback: string): string {
  const parts = [bank.author.trim(), bank.version.trim()].filter(Boolean);
  return parts.length ? parts.join(' · ') : fallback;
}
