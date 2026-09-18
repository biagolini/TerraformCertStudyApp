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

/** Where one extracted image belongs. Deliberately a classification, not an
 * inline `{{IMG:n}}`-style placeholder embedded in the text itself — a
 * separate structured field is both easier for a reviewer to reassign (a
 * dropdown, not hunting for a token buried in a paragraph) and easier for
 * the extraction model to fill correctly (a per-image classification is a
 * much smaller ask than generating correct placeholder syntax inline while
 * also writing the surrounding prose). 'unplaced' covers every image the
 * model couldn't confidently attribute — surfaced for the reviewer to
 * assign by hand rather than silently dropped. */
export type ImportDraftImageTarget =
  | 'stem'
  | 'generalComment'
  | 'alternativeText'
  | 'alternativeComment'
  | 'unplaced';

export interface ImportDraftImage {
  /** Relative key (`{jobId}/{questionId}/{filename}`), resolved via
   * ImageAssetService the same way as any other question image. */
  key: string;
  target: ImportDraftImageTarget;
  /** Set only when target is 'alternativeText' or 'alternativeComment' —
   * which alternative's letter this image belongs to. */
  alternativeLetter?: string | null;
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
  images?: ImportDraftImage[];
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

/** Drafts extracted before the `images` classification scheme shipped only
 * have the old flat `referenceImages: string[]` (no target info at all —
 * every one was effectively "unplaced"). Normalizing on read means an
 * in-flight review job doesn't lose visibility into those images just
 * because it hasn't been re-extracted since. */
export function normalizeDraftImages(draft: ImportDraftQuestion): ImportDraftQuestion {
  if (draft.images && draft.images.length > 0) return draft;
  const legacy = (draft as unknown as { referenceImages?: string[] }).referenceImages;
  if (!legacy || legacy.length === 0) return draft;
  return {
    ...draft,
    images: legacy.map((key) => ({ key, target: 'unplaced' as const, alternativeLetter: null })),
  };
}
