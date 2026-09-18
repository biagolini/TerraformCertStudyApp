import { Injectable, effect, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ImportJob, isImportJobRunning } from '../models/import-job.model';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';

const POLL_INTERVAL_MS = 15_000;

export interface UploadProgress {
  filename: string;
  pct: number;
}

/** Upload and processing are deliberately separate steps: uploading a file
 * only gets it onto S3 and marks the job UPLOADED — nothing is queued for
 * extraction until the user explicitly picks it via processJobs(). This
 * lets several files build up before the user decides what (and when) to
 * process, and means a page reload never "resurrects" a stuck upload as if
 * it were active work. */
@Injectable({ providedIn: 'root' })
export class ImportExamService {
  private readonly auth = inject(AuthService);
  private readonly storage = inject(StorageService);
  private readonly settings = inject(SettingsService);
  private readonly apiUrl = environment.apiUrl;

  private readonly jobsState = signal<ImportJob[]>([]);
  readonly jobs = this.jobsState.asReadonly();

  private readonly uploadProgressState = signal<UploadProgress | null>(null);
  readonly uploadProgress = this.uploadProgressState.asReadonly();

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor() {
    // Gate on storage.ready() — this service is root-provided and
    // instantiated as soon as the header pill renders, which can happen
    // before login/session-restore completes (an authenticated call before
    // then would redirect to /login as a side effect).
    effect(() => {
      if (this.storage.ready() && !this.initialized) {
        this.initialized = true;
        void this.refreshJobs();
      }
    });
  }

  async refreshJobs(): Promise<void> {
    const jobs = await this.fetchJobs();
    this.jobsState.set(jobs);
    this.syncPolling(jobs);
  }

  /** Creates the job, uploads the file with live progress, then confirms
   * the upload — three explicit steps, none of them start processing.
   * `expectedQuestions` is a soft hint only — shown back as a mismatch
   * warning on the review screen, never validated or enforced. */
  async uploadFile(
    packId: string,
    file: File,
    expectedQuestions?: number,
  ): Promise<{ jobId: string } | { error: string }> {
    try {
      const token = await this.auth.getValidToken();
      const createRes = await fetch(`${this.apiUrl}/data/imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ packId, filename: file.name, expectedQuestions: expectedQuestions ?? null }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}) as { error?: string });
        return { error: body.error || 'Failed to start the upload.' };
      }
      const { jobId, uploadUrl } = (await createRes.json()) as { jobId: string; uploadUrl: string };

      this.uploadProgressState.set({ filename: file.name, pct: 0 });
      try {
        await this.putWithProgress(uploadUrl, file, (pct) =>
          this.uploadProgressState.set({ filename: file.name, pct }),
        );
      } finally {
        this.uploadProgressState.set(null);
      }

      await fetch(`${this.apiUrl}/data/imports/${jobId}/confirm-upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      await this.refreshJobs();
      return { jobId };
    } catch (err) {
      this.uploadProgressState.set(null);
      return { error: err instanceof Error ? err.message : 'Upload failed.' };
    }
  }

  /** Starts extraction for one or more already-UPLOADED (or previously
   * failed) jobs — the explicit action the user takes once they've decided
   * which uploaded files to process. */
  async processJobs(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    const token = await this.auth.getValidToken();
    const modelId = this.settings.importExtractionModel();
    await Promise.all(
      jobIds.map((id) =>
        fetch(`${this.apiUrl}/data/imports/${id}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ modelId }),
        }),
      ),
    );
    await this.refreshJobs();
  }

  /** Edits the expected-question-count hint on a job that hasn't been
   * processed yet — lets the user set it (or fix a typo) after upload,
   * since it's easy to forget before picking the file. Rejected by the
   * backend once the job has moved past UPLOADED. */
  async updateExpectedQuestions(jobId: string, expectedQuestions: number | null): Promise<{ error?: string }> {
    const token = await this.auth.getValidToken();
    const res = await fetch(`${this.apiUrl}/data/imports/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ expectedQuestions }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { error: body.error || 'Failed to update.' };
    }
    await this.refreshJobs();
    return {};
  }

  /** Removes job history entries only — never touches questions already
   * extracted from them (those live independently once saved) or their
   * images. Used by "Clear history" for terminal (done) jobs. */
  async clearHistory(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    const token = await this.auth.getValidToken();
    await Promise.all(
      jobIds.map((id) =>
        fetch(`${this.apiUrl}/data/imports/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }),
      ),
    );
    await this.refreshJobs();
  }

  private putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (HTTP ${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error('Upload failed — network error.'));
      xhr.send(file);
    });
  }

  private async fetchJobs(): Promise<ImportJob[]> {
    try {
      const token = await this.auth.getValidToken();
      const res = await fetch(`${this.apiUrl}/data/imports`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { jobs: ImportJob[] };
      return body.jobs ?? [];
    } catch {
      return [];
    }
  }

  private syncPolling(jobs: ImportJob[]): void {
    const anyRunning = jobs.some((j) => isImportJobRunning(j));
    if (anyRunning && this.pollHandle === null) {
      this.pollHandle = setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS);
    } else if (!anyRunning && this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private async pollOnce(): Promise<void> {
    const wasRunning = new Set(this.jobsState().filter(isImportJobRunning).map((j) => j.id));
    const jobs = await this.fetchJobs();
    this.jobsState.set(jobs);
    this.syncPolling(jobs);

    const justFinishedSuccessfully = jobs.some(
      (j) => wasRunning.has(j.id) && (j.status === 'SUCCEEDED' || j.status === 'PARTIAL'),
    );
    if (justFinishedSuccessfully) {
      // New questions were written directly by backend Lambdas, bypassing
      // this app's own debounced push path — a pull is the only way they
      // show up in QuestionsService.
      void this.storage.refresh();
    }
  }
}
