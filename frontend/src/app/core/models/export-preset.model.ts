/** Which questions of the chosen mock exams to export. */
export type ExportAttemptFilter = 'all' | 'wrong' | 'flagged' | 'wrongOrFlagged';
export type ExportBankFilter = 'all' | 'starred';
export type ExportSource = 'banks' | 'attempts';

/**
 * The Export page's last configuration for one certification, restored when
 * the page opens so exporting the next mock exam only means ticking a
 * different attempt. Hand-picked questions are deliberately not kept: they
 * belong to one specific set of attempts. Ids that no longer exist (deleted
 * bank, attempt) are simply ignored on restore.
 */
export interface ExportPreset {
  source: ExportSource;
  bankIds: string[];
  attemptIds: string[];
  filterOn: boolean;
  attemptFilter: ExportAttemptFilter;
  bankFilter: ExportBankFilter;
  domains: string[];
  splitBySize: boolean;
  maxPerFile: number;
  splitByDomain: boolean;
  includeAnswers: boolean;
  /** Custom file name prefix; empty = the generated default. Optional: presets saved before it existed lack it. */
  filePrefix?: string;
  /** Leave out questions with nothing selected (mock exams source). Optional: older presets lack it. */
  excludeUnanswered?: boolean;
  /** Per mock exam question range (1-based, either bound optional), keyed by attempt id. */
  attemptRanges?: Record<string, { from: number | null; to: number | null }>;
}
