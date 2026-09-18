import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { ImportDraftQuestion } from '../../core/models/import-draft.model';
import { ImportReviewService } from '../../core/services/import-review.service';
import { ImportExamService } from '../../core/services/import-exam.service';
import { StorageService } from '../../core/services/storage.service';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { ConfirmDeleteDialogComponent } from '../../shared/components/confirm-delete-dialog.component';
import { DiscardChangesDialogComponent } from '../../shared/components/discard-changes-dialog.component';
import { ImportDraftItemComponent } from './import-draft-item.component';
import { I18nService } from '../../core/i18n/i18n.service';

/** Routed at /questions/:packId/import/:jobId — reached from
 * import-exam.component.ts's "Review N questions" link, never directly
 * part of the upload tab itself. One job's structure-only drafts (Phase 1
 * output), shown one at a time with an "Item Navigator" side panel to jump
 * between them — deliberately mirrors quiz-runner.component.ts's own
 * layout (centered `.runner` card, `.runner-body` main+palette split,
 * numbered palette dots) rather than a long scrolling list, since this
 * screen serves the exact same purpose as the quiz runner from the user's
 * perspective: go through N items one at a time. A palette dot's state:
 * a warning overlay = failed extraction ("needs attention"), a blue ring
 * = current.
 *
 * No per-question selection any more — extraction is reliable enough now
 * that batching "only the ones I checked" stopped being the common case.
 * The two bulk actions below act on every approved (successfully-
 * extracted, not yet promoted) draft; excluding one from a batch means
 * deleting it, not unchecking it. */
