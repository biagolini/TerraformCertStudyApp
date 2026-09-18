import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ImportDraftQuestion } from '../../core/models/import-draft.model';
import { ImportReviewService } from '../../core/services/import-review.service';
import { ImportExamService } from '../../core/services/import-exam.service';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { ImportDraftItemComponent } from './import-draft-item.component';

/** Routed at /questions/:packId/import/:jobId — reached from
 * import-exam.component.ts's "Review N questions" link, never directly
 * part of the upload tab itself. One job's structure-only drafts (Phase 1
 * output), shown one at a time with an "Item Navigator" side panel to jump
 * between them — deliberately mirrors quiz-runner.component.ts's own
 * layout (centered `.runner` card, `.runner-body` main+palette split,
 * numbered palette dots) rather than a long scrolling list, since this
 * screen serves the exact same purpose as the quiz runner from the user's
 * perspective: go through N items one at a time, marking each. A palette
 * dot's state reuses the same visual vocabulary: filled = approved
 * (selected for Phase 2, like "answered"), a warning dot overlay = failed
 * extraction (like "flagged"), a blue ring = current. */
@Component({
  selector: 'app-import-review-page',
  standalone: true,
  imports: [ImportDraftItemComponent, AiDisclaimerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <p class="status-line">Loading…</p>
    } @else if (pendingDrafts().length === 0) {
      <section class="runner empty-runner">
        <div class="empty">
          <p class="empty-title">Nothing left to review.</p>
          @if (promotedCount() > 0) {
            <p class="empty-body">{{ promotedCount() }} question(s) from this job already have explanations.</p>
          }
          <button type="button" class="btn-ghost-sm" (click)="onBack()">Back to questions</button>
        </div>
      </section>
    } @else if (currentDraft(); as draft) {
      <section class="runner">
        <header class="runner-header">
          <button type="button" class="back-btn" (click)="onBack()" aria-label="Back to questions">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div class="progress-track"><div class="progress-fill" [style.width.%]="progressPct()"></div></div>
          <span class="progress-text">Question {{ cursor() + 1 }} of {{ pendingDrafts().length }}</span>
        </header>

        @if (mismatchWarning(); as warning) {
          <p class="warn-line">{{ warning }}</p>
        }

        <div class="runner-body">
          <div class="question-main">
            <app-import-draft-item
              [draft]="draft"
              [selected]="isSelected(draft.index)"
              [busy]="isBusy(draft.index)"
              (selectionToggled)="toggleSelected(draft.index)"
              (reExtractRequested)="onReExtract(draft.index, $event)"
              (editSaved)="onEditSaved(draft.index, $event)"
            />

            <div class="nav-buttons">
              <button type="button" class="btn-ghost-sm" [disabled]="cursor() === 0" (click)="prev()">Previous</button>
              <button type="button" class="btn-ghost-sm" [disabled]="isLast()" (click)="next()">Next</button>
            </div>

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
          </div>

          <aside class="palette">
            <h4>Item Navigator</h4>
            <div class="palette-grid">
              @for (d of pendingDrafts(); track d.index; let i = $index) {
                <button
                  type="button"
                  class="palette-dot"
                  [class.answered]="isSelected(d.index)"
                  [class.current]="i === cursor()"
                  (click)="goTo(i)"
                >
                  {{ d.index + 1 }}
                  @if (d.extractStatus === 'FAILED') { <span class="flag-dot" aria-hidden="true"></span> }
                </button>
              }
            </div>
            <div class="palette-legend">
              <div class="legend-row"><span class="legend-swatch current"></span> Current item</div>
              <div class="legend-row"><span class="legend-swatch" style="background:var(--color-purple)"></span> Approved</div>
              <div class="legend-row"><span class="legend-swatch outline"></span> Not yet approved</div>
              <div class="legend-row"><span class="legend-swatch outline"><span class="flag-dot" aria-hidden="true"></span></span> Extraction failed</div>
            </div>
            <p class="palette-summary">{{ selectedIndices().size }} of {{ pendingDrafts().length }} approved</p>
          </aside>
        </div>

        <app-ai-disclaimer
          message="Extraction is performed by AI and may misread a question or its correct answer. Review each one before generating its explanation."
        />
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        grid-column: 1 / -1;
      }
      @media (min-width: 768px) {
        :host {
          max-width: 960px;
          margin: 0 auto;
          width: 100%;
        }
      }

      .runner { display: flex; flex-direction: column; gap: var(--space-lg); background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-lg); }
      .runner-header { display: flex; align-items: center; gap: var(--space-md); }
      .back-btn {
        flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
        width: var(--touch-min); height: var(--touch-min); padding: 0; background: none; color: var(--text-secondary);
      }
      .back-btn:hover { color: var(--text-primary); }
      .progress-track { flex: 1; height: 6px; border-radius: 999px; background: var(--bg-border); overflow: hidden; }
      .progress-fill { height: 100%; background: linear-gradient(135deg, var(--color-purple), var(--color-blue)); border-radius: 999px; }
      .progress-text { font-size: var(--font-size-xs); color: var(--text-muted); white-space: nowrap; }

      .warn-line { color: var(--color-amber); font-size: var(--font-size-sm); }
      .error-line { color: var(--color-red); font-size: var(--font-size-sm); }
      .status-line { color: var(--text-muted); font-size: var(--font-size-sm); }

      .runner-body { display: flex; gap: var(--space-lg); align-items: flex-start; }
      .question-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-md); }

      .nav-buttons { display: flex; gap: var(--space-sm); }

      .empty-runner { align-items: flex-start; }
      .empty {
        display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-sm);
        padding: var(--space-lg); border-radius: var(--radius-md); background: var(--bg-elevated); width: 100%;
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
        padding: 0 var(--space-md); min-height: 36px; border-radius: var(--radius-md);
        border: 1px solid var(--bg-border); background: transparent; color: var(--text-secondary);
        font-size: var(--font-size-sm); font-weight: 500;
      }
      .btn-ghost-sm:hover { border-color: var(--color-purple); color: var(--text-primary); }
      .btn-ghost-sm:disabled { opacity: 0.5; cursor: not-allowed; }

      .palette { width: 176px; flex-shrink: 0; background: var(--bg-elevated); border-radius: var(--radius-md); padding: var(--space-md); border: 1px solid var(--bg-border); }
      .palette h4 { margin: 0 0 var(--space-sm); font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
      .palette-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
      .palette-dot { position: relative; width: 28px; height: 28px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: var(--font-size-xs); font-weight: 600; background: var(--bg-input); border: 1.5px solid var(--bg-border); color: var(--text-muted); cursor: pointer; font-family: var(--font-family); }
      .palette-dot.answered { background: var(--color-purple); border-color: var(--color-purple); color: #fff; }
      .palette-dot.current { box-shadow: 0 0 0 2px var(--color-blue) inset; }
      .palette-dot .flag-dot { position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--color-red); }
      .palette-legend { margin-top: var(--space-md); display: flex; flex-direction: column; gap: 6px; font-size: var(--font-size-xs); color: var(--text-muted); }
      .legend-row { display: flex; align-items: center; gap: 6px; }
      .legend-swatch { position: relative; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
      .legend-swatch.outline { background: var(--bg-input); border: 1.5px solid var(--bg-border); }
      .legend-swatch.current { background: transparent; border: 2px solid var(--color-blue); }
      .legend-swatch .flag-dot { position: absolute; top: -4px; right: -4px; width: 8px; height: 8px; border-radius: 50%; background: var(--color-red); }
      .palette-summary { margin: var(--space-sm) 0 0; font-size: var(--font-size-xs); color: var(--text-muted); }

      @media (max-width: 640px) {
        .runner-body { flex-direction: column; }
        .palette { width: 100%; }
      }
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
  protected readonly cursor = signal(0);

  protected readonly job = computed(() => this.importExamService.jobs().find((j) => j.id === this.jobId()));

  protected readonly pendingDrafts = computed(() => this.drafts().filter((d) => !d.promoted));
  protected readonly promotedCount = computed(() => this.drafts().filter((d) => d.promoted).length);
  protected readonly approvableCount = computed(
    () => this.pendingDrafts().filter((d) => d.extractStatus === 'SUCCEEDED').length,
  );
  protected readonly currentDraft = computed(() => this.pendingDrafts()[this.cursor()] ?? null);
  protected readonly isLast = computed(() => this.cursor() >= this.pendingDrafts().length - 1);
  protected readonly progressPct = computed(() => {
    const total = this.pendingDrafts().length;
    return total === 0 ? 0 : ((this.cursor() + 1) / total) * 100;
  });

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

  goTo(pos: number): void {
    this.cursor.set(pos);
  }

  next(): void {
    this.cursor.update((pos) => Math.min(pos + 1, this.pendingDrafts().length - 1));
  }

  prev(): void {
    this.cursor.update((pos) => Math.max(pos - 1, 0));
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

  async onEditSaved(
    index: number,
    edits: Pick<ImportDraftQuestion, 'title' | 'domain' | 'stem' | 'alternatives'>,
  ): Promise<void> {
    this.error.set(null);
    this.busyIndices.set(new Set([...this.busyIndices(), index]));
    try {
      const result = await this.reviewService.updateDraft(this.jobId(), index, edits);
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
