import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ImportExamService } from '../../core/services/import-exam.service';
import { PacksService } from '../../core/services/packs.service';
import { ImportJob, isImportJobTerminal } from '../../core/models/import-job.model';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';

const ACCEPTED_EXTENSIONS = ['.pdf', '.md', '.zip', '.html', '.htm'];

@Component({
  selector: 'app-import-exam',
  standalone: true,
  imports: [FormsModule, AiDisclaimerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="import-card">
      <p class="subtitle">
        Upload one or more exam files (PDF, Markdown, or a ZIP with a
        Markdown file + an <code>img/</code> folder). Nothing is extracted
        until you pick which uploaded files to process.
      </p>

      <label class="field">
        <span class="field-label">Target pack</span>
        <select
          class="select-input"
          [ngModel]="selectedPackId()"
          (ngModelChange)="selectedPackId.set($event)"
          aria-label="Target pack for imported questions"
        >
          @for (pack of packs(); track pack.id) {
            <option [value]="pack.id">{{ pack.name }}</option>
          }
        </select>
      </label>

      <label class="field">
        <span class="field-label">Add exam file</span>
        <input
          #fileInput
          type="file"
          class="file-input"
          accept=".pdf,.md,.zip,.html,.htm"
          (change)="onFileSelected($event)"
          aria-label="Exam file to upload"
        />
      </label>

      @if (uploadProgress(); as up) {
        <div class="upload-progress">
          <p class="progress-line">Uploading {{ up.filename }}… {{ up.pct }}%</p>
          <div class="progress-track"><div class="progress-fill" [style.width.%]="up.pct"></div></div>
        </div>
      } @else {
        <button
          type="button"
          class="generate-btn"
          (click)="onUpload(fileInput)"
          [disabled]="!selectedFile() || !selectedPackId()"
        >Upload file</button>
      }

      @if (error()) {
        <p class="error-line" role="alert">{{ error() }}</p>
      }

      @if (readyJobs().length > 0) {
        <div class="job-section">
          <h3>Ready to process</h3>
          @for (job of readyJobs(); track job.id) {
            <label class="job-check-row">
              <input type="checkbox" [checked]="isChecked(job.id)" (change)="toggleChecked(job.id)" />
              <span class="job-filename">{{ job.filename }}</span>
            </label>
          }
          <button
            type="button"
            class="generate-btn"
            (click)="onProcessSelected()"
            [disabled]="checkedJobIds().size === 0"
          >Process selected ({{ checkedJobIds().size }})</button>
        </div>
      }

      @if (activeJobs().length > 0) {
        <div class="job-section">
          <h3>Processing</h3>
          @for (job of activeJobs(); track job.id) {
            <div class="job-status processing">
              <div class="job-status-header">
                <span class="job-filename">{{ job.filename }}</span>
                <span class="job-badge">Processing</span>
              </div>
              @if (job.totalQuestions) {
                <div class="progress-track"><div class="progress-fill" [style.width.%]="progressPct(job)"></div></div>
                <p class="progress-line">{{ job.processedCount }} of {{ job.totalQuestions }} processed</p>
              } @else {
                <p class="progress-line">Starting — detecting questions…</p>
              }
            </div>
          }
        </div>
      }

      @if (doneJobs().length > 0) {
        <div class="job-section">
          <div class="job-section-header">
            <h3>Recent</h3>
            <button type="button" class="btn-ghost-sm" (click)="onClearHistory()">Clear history</button>
          </div>
          @for (job of doneJobs(); track job.id) {
            <div class="job-status" [class]="job.status.toLowerCase()">
              <div class="job-status-header">
                <span class="job-filename">{{ job.filename }}</span>
                <span class="job-badge">{{ statusLabel(job.status) }}</span>
              </div>
              @if (job.failedCount > 0) {
                <p class="warn-line">{{ job.failedCount }} question(s) failed to extract.</p>
              }
              @if (job.error) {
                <p class="error-line">{{ job.error }}</p>
              }
              <div class="job-actions">
                @if (job.status !== 'SUCCEEDED') {
                  <button type="button" class="btn-ghost-sm" (click)="onRetry(job.id)">Retry</button>
                }
                @if (job.failures && job.failures.length > 0) {
                  <button type="button" class="btn-ghost-sm" (click)="onDownloadReport(job)">Download report</button>
                }
              </div>
            </div>
          }
        </div>
      }

      <app-ai-disclaimer
        message="Extraction is performed by AI and may misread a question or its correct answer. Review imported questions before relying on them."
      />
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .import-card { display: flex; flex-direction: column; gap: var(--space-md); }
      .subtitle { color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; }
      .subtitle code { background: var(--bg-elevated); padding: 1px 5px; border-radius: var(--radius-sm); }

      .field { display: flex; flex-direction: column; gap: var(--space-xs); }
      .field-label { font-size: var(--font-size-sm); color: var(--text-muted); }
      .select-input, .file-input {
        min-height: var(--touch-min); padding: 0 var(--space-md); border-radius: var(--radius-md);
        border: 1px solid var(--bg-border); background: var(--bg-input); color: var(--text-primary);
        font-size: var(--font-size-base); font-family: var(--font-family);
      }
      .file-input { padding: var(--space-sm) var(--space-md); }
      .select-input:focus-visible { outline: none; border-color: var(--color-purple); }

      .generate-btn {
        display: inline-flex; align-items: center; justify-content: center; width: 100%;
        min-height: 48px; padding: 0 var(--space-lg); border-radius: var(--radius-md);
        background: linear-gradient(135deg, var(--color-purple), var(--color-blue));
        color: #ffffff; font-weight: 600; font-size: var(--font-size-lg);
      }
      .generate-btn:disabled { opacity: 0.55; cursor: not-allowed; }

      .error-line { color: var(--color-red); font-size: var(--font-size-sm); }
      .warn-line { color: var(--color-amber); font-size: var(--font-size-sm); }

      .upload-progress { display: flex; flex-direction: column; gap: var(--space-xs); }

      .job-section { display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md); border-radius: var(--radius-md); background: var(--bg-elevated); border: 1px solid var(--bg-border); }
      .job-section h3 { font-size: var(--font-size-sm); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0; }
      .job-section-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }

      .job-check-row { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) 0; cursor: pointer; }
      .job-check-row input { width: 18px; height: 18px; cursor: pointer; }

      .job-filename { font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .job-status { display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-sm); border-radius: var(--radius-md); background: var(--bg-surface); border: 1px solid var(--bg-border); }
      .job-status-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
      .job-badge { font-size: var(--font-size-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); background: var(--bg-input); padding: 2px var(--space-sm); border-radius: var(--radius-pill); white-space: nowrap; }
      .job-status.succeeded .job-badge { color: var(--color-green); }
      .job-status.partial .job-badge { color: var(--color-amber); }
      .job-status.failed .job-badge { color: var(--color-red); }

      .progress-track { height: 6px; border-radius: 999px; background: var(--bg-border); overflow: hidden; }
      .progress-fill { height: 100%; background: linear-gradient(135deg, var(--color-purple), var(--color-blue)); border-radius: 999px; transition: width 300ms ease; }
      .progress-line { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0; }

      .job-actions { display: flex; gap: var(--space-sm); }
      .btn-ghost-sm { align-self: flex-start; padding: 0 var(--space-md); min-height: 36px; border-radius: var(--radius-md); border: 1px solid var(--bg-border); background: transparent; color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: 500; }
      .btn-ghost-sm:hover { border-color: var(--color-purple); color: var(--text-primary); }
    `,
  ],
})
export class ImportExamComponent {
  private readonly importService = inject(ImportExamService);
  private readonly packsService = inject(PacksService);

  protected readonly packs = this.packsService.packs;
  protected readonly selectedPackId = signal('');

  protected readonly selectedFile = signal<File | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly checkedJobIds = signal<ReadonlySet<string>>(new Set());

  readonly uploadProgress = this.importService.uploadProgress;

  private readonly jobsForPack = computed(() =>
    this.importService.jobs().filter((j) => j.packId === this.selectedPackId()),
  );
  protected readonly readyJobs = computed(() => this.jobsForPack().filter((j) => j.status === 'UPLOADED'));
  protected readonly activeJobs = computed(() => this.jobsForPack().filter((j) => j.status === 'PROCESSING'));
  protected readonly doneJobs = computed(() =>
    this.jobsForPack()
      .filter((j) => isImportJobTerminal(j))
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
  );

  constructor() {
    this.selectedPackId.set(this.packsService.activePack().id);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.error.set(null);
    if (file && !ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      this.error.set('File must be a .pdf, .md, .html, or .zip file.');
      this.selectedFile.set(null);
      return;
    }
    this.selectedFile.set(file);
  }

  async onUpload(fileInput: HTMLInputElement): Promise<void> {
    const file = this.selectedFile();
    const packId = this.selectedPackId();
    if (!file || !packId) return;
    this.error.set(null);
    const result = await this.importService.uploadFile(packId, file);
    if ('error' in result) {
      this.error.set(result.error);
    } else {
      this.selectedFile.set(null);
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

  async onClearHistory(): Promise<void> {
    await this.importService.clearHistory(this.doneJobs().map((j) => j.id));
  }

  onDownloadReport(job: ImportJob): void {
    const lines = [
      `Import report — ${job.filename}`,
      `Status: ${this.statusLabel(job.status)}`,
      `${job.processedCount} of ${job.totalQuestions ?? job.processedCount} processed, ${job.failedCount} failed`,
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

  progressPct(job: Pick<ImportJob, 'processedCount' | 'totalQuestions'>): number {
    if (!job.totalQuestions) return 0;
    return Math.min(100, (job.processedCount / job.totalQuestions) * 100);
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'SUCCEEDED':
        return 'Done';
      case 'PARTIAL':
        return 'Done (partial)';
      case 'FAILED':
        return 'Failed';
      default:
        return status;
    }
  }
}