@Component({
  selector: 'app-import-review-page',
  standalone: true,
  imports: [ImportDraftItemComponent, AiDisclaimerComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <p class="status-line">{{ i18n.t('common.loading') }}</p>
    } @else if (allDrafts().length === 0) {
      <section class="runner empty-runner">
        <div class="empty">
          <p class="empty-title">{{ i18n.t('importReview.nothingLeftToReview') }}</p>
          <button type="button" class="btn-ghost-sm" (click)="onBack()">{{ i18n.t('importReview.backToQuestions') }}</button>
        </div>
      </section>
    } @else if (currentDraft(); as draft) {
      <section class="runner">
        <header class="runner-header">
          <button type="button" class="back-btn" (click)="onBack()" [attr.aria-label]="i18n.t('importReview.backToQuestions')">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div class="progress-track"><div class="progress-fill" [style.width.%]="progressPct()"></div></div>
          <span class="progress-text">{{ i18n.t('importReview.questionOf', { current: cursor() + 1, total: allDrafts().length }) }}</span>
        </header>

        @if (mismatchWarning(); as warning) {
          <p class="warn-line">{{ warning }}</p>
        }

        <div class="runner-body">
          <div class="question-main">
            @if (draft.promoted) {
              <div class="promoted-card">
                <p class="promoted-title">{{ draft.title || i18n.t('importReview.questionNumber', { number: draft.index + 1 }) }}</p>
                <p class="status-line">{{ i18n.t('importReview.promotedHint') }}</p>
                <a class="btn-ghost-sm" [routerLink]="['/questions', packId(), jobId() + '-' + padIndex(draft.index)]">{{ i18n.t('importReview.viewQuestion') }}</a>
              </div>
            } @else {
              <app-import-draft-item
                #draftItem
                [draft]="draft"
                [jobId]="jobId()"
                [busy]="isBusy(draft.index)"
                [explainError]="explainErrorsByIndex().get(draft.index) ?? null"
                (deleteRequested)="onDeleteDraft(draft)"
                (reExtractRequested)="onReExtract(draft.index, $event)"
                (editSaved)="onEditSaved(draft.index, $event)"
              />
            }

            <div class="nav-buttons">
              <button type="button" class="btn-ghost-sm" [disabled]="cursor() === 0" (click)="prev()">{{ i18n.t('importReview.previous') }}</button>
              <button type="button" class="btn-ghost-sm" [disabled]="isLast()" (click)="next()">{{ i18n.t('importReview.next') }}</button>
            </div>

            @if (promotedCount() > 0) {
              <p class="status-line">{{ i18n.t('importReview.alreadyGenerated', { count: promotedCount() }) }}</p>
            }

            @if (error()) {
              <p class="error-line" role="alert">{{ error() }}</p>
            }

            @if (approvableCount() > 0) {
              <div class="actions">
                <button
                  type="button"
                  class="generate-btn secondary"
                  [disabled]="submitting()"
                  (click)="onSaveAsIs()"
                >{{ submitting() ? i18n.t('importReview.saving') : i18n.t('importReview.saveAsIs', { count: approvableCount() }) }}</button>
                <button
                  type="button"
                  class="generate-btn"
                  [disabled]="submitting()"
                  (click)="onRefineWithAI()"
                >{{ submitting() ? i18n.t('importReview.starting') : i18n.t('importReview.refineWithAiCount', { count: approvableCount() }) }}</button>
              </div>
              <p class="status-line">{{ i18n.t('importReview.saveAsIsExplain') }}</p>
            }
          </div>

          <aside class="palette">
            <h4>{{ i18n.t('importReview.itemNavigator') }}</h4>
            <div class="palette-grid">
              @for (d of allDrafts(); track d.index; let i = $index) {
                <button
                  type="button"
                  class="palette-dot"
                  [class.current]="i === cursor()"
                  [class.promoted]="d.promoted"
                  (click)="goTo(i)"
                >
                  {{ d.index + 1 }}
                  @if (isDraftFailed(d)) { <span class="flag-dot" aria-hidden="true"></span> }
                </button>
              }
            </div>
            <button type="button" class="add-question-btn" [disabled]="addingQuestion()" (click)="onAddQuestion()">
              {{ addingQuestion() ? i18n.t('importReview.adding') : i18n.t('importReview.addQuestion') }}
            </button>
            <div class="palette-legend">
              <div class="legend-row"><span class="legend-swatch current"></span> {{ i18n.t('importReview.currentItem') }}</div>
              <div class="legend-row"><span class="legend-swatch promoted"></span> {{ i18n.t('importReview.doneItem') }}</div>
              <div class="legend-row"><span class="legend-swatch outline"><span class="flag-dot" aria-hidden="true"></span></span> {{ i18n.t('importReview.extractionFailed') }}</div>
            </div>
            <p class="palette-summary">{{ i18n.t('importReview.pendingReview', { count: pendingDrafts().length }) }}</p>
          </aside>
        </div>

        <app-ai-disclaimer
          [message]="i18n.t('importReview.aiDisclaimer')"
        />
      </section>
    }
  `,
  styles: [
    `
      // min-width: 0 matches AppComponent's own .column-full utility class
      // (app.component.scss) — a routed page lands as router-outlet's
      // sibling, not a child AppComponent's stylesheet can reach, so this
      // has to be repeated in every full-width routed page's own :host.
      // Without it, .app-main's mobile grid-template-columns: 1fr track
      // won't shrink below this subtree's content min-width (CSS Grid's
      // default track min-size is auto, not 0) — invisible as long as
      // everything inside wraps normally, but a wide extracted image or
      // table (this page's raw, not-yet-reviewed content, unlike quiz's
      // already-cleaned questions) forces the whole grid track wider than
      // the viewport instead of just scrolling within its own box.
      :host {
        display: block;
        grid-column: 1 / -1;
        min-width: 0;
      }

      // max-width/centering lives on .runner itself, unconditionally —
      // mirrors quiz-runner.component.ts's own .runner rule exactly,
      // rather than gating it behind a min-width media query on :host.
      .runner { display: flex; flex-direction: column; gap: var(--space-lg); background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-lg); max-width: 960px; margin: 0 auto; }
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

      .promoted-card {
        display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-sm);
        padding: var(--space-lg); border-radius: var(--radius-md); background: var(--bg-elevated);
        border: 1px solid var(--color-green);
      }
      .promoted-title { font-weight: 600; color: var(--text-primary); margin: 0; }

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
      .palette-dot.current { box-shadow: 0 0 0 2px var(--color-blue) inset; }
      .palette-dot.promoted { background: var(--color-green); border-color: var(--color-green); color: #fff; }
      .palette-dot .flag-dot { position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--color-red); }
      .add-question-btn {
        margin-top: var(--space-sm);
        width: 100%;
        height: 32px;
        border-radius: var(--radius-md);
        border: 1px dashed var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .add-question-btn:hover:not(:disabled) { border-color: var(--color-purple); color: var(--text-primary); }
      .add-question-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .palette-legend { margin-top: var(--space-md); display: flex; flex-direction: column; gap: 6px; font-size: var(--font-size-xs); color: var(--text-muted); }
      .legend-row { display: flex; align-items: center; gap: 6px; }
      .legend-swatch { position: relative; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
      .legend-swatch.outline { background: var(--bg-input); border: 1.5px solid var(--bg-border); }
      .legend-swatch.current { background: transparent; border: 2px solid var(--color-blue); }
      .legend-swatch.promoted { background: var(--color-green); }
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
  private readonly storage = inject(StorageService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly draftItem = viewChild<ImportDraftItemComponent>('draftItem');
  protected readonly i18n = inject(I18nService);

  readonly packId = input.required<string>();
  readonly jobId = input.required<string>();

  protected readonly loading = this.reviewService.loading;
  protected readonly drafts = this.reviewService.drafts;
  protected readonly busyIndices = signal<ReadonlySet<number>>(new Set());
  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly addingQuestion = signal(false);
  protected readonly cursor = signal(0);

  protected readonly job = computed(() => this.importExamService.jobs().find((j) => j.id === this.jobId()));

  /** Every draft this job produced, in index order — the Item Navigator's
   * source of truth. Previously it only ever showed unpromoted drafts, so
   * finishing (or partially finishing) a job made items disappear from the
   * navigator one by one, and clearing the last one left nothing to browse
   * at all — this keeps the full picture (e.g. "85 questions") browsable
   * for as long as the job's drafts exist (their own TTL), not just while
   * something's still unresolved. */
  protected readonly allDrafts = this.drafts;
  protected readonly pendingDrafts = computed(() => this.drafts().filter((d) => !d.promoted));
  protected readonly promotedCount = computed(() => this.drafts().filter((d) => d.promoted).length);
  protected readonly approvableCount = computed(
    () => this.pendingDrafts().filter((d) => d.extractStatus === 'SUCCEEDED').length,
  );
  protected readonly currentDraft = computed(() => this.allDrafts()[this.cursor()] ?? null);
  protected readonly isLast = computed(() => this.cursor() >= this.allDrafts().length - 1);
  protected readonly progressPct = computed(() => {
    const total = this.allDrafts().length;
    return total === 0 ? 0 : ((this.cursor() + 1) / total) * 100;
  });

  /** `{index: error}` for drafts that made it through Phase 1 fine but
   * failed Phase 2 (explanation generation) — that failure is recorded only
   * on the JOB record's `failures` list (see import_finalize/app.py), never
   * on the draft itself, so without this cross-reference a Phase-2-failed
   * draft looked completely indistinguishable from one that simply hadn't
   * been submitted yet. */
  protected readonly explainErrorsByIndex = computed(() => {
    const map = new Map<number, string>();
    for (const f of this.job()?.failures ?? []) {
      if (f.index !== null && f.index !== undefined) map.set(f.index, f.error);
    }
    return map;
  });

  isDraftFailed(d: ImportDraftQuestion): boolean {
    return d.extractStatus === 'FAILED' || this.explainErrorsByIndex().has(d.index);
  }

  /** Matches the deterministic `{jobId}-{index:03d}` id import_explain/
   * save_drafts_as_is give the final Question — lets a promoted draft's
   * "View question" link deep-link straight to it. */
  padIndex(index: number): string {
    return String(index).padStart(3, '0');
  }

  protected readonly mismatchWarning = computed(() => {
    const j = this.job();
    if (!j || j.totalQuestions == null || j.expectedQuestions == null) return null;
    if (j.totalQuestions === j.expectedQuestions) return null;
    return this.i18n.t('importReview.mismatchWarning', { expected: j.expectedQuestions, found: j.totalQuestions });
  });

  ngOnInit(): void {
    void this.reviewService.loadDrafts(this.jobId());
  }

  isBusy(index: number): boolean {
    return this.busyIndices().has(index);
  }

  goTo(pos: number): void {
    if (pos === this.cursor()) return;
    this.tryNavigate(() => this.cursor.set(pos));
  }

  next(): void {
    this.tryNavigate(() => this.cursor.update((pos) => Math.min(pos + 1, this.allDrafts().length - 1)));
  }

  prev(): void {
    this.tryNavigate(() => this.cursor.update((pos) => Math.max(pos - 1, 0)));
  }

  /** Switching questions used to leave the edit form stuck showing the
   * PREVIOUS question's fields while `draft` silently pointed at a new
   * one underneath — this gates that: if the current question is being
   * edited, confirm before navigating (an unsaved edit would otherwise be
   * discarded with no warning at all). */
  private tryNavigate(apply: () => void): void {
    const item = this.draftItem();
    if (!item?.editing()) {
      apply();
      return;
    }
    this.dialog
      .open(DiscardChangesDialogComponent, { width: '400px' })
      .afterClosed()
      .subscribe((result) => {
        if (result !== 'discard') return;
        item.cancelEdit();
        apply();
      });
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
    edits: Pick<
      ImportDraftQuestion,
      'title' | 'domain' | 'stem' | 'alternatives' | 'sourceGeneralComment' | 'images'
    >,
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

  async onRefineWithAI(): Promise<void> {
    await this.submit(() => this.reviewService.startExplanations(this.jobId()));
  }

  async onSaveAsIs(): Promise<void> {
    await this.submit(() => this.reviewService.saveAsIs(this.jobId()), { refreshQuestions: true });
  }

  private async submit(
    action: () => Promise<{ error?: string }>,
    options?: { refreshQuestions?: boolean },
  ): Promise<void> {
    this.error.set(null);
    this.submitting.set(true);
    try {
      const result = await action();
      if (result.error) {
        this.error.set(result.error);
        return;
      }
      await this.importExamService.refreshJobs();
      // "Save as is" writes the new Questions synchronously and completes
      // the job in this same call — unlike "Refine extraction with AI"
      // (Step Functions, still running when we get here), there's no later
      // poller transition to trigger StorageService's own refresh, so it
      // has to happen here or the new questions just don't show up yet.
      if (options?.refreshQuestions) {
        await this.storage.refresh();
      }
      this.onBack();
    } finally {
      this.submitting.set(false);
    }
  }

  onDeleteDraft(draft: ImportDraftQuestion): void {
    const dialogRef = this.dialog.open(ConfirmDeleteDialogComponent, {
      data: { title: draft.title || this.i18n.t('importReview.questionNumber', { number: draft.index + 1 }) },
      width: '400px',
    });
    dialogRef.afterClosed().subscribe(async (result) => {
      if (result !== 'confirm') return;
      this.error.set(null);
      const delResult = await this.reviewService.deleteDraft(this.jobId(), draft.index);
      if (delResult.error) {
        this.error.set(delResult.error);
        return;
      }
      this.cursor.update((pos) => Math.min(pos, Math.max(0, this.allDrafts().length - 1)));
    });
  }

  /** Appends a blank question and jumps straight to it — gated by the same
   * discard-changes check as any other navigation, since it moves the
   * cursor away from whatever's currently being edited. */
  async onAddQuestion(): Promise<void> {
    this.error.set(null);
    this.addingQuestion.set(true);
    try {
      const result = await this.reviewService.addDraft(this.jobId());
      if (result.error) {
        this.error.set(result.error);
        return;
      }
      this.tryNavigate(() => this.cursor.set(Math.max(0, this.allDrafts().length - 1)));
    } finally {
      this.addingQuestion.set(false);
    }
  }

  onBack(): void {
    // Import-scoped, not Questions — this is how the user gets back to
    // watching this job's progress (see import-exam.component.ts's
    // "Processing"/"Ready to review" sections), including right after
    // starting Phase 2, which used to dump them onto /questions instead
    // with no way to see whether the (still-running) explanation generation
    // succeeded without navigating back here by hand.
    this.router.navigate(['/import', this.packId()]);
  }
}
