export type ImportJobStatus =
  | 'AWAITING_UPLOAD'
  | 'UPLOADED'
  | 'EXTRACTING'
  | 'AWAITING_REVIEW'
  | 'GENERATING'
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'FAILED';

export interface ImportJobFailure {
  index: number | null;
  error: string;
  preview: string | null;
  /** Only set for a Phase 2 (AI-refine) failure — the CloudWatch request id
   * that identifies exactly which import-explain invocation produced this
   * failure, so its real logs can be looked up (see ImportReviewService.
   * getDraftLogs). Null for Phase 1 (structure-extraction) failures. */
  requestId?: string | null;
}

export interface ImportJob {
  id: string;
  packId: string;
  filename: string;
  status: ImportJobStatus;
  totalQuestions: number | null;
  /** Optional soft hint from the upload form — shown back as a mismatch
   * warning on the review screen if it differs from totalQuestions, never
   * validated or enforced anywhere in the pipeline. */
  expectedQuestions?: number | null;
  /** Set when Phase 2 (explanation generation) starts — the denominator
   * for its progress bar, distinct from totalQuestions (Phase 1's). */
  explainTotal?: number | null;
  processedCount: number;
  failedCount: number;
  createdAt: number;
  completedAt: number | null;
  error: string | null;
  failures?: ImportJobFailure[];
}

/** Worth polling for further backend-driven change — only true once one of
 * the two pipeline phases has actually started; UPLOADED and
 * AWAITING_REVIEW just wait on the user. */
export function isImportJobRunning(job: Pick<ImportJob, 'status'>): boolean {
  return job.status === 'EXTRACTING' || job.status === 'GENERATING';
}

export function isImportJobTerminal(job: Pick<ImportJob, 'status'>): boolean {
  return job.status === 'SUCCEEDED' || job.status === 'PARTIAL' || job.status === 'FAILED';
}
