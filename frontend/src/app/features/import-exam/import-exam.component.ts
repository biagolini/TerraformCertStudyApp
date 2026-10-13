import { IconComponent } from '../../shared/components/icon.component';
import { QuestionBank, bankLabel } from '../../core/models/bank.model';
import { importPath } from '../../core/utils/routes.util';
import { BanksService } from '../../core/services/banks.service';
import { StorageService } from '../../core/services/storage.service';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { ImportExamService } from '../../core/services/import-exam.service';
import { ImportJob, isImportJobTerminal } from '../../core/models/import-job.model';
import { ImportJobProgressComponent } from '../../shared/components/import-job-progress.component';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { ConfirmDeleteDialogComponent } from '../../shared/components/confirm-delete-dialog.component';
import { I18nService } from '../../core/i18n/i18n.service';

const ACCEPTED_EXTENSIONS = ['.pdf', '.md', '.zip', '.html', '.htm'];

@Component({
  selector: 'app-import-exam',
  standalone: true,
  imports: [IconComponent, FormsModule, AiDisclaimerComponent, ImportJobProgressComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="import-card">
      <p class="subtitle">{{ i18n.t('importExam.subtitle') }}</p>

      @if (importService.loading()) {
        <p class="status-line">{{ i18n.t('common.loading') }}</p>
      }

      <label class="ui-field">
        <span>{{ i18n.t('importExam.addExamFile') }}</span>
        <input
          #fileInput
          type="file"
          class="ui-input file-input"
          accept=".pdf,.md,.zip,.html,.htm"
          (change)="onFileSelected($event)"
          [attr.aria-label]="i18n.t('importExam.examFileToUpload')"
        />
      </label>

      @if (duplicate(); as dup) {
        <p class="warn-line" role="status">
          {{ dup.sameBank ? i18n.t('importExam.duplicateSameBank') : i18n.t('importExam.duplicateOtherBank', { bank: dup.bankLabel }) }}
        </p>
      }

      <label class="ui-field">
        <span>{{ i18n.t('importExam.expectedQuestionsOptional') }}</span>
        <input
          type="number"
          class="ui-input"
          min="1"
          placeholder="e.g. 75"
          [ngModel]="expectedQuestions()"
          (ngModelChange)="expectedQuestions.set($event)"
          [attr.aria-label]="i18n.t('importExam.expectedQuestionsAriaLabel')"
        />
      </label>

      @if (uploadProgress(); as up) {
        <div class="upload-progress">
          <p class="progress-line">{{ i18n.t('importExam.uploading', { filename: up.filename, pct: up.pct }) }}</p>
          <div class="ui-progress bar"><span [style.width.%]="up.pct"></span></div>
        </div>
      } @else {
        <button
          type="button"
          class="ui-btn ui-btn-primary wide"
          (click)="onUpload(fileInput)"
          [disabled]="!selectedFile()"
        >{{ i18n.t('importExam.uploadFile') }}</button>
      }

      @if (error()) {
        <p class="error-line" role="alert">{{ error() }}</p>
      }

      @if (readyJobs().length > 0) {
        <div class="job-section">
          <h3>{{ i18n.t('importExam.readyToProcess') }}</h3>
          @for (job of readyJobs(); track job.id) {
            <div class="job-check-row">
              <label class="job-check-label">
                <input type="checkbox" [checked]="isChecked(job.id)" (change)="toggleChecked(job.id)" />
                <span class="job-filename">{{ job.filename }}</span>
              </label>
              <input
                type="number"
                class="ui-input job-expected-input"
                min="1"
                [placeholder]="i18n.t('importExam.expectedHash')"
                [attr.aria-label]="i18n.t('importExam.expectedQuestionsIn', { filename: job.filename })"
                [ngModel]="job.expectedQuestions"
                (change)="onUpdateExpectedQuestions(job.id, $event)"
              />
            </div>
          }
          <button
            type="button"
            class="ui-btn ui-btn-primary wide"
            (click)="onProcessSelected()"
            [disabled]="checkedJobIds().size === 0"
          >{{ i18n.t('importExam.processSelected', { count: checkedJobIds().size }) }}</button>
        </div>
      }

      @if (activeJobs().length > 0) {
        <div class="job-section">
          <h3>{{ i18n.t('importExam.processing') }}</h3>
          @for (job of activeJobs(); track job.id) {
            <div class="job-status processing">
              <span class="job-filename">{{ job.filename }}</span>
              <app-import-job-progress [job]="job" />
            </div>
          }
        </div>
      }

      @if (awaitingReviewJobs().length > 0) {
        <div class="job-section">
          <h3>{{ i18n.t('importExam.readyToReview') }}</h3>
          @for (job of awaitingReviewJobs(); track job.id) {
            <div class="job-status">
              <div class="job-status-header">
                <span class="job-filename">{{ job.filename }}</span>
                <span class="job-badge">{{ i18n.t('importExam.extractedCount', { count: job.totalQuestions }) }}</span>
              </div>
              @if (job.failedCount > 0) {
                <p class="warn-line">{{ i18n.t('importExam.needAttention', { count: job.failedCount }) }}</p>
              }
              <div class="job-actions">
                <button type="button" class="ui-btn ui-btn-sm" (click)="onReview(job)">{{ i18n.t('importExam.reviewCount', { count: job.totalQuestions }) }}</button>
                <button type="button" class="ui-btn ui-btn-sm" [disabled]="openingOriginal() === job.id" (click)="onViewOriginal(job)">
                  {{ openingOriginal() === job.id ? i18n.t('importExam.opening') : i18n.t('importExam.viewOriginal') }} <app-icon name="external-link" size="14" />
                </button>
                <button type="button" class="ui-btn ui-btn-sm" (click)="onDeleteJob(job)">{{ i18n.t('common.delete') }}</button>
              </div>
              @if (originalFileError()?.jobId === job.id) {
                <p class="error-line">{{ originalFileError()!.message }}</p>
              }
            </div>
          }
        </div>
      }

      @if (doneJobs().length > 0) {
        <div class="job-section">
          <div class="job-section-header">
            <h3>{{ i18n.t('importExam.recent') }}</h3>
            <button type="button" class="ui-btn ui-btn-sm" (click)="onClearHistory()">{{ i18n.t('importExam.clearHistory') }}</button>
          </div>
          @for (job of doneJobs(); track job.id) {
            <div class="job-status" [class]="'job-status ' + job.status.toLowerCase()">
              <div class="job-status-header">
                <span class="job-filename">{{ job.filename }}</span>
                <span class="job-badge">{{ statusLabel(job.status) }}</span>
              </div>
              @if (job.failedCount > 0) {
                <p class="warn-line">{{ i18n.t('importExam.failedToGenerate', { count: job.failedCount }) }}</p>
              }
              @if (job.error) {
                <p class="error-line">{{ job.error }}</p>
              }
              <div class="job-actions">
                @if (canReview(job)) {
                  <button type="button" class="ui-btn ui-btn-sm" (click)="onReview(job)">{{ i18n.t('importExam.reviewQuestions') }}</button>
                } @else if (job.status === 'FAILED') {
                  <button type="button" class="ui-btn ui-btn-sm" (click)="onRetry(job.id)">{{ i18n.t('common.retry') }}</button>
                }
                @if (job.failures && job.failures.length > 0) {
                  <button type="button" class="ui-btn ui-btn-sm" (click)="onDownloadReport(job)">{{ i18n.t('importExam.downloadReport') }}</button>
                }
              </div>
            </div>
          }
        </div>
      }

      <app-ai-disclaimer
        [message]="i18n.t('importExam.aiDisclaimer')"
      />
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .import-card { display: flex; flex-direction: column; gap: var(--space-md); }
      .subtitle { color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; }
      .subtitle code { background: var(--bg-elevated); padding: 1px 5px; border-radius: var(--radius-sm); }

      .file-input { padding: var(--space-xs) var(--space-sm); }
      .file-input::file-selector-button {
        margin-right: var(--space-md); height: 30px; padding: 0 var(--space-md);
        border-radius: var(--radius-md); border: 1px solid var(--bg-border);
        background: var(--bg-elevated); color: var(--text-primary);
        font-size: var(--font-size-sm); font-weight: 600; font-family: var(--font-family);
        cursor: pointer;
      }
      .file-input::file-selector-button:hover { border-color: var(--color-purple); }
      .wide { width: 100%; }

      .error-line { color: var(--color-red); font-size: var(--font-size-sm); }
      .warn-line { color: var(--color-amber); font-size: var(--font-size-sm); }
      .status-line { color: var(--text-muted); font-size: var(--font-size-sm); }

      .upload-progress { display: flex; flex-direction: column; gap: var(--space-xs); }

      .job-section { display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md); border-radius: var(--radius-md); background: var(--bg-input); border: 1px solid var(--bg-border); }
      .job-section h3 { font-size: var(--font-size-sm); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0; }
      .job-section-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }

      .job-check-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); padding: var(--space-xs) 0; }
      .job-check-label { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; cursor: pointer; }
      .job-check-row input[type='checkbox'] { width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; }
      .job-expected-input { width: 100px; flex-shrink: 0; min-height: 32px; }

      .job-filename { font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .job-status { display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-sm); border-radius: var(--radius-md); background: var(--bg-surface); border: 1px solid var(--bg-border); }
      .job-status-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
      .job-badge { font-size: var(--font-size-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); background: var(--bg-input); padding: 2px var(--space-sm); border-radius: var(--radius-pill); white-space: nowrap; }
      .job-status.succeeded .job-badge { color: var(--color-green); }
      .job-status.partial .job-badge { color: var(--color-amber); }
      .job-status.failed .job-badge { color: var(--color-red); }

      .bar { flex: 1; }
      .progress-line { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0; }

      .job-actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
    `,
  ],
})
export class ImportExamComponent {
  protected readonly importService = inject(ImportExamService);
  private readonly router = inject(Router);
  private readonly banks = inject(BanksService);
  private readonly storage = inject(StorageService);
  private readonly dialog = inject(MatDialog);
  protected readonly i18n = inject(I18nService);

  /** Source of truth for "which pack" — the route, exactly like
   * questions-page.component.ts. Switching to a different pack now means
   * switching the active pack (header switcher) and clicking Import again,
   * same as it works for Questions — no separate in-page target-pack
   * selector to keep in sync with the URL any more. */
  readonly packId = input.required<string>();
  /** The practice exam (bank) every file uploaded here lands in — fixed by the route. */
  readonly bankId = input.required<string>();

  label(bank: QuestionBank): string {
    return bankLabel(bank, this.i18n.t('banks.untitled'));
  }

  protected readonly selectedFile = signal<File | null>(null);
  protected readonly expectedQuestions = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly checkedJobIds = signal<ReadonlySet<string>>(new Set());
  protected readonly openingOriginal = signal<string | null>(null);
  protected readonly originalFileError = signal<{ jobId: string; message: string } | null>(null);

  readonly uploadProgress = this.importService.uploadProgress;

  private readonly jobsForPack = computed(() =>
    this.importService.jobs().filter((j) => j.packId === this.packId() && j.bankId === this.bankId()),
  );

  /** The chosen file was already uploaded, here or into another practice exam
   * of this certification — usually an accident, so say so before uploading. */
  protected readonly duplicate = computed(() => {
    const file = this.selectedFile();
    if (!file) return null;
    const earlier = this.importService.jobs().find((j) => j.packId === this.packId() && j.filename === file.name);
    if (!earlier) return null;
    const bank = this.banks.getById(earlier.bankId);
    return { sameBank: earlier.bankId === this.bankId(), bankLabel: bank ? this.label(bank) : earlier.filename };
  });
  protected readonly readyJobs = computed(() => this.jobsForPack().filter((j) => j.status === 'UPLOADED'));
  /** Ready files the user has seen here; a new one starts checked, so "Process selected" works right away. */
  private readonly seenReady = new Set<string>();

  constructor() {
    effect(() => {
      const fresh = this.readyJobs().filter((j) => !this.seenReady.has(j.id));
      if (fresh.length === 0) return;
      fresh.forEach((j) => this.seenReady.add(j.id));
      untracked(() => this.checkedJobIds.set(new Set([...this.checkedJobIds(), ...fresh.map((j) => j.id)])));
    });
  }
  protected readonly activeJobs = computed(() =>
    this.jobsForPack().filter((j) => j.status === 'EXTRACTING' || j.status === 'GENERATING'),
  );
  protected readonly awaitingReviewJobs = computed(() =>
    this.jobsForPack().filter((j) => j.status === 'AWAITING_REVIEW'),
  );
  protected readonly doneJobs = computed(() =>
    this.jobsForPack()
      .filter((j) => isImportJobTerminal(j))
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
  );


  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.error.set(null);
    if (file && !ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      this.error.set(this.i18n.t('importExam.fileMustBeType'));
      this.selectedFile.set(null);
      return;
    }
    this.selectedFile.set(file);
  }

  async onUpload(fileInput: HTMLInputElement): Promise<void> {
    const file = this.selectedFile();
    const packId = this.packId();
    if (!file || !packId) return;
    this.error.set(null);
    const bankId = this.bankId();
    if (this.banks.getById(bankId)?.packId !== packId) {
      this.error.set(this.i18n.t('importExam.bankMissing'));
      return;
    }
    // create_import validates the bank server-side, so a bank created a
    // moment ago must not still be sitting in the 500ms write debounce.
    await this.storage.flushPendingSync();
    const result = await this.importService.uploadFile(packId, bankId, file, this.expectedQuestions() ?? undefined);
    if ('error' in result) {
      this.error.set(result.error);
    } else {
      this.selectedFile.set(null);
      this.expectedQuestions.set(null);
      fileInput.value = '';
    }
  }

  isChecked(jobId: string): boolean {
    return this.checkedJobIds().has(jobId);
  }

  toggleChecked(jobId: string): void {
    const next = new Set(this.checkedJobIds());
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    this.checkedJobIds.set(next);
  }

  async onProcessSelected(): Promise<void> {
    const ids = [...this.checkedJobIds()];
    if (ids.length === 0) return;
    this.checkedJobIds.set(new Set());
    await this.importService.processJobs(ids);
  }

  async onRetry(jobId: string): Promise<void> {
    await this.importService.processJobs([jobId]);
  }

  async onUpdateExpectedQuestions(jobId: string, event: Event): Promise<void> {
    const raw = (event.target as HTMLInputElement).value.trim();
    const parsed = raw ? parseInt(raw, 10) : NaN;
    const result = await this.importService.updateExpectedQuestions(
      jobId,
      Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    );
    if (result.error) this.error.set(result.error);
  }

  onReview(job: ImportJob): void {
    this.router.navigate(importPath(job.packId, job.bankId, job.id));
  }

  /** Deletes one job outright — used for "Ready to review"/"Ready to
   * process" jobs the user wants to discard before they ever reach
   * "Recent" (which has its own bulk "Clear history"). Same DELETE route
   * either way; the backend also purges that job's uploads/scratch S3
   * content immediately rather than waiting on the bucket's lifecycle rule. */
  /** Re-opens the exact file the user uploaded in a new tab — deliberately
   * not part of the review screen itself (a separate window is easier to
   * flip back to while fixing a question than something wedged into that
   * page). Only works within the uploads/ prefix's 2-day lifecycle. */
  async onViewOriginal(job: ImportJob): Promise<void> {
    this.originalFileError.set(null);
    this.openingOriginal.set(job.id);
    try {
      const result = await this.importService.getOriginalFileUrl(job.id);
      if (result.error) {
        this.originalFileError.set({ jobId: job.id, message: result.error });
        return;
      }
      window.open(result.url, '_blank', 'noopener');
    } finally {
      this.openingOriginal.set(null);
    }
  }

  onDeleteJob(job: ImportJob): void {
    const dialogRef = this.dialog.open(ConfirmDeleteDialogComponent, {
      data: { title: job.filename },
      width: '400px',
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result !== 'confirm') return;
      void this.importService.clearHistory([job.id]);
    });
  }

  /** A job whose Phase 1 got far enough to produce draft rows (totalQuestions
   * set) always has a review screen worth visiting — including a fully
   * SUCCEEDED one: the review screen now doubles as a durable audit view of
   * every question the job produced (see import-review-page.component.ts),
   * not just a queue that's only reachable while something's still
   * unresolved. Previously excluding SUCCEEDED here meant that fixing the
   * very last flagged question made the review link vanish forever, with
   * no way back in even to confirm everything actually landed. A FAILED job
   * with no drafts at all (Phase 1 failed before producing any chunks) has
   * nothing to review — plain Retry restarts it instead. */
  canReview(job: ImportJob): boolean {
    return job.totalQuestions != null;
  }

  async onClearHistory(): Promise<void> {
    await this.importService.clearHistory(this.doneJobs().map((j) => j.id));
  }

  onDownloadReport(job: ImportJob): void {
    const lines = [
      `Import report — ${job.filename}`,
      `Status: ${this.statusLabel(job.status)}`,
      `${job.processedCount} of ${job.explainTotal ?? job.totalQuestions ?? job.processedCount} processed, ${job.failedCount} failed`,
      '',
      'Failed questions:',
      ...(job.failures ?? []).map((f) => {
        const label = f.index === null || f.index === undefined ? 'Unknown position' : `Question #${f.index + 1}`;
        const preview = f.preview ? `\n    "${f.preview}"` : '';
        return `- ${label}: ${f.error}${preview}`;
      }),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${job.filename}-import-report.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'SUCCEEDED':
        return this.i18n.t('importExam.statusDone');
      case 'PARTIAL':
        return this.i18n.t('importExam.statusDonePartial');
      case 'FAILED':
        return this.i18n.t('importExam.statusFailed');
      default:
        return status;
    }
  }
}
