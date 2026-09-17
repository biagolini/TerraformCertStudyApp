import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ImportReviewService } from '../../core/services/import-review.service';
import { ImportExamService } from '../../core/services/import-exam.service';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { ImportDraftItemComponent } from './import-draft-item.component';

/** Routed at /questions/:packId/import/:jobId — reached from
 * import-exam.component.ts's "Review N questions" link, never directly
 * part of the upload tab itself (upload stays exactly where it was; only
 * review gets its own page, per what was actually asked for). Lists one
 * job's structure-only drafts (Phase 1 output) for approval before Phase 2
 * (explanation generation) runs on them. */
@Component({
  selector: 'app-import-review-page',
  standalone: true,
  imports: [ImportDraftItemComponent, AiDisclaimerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="review-card">
      <header class="header">
        <button type="button" class="back-btn" (click)="onBack()" aria-label="Back to questions">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div class="title-block">
          <h2>Review extracted questions</h2>
          @if (job(); as j) {
            <p class="subtitle">{{ j.filename }} — {{ pendingDrafts().length }} awaiting review</p>
          }
        </div>
      </header>

      @if (mismatchWarning(); as warning) {
        <p class="warn-line">{{ warning }}</p>
      }

      @if (loading()) {
        <p class="status-line">Loading…</p>
      } @else if (pendingDrafts().length === 0) {
        <div class="empty">
          <p class="empty-title">Nothing left to review.</p>
          @if (promotedCount() > 0) {
            <p class="empty-body">{{ promotedCount() }} question(s) from this job already have explanations.</p>
          }
          <button type="button" class="btn-ghost-sm" (click)="onBack()">Back to questions</button>
        </div>
      } @else {
        <ul class="list">
          @for (draft of pendingDrafts(); track draft.index) {
            <li>
              <app-import-draft-item
                [draft]="draft"
                [selected]="isSelected(draft.index)"
                [busy]="isBusy(draft.index)"
                (selectionToggled)="toggleSelected(draft.index)"
                (reExtractRequested)="onReExtract(draft.index, $event)"
              />
            </li>
          }
        </ul>

        @if (promotedCount() > 0) {
          <p class="status-line">{{ promotedCount() }} question(s) already generated in an earlier pass.</p>
        }

        @if (error()) {
          <p class="error-line" role="alert">{{ error() }}</p>
        }

        <div class="actions">
          <button
            type="button"
            class="generate-btn secondary"
            [disabled]="selectedIndices().size === 0 || submitting()"
            (click)="onProcessSelected()"
          >Process selected ({{ selectedIndices().size }})</button>
          <button
            type="button"
            class="generate-btn"
            [disabled]="approvableCount() === 0 || submitting()"
            (click)="onProcessAll()"
          >Process all ({{ approvableCount() }})</button>
        </div>
      }

      <app-ai-disclaimer
        message="Extraction is performed by AI and may misread a question or its correct answer. Review each one before generating its explanation."
      />
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .review-card { display: flex; flex-direction: column; gap: var(--space-md); }
      .header { display: flex; align-items: center; gap: var(--space-sm); }
      .back-btn {
        flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
        width: var(--touch-min); height: var(--touch-min); padding: 0; background: none; color: var(--text-secondary);
      }
      .back-btn:hover { color: var(--text-primary); }
      .title-block { min-width: 0; }
      .title-block h2 { font-size: var(--font-size-xl); margin: 0; }
      .subtitle { color: var(--text-muted); font-size: var(--font-size-sm); margin: 0; }

      .warn-line { color: var(--color-amber); font-size: var(--font-size-sm); }
      .error-line { color: var(--color-red); font-size: var(--font-size-sm); }
      .status-line { color: var(--text-muted); font-size: var(--font-size-sm); }

      .list { display: flex; flex-direction: column; gap: var(--space-sm); list-style: none; padding: 0; margin: 0; }

      .empty {
        display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-sm);
        padding: var(--space-lg); border-radius: var(--radius-md); background: var(--bg-elevated);
      }
      .empty-title { font-weight: 600; color: var(--text-primary); margin: 0; }
      .empty-body { color: var(--text-muted); font-size: var(--font-size-sm); margin: 0; }

      .actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; }
      .generate-btn {
        flex: 1; min-width: 200px; display: inline-flex; align-items: center; justify-content: center;
        min-height: 48px; padding: 0 var(--space-lg); border-radius: var(--radius-md);
        background: linear-gradient(135deg, var(--color-purple), var(--color-blue));
        color: #ffffff; font-weight: 600; font-size: var(--font-size-base);
      }
      .generate-btn.secondary { background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--bg-border); }
      .generate-btn:disabled { opacity: 0.55; cursor: not-allowed; }

      .btn-ghost-sm {
        align-self: flex-start; padding: 0 var(--space-md); min-height: 36px; border-radius: var(--radius-md);
        border: 1px solid var(--bg-border); background: transparent; color: var(--text-secondary);
        font-size: var(--font-size-sm); font-weight: 500;
      }
      .btn-ghost-sm:hover { border-color: var(--color-purple); color: var(--text-primary); }
    `,
  ],
})
export class ImportReviewPageComponent implements OnInit {
  private readonly reviewService = inject(ImportReviewService);
  private readonly importExamService = inject(ImportExamService);
  private readonly router = inject(Router);

  readonly packId = input.required<string>();
  readonly jobId = input.required<string>();

  protected readonly loading = this.reviewService.loading;
  protected readonly drafts = this.reviewService.drafts;
  protected readonly selectedIndices = signal<ReadonlySet<number>>(new Set());
  protected readonly busyIndices = signal<ReadonlySet<number>>(new Set());
  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected readonly job = computed(() => this.importExamService.jobs().find((j) => j.id === this.jobId()));

  protected readonly pendingDrafts = computed(() => this.drafts().filter((d) => !d.promoted));
  protected readonly promotedCount = computed(() => this.drafts().filter((d) => d.promoted).length);
  protected readonly approvableCount = computed(
    () => this.pendingDrafts().filter((d) => d.extractStatus === 'SUCCEEDED').length,
  );

  protected readonly mismatchWarning = computed(() => {
    const j = this.job();
    if (!j || j.totalQuestions == null || j.expectedQuestions == null) return null;
    if (j.totalQuestions === j.expectedQuestions) return null;
    return `Expected ${j.expectedQuestions} question(s), found ${j.totalQuestions} — check whether any were missed before approving.`;
  });

  ngOnInit(): void {
    void this.reviewService.loadDrafts(this.jobId());
  }

  isSelected(index: number): boolean {
    return this.selectedIndices().has(index);
  }

  isBusy(index: number): boolean {
    return this.busyIndices().has(index);
  }

  toggleSelected(index: number): void {
    const next = new Set(this.selectedIndices());
    if (next.has(index)) next.delete(index);
    else next.add(index);
    this.selectedIndices.set(next);
  }

  async onReExtract(index: number, hint: string | undefined): Promise<void> {
    this.error.set(null);
    this.busyIndices.set(new Set([...this.busyIndices(), index]));
    try {
      const result = await this.reviewService.reExtract(this.jobId(), index, hint);
      if (result.error) this.error.set(result.error);
    } finally {
      const next = new Set(this.busyIndices());
      next.delete(index);
      this.busyIndices.set(next);
    }
  }

  async onProcessSelected(): Promise<void> {
    const indices = [...this.selectedIndices()];
    if (indices.length === 0) return;
    await this.submit(indices);
  }

  async onProcessAll(): Promise<void> {
    const indices = this.pendingDrafts()
      .filter((d) => d.extractStatus === 'SUCCEEDED')
      .map((d) => d.index);
    if (indices.length === 0) return;
    await this.submit(indices);
  }

  private async submit(indices: number[]): Promise<void> {
    this.error.set(null);
    this.submitting.set(true);
    try {
      const result = await this.reviewService.startExplanations(this.jobId(), indices);
      if (result.error) {
        this.error.set(result.error);
        return;
      }
      await this.importExamService.refreshJobs();
      this.onBack();
    } finally {
      this.submitting.set(false);
    }
  }

  onBack(): void {
    this.router.navigate(['/questions', this.packId()]);
  }
}
