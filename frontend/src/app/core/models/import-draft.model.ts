/** A structure-only extraction result awaiting human review before Phase 2
 * (explanation generation) — see backend/infrastructure/lambda/import_extract
 * (writes these) and lambda/import_explain (consumes them, on approval).
 * Deliberately a separate, smaller shape from Question — no `comment`,
 * `generalComment`, or `metadata` fields exist yet at this stage. */

export interface ImportDraftAlternative {
  letter: string;
  text: string;
  isCorrect: boolean;
}

export interface ImportDraftQuestion {
  jobId: string;
  index: number;
  packId: string;
  extractStatus: 'SUCCEEDED' | 'FAILED';
  title: string | null;
  domain: string | null;
  stem: string | null;
  alternatives: ImportDraftAlternative[];
  error: string | null;
  preview: string | null;
  promoted: boolean;
  reExtractCount: number;
  lastHint: string | null;
  createdAt: number;
  updatedAt: number;
}
