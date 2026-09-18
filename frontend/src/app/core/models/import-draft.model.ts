/** A structure-only extraction result awaiting human review before Phase 2
 * (explanation generation) — see backend/infrastructure/lambda/import_extract
 * (writes these) and lambda/import_explain (consumes them, on approval).
 * Deliberately a separate, smaller shape from Question — no final `comment`,
 * `generalComment`, or `metadata` fields exist yet at this stage; the
 * `source*` fields below are raw, unverified explanation text lifted
 * straight from the exam source material during extraction (when present),
 * kept only as reference material for Phase 2's review agent to ground
 * itself in — never the final text a promoted Question ships with. */

export interface ImportDraftAlternative {
  letter: string;
  text: string;
  isCorrect: boolean;
  /** Raw explanation the ORIGINAL exam source already provided for this
   * option, if any (e.g. an "Explanation" box directly under it) —
   * captured during Phase 1 extraction as reference material for Phase 2's
   * review agent, which verifies/rewrites it rather than relaying it as-is.
   * Not the final `comment` a promoted Question ships with. */
  sourceComment?: string | null;
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
  /** Images sent to the extraction model but not referenced inline in the
   * stem or any alternative — e.g. merely-illustrative images the model
   * was told to omit from the question text itself. Surfaced here purely
   * for visibility during review; they are never carried into the final
   * Question (Phase 2 only ever sees this draft's stem/alternatives, not
   * the original images). Keys are `{jobId}/{questionId}/{filename}`,
   * resolved the same way as any other question image. */
  referenceImages?: string[];
  /** Raw overall explanation the source provided, not attributable to one
   * specific option (e.g. an "Overall explanation" block after all
   * options) — same "reference material for Phase 2" role as
   * alternatives[].sourceComment, not the final `generalComment`. */
  sourceGeneralComment?: string | null;
  error: string | null;
  preview: string | null;
  promoted: boolean;
  reExtractCount: number;
  lastHint: string | null;
  createdAt: number;
  updatedAt: number;
}
