export type ImportJobStatus =
  | 'AWAITING_UPLOAD'
  | 'UPLOADED'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'FAILED';

export interface ImportJobFailure {
  index: number | null;
  error: string;
  preview: string | null;
}

export interface ImportJob {
  id: string;
  packId: string;
  filename: string;
  status: ImportJobStatus;
  totalQuestions: number | null;
  processedCount: number;
  failedCount: number;
  createdAt: number;
  completedAt: number | null;
  error: string | null;
  failures?: ImportJobFailure[];
}

/** Worth polling for further backend-driven change — only true once the
 * pipeline has actually started; UPLOADED just waits on the user. */
export function isImportJobRunning(job: Pick<ImportJob, 'status'>): boolean {
  return job.status === 'PROCESSING';
}

export function isImportJobTerminal(job: Pick<ImportJob, 'status'>): boolean {
  return job.status === 'SUCCEEDED' || job.status === 'PARTIAL' || job.status === 'FAILED';
}
