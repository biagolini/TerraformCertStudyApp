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

export type BankSortField = 'name' | 'questions' | 'updatedAt';
export type BankSortDir = 'asc' | 'desc';
export interface BankSort {
  field: BankSortField;
  dir: BankSortDir;
}
export const BANK_SORT_FIELDS: BankSortField[] = ['name', 'questions', 'updatedAt'];
/** Banks open by name, A to Z (names compare in natural order: "Set 2" before "Set 10"). */
export const DEFAULT_BANK_SORT: BankSort = { field: 'name', dir: 'asc' };

/** Banks in the chosen order; ties fall back to the name, so the order is stable. */
export function sortBanks<T extends { bank: QuestionBank; total: number }>(items: readonly T[], sort: BankSort, locale: string): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const byName = (a: T, b: T) => collator.compare((a.bank.version ?? '').trim(), (b.bank.version ?? '').trim());
  const compare = (a: T, b: T): number =>
    sort.field === 'questions' ? a.total - b.total : sort.field === 'updatedAt' ? a.bank.updatedAt - b.bank.updatedAt : byName(a, b);
  return [...items].sort((a, b) => sign * compare(a, b) || byName(a, b));
}
