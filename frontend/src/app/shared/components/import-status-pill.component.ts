import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ImportExamService } from '../../core/services/import-exam.service';
import { ImportJob, isImportJobRunning } from '../../core/models/import-job.model';
import { I18nService } from '../../core/i18n/i18n.service';

/** Keeps any bulk exam import visible in the header — both while its Step
 * Functions pipeline is actively running (so progress isn't lost just
 * because the user navigated to another tab) AND once Phase 1 lands on
 * AWAITING_REVIEW, since that state otherwise has NO indicator anywhere
 * outside the Import page itself: the icon used to only show for
 * isImportJobRunning, so the moment extraction finished it just vanished,
 * leaving no way back into the review screen short of remembering to open
 * /import by hand. Mirrors SyncStatusComponent's icon-toggle + dropdown-
 * panel pattern; an AWAITING_REVIEW line is clickable (opens the review
 * screen directly), a still-running one isn't (nothing to act on yet). */
@Component({
  selector: 'app-import-status-pill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visibleJobs().length > 0) {
      <div class="import-wrap">
        <button
          type="button"
          class="import-toggle"
          [class.spinning]="anyRunning()"
          (click)="onClick()"
          [attr.aria-label]="ariaLabel()"
          [title]="ariaLabel()"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>
          </svg>
          <span class="dot" aria-hidden="true"></span>
        </button>

        @if (panelOpen()) {
          <div class="import-panel" role="dialog" [attr.aria-label]="i18n.t('importPill.dialogLabel')">
            @for (job of visibleJobs(); track job.id) {
              @if (job.status === 'AWAITING_REVIEW') {
                <button type="button" class="job-line job-line-action" (click)="onReview(job)">
                  <p class="panel-title">{{ job.filename }}</p>
                  <p class="panel-body panel-action">{{ i18n.t('importPill.readyToReview', { count: job.totalQuestions }) }}</p>
                </button>
              } @else {
                <div class="job-line">
                  <p class="panel-title">{{ job.filename }}</p>
                  <p class="panel-body">
                    {{ progressTotal(job) ? i18n.t('importPill.processedOf', { processed: job.processedCount, total: progressTotal(job) }) : i18n.t('importPill.detecting') }}
                  </p>
                </div>
              }
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { display: inline-flex; position: relative; }
      .import-wrap { position: relative; display: inline-flex; }
      .import-toggle {
        display: inline-flex; align-items: center; justify-content: center;
        width: var(--touch-min); height: var(--touch-min); border-radius: var(--radius-md);
        color: var(--text-secondary); position: relative;
        transition: color var(--transition-fast), background var(--transition-fast);
      }
      .import-toggle:hover { color: var(--text-primary); background: var(--bg-subtle); }
      .import-toggle.spinning svg { animation: import-pulse 1400ms ease-in-out infinite; }
      .dot { position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--color-purple); border: 2px solid var(--bg-surface); }
      .import-panel {
        position: absolute; top: calc(var(--touch-min) + 6px); right: 0; width: 280px;
        background: var(--bg-surface); border: 1px solid var(--bg-border); border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg); padding: var(--space-md); z-index: 40;
        display: flex; flex-direction: column; gap: var(--space-sm);
      }
      .job-line { display: block; width: 100%; text-align: left; }
      .job-line + .job-line { padding-top: var(--space-sm); border-top: 1px solid var(--bg-border); }
      .job-line-action { background: none; border: none; padding: 0; cursor: pointer; border-radius: var(--radius-sm); }
      .job-line-action:hover { background: var(--bg-subtle); }
      .panel-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .panel-body { font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.45; margin: 2px 0 0; }
      .panel-action { color: var(--color-purple); font-weight: 600; }
      @keyframes import-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
    `,
  ],
})
export class ImportStatusPillComponent {
  private readonly importService = inject(ImportExamService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  protected readonly panelOpen = signal(false);
  readonly visibleJobs = computed(() =>
    this.importService.jobs().filter((j) => isImportJobRunning(j) || j.status === 'AWAITING_REVIEW'),
  );
  readonly anyRunning = computed(() => this.importService.jobs().some((j) => isImportJobRunning(j)));

  readonly ariaLabel = computed(() => {
    const jobs = this.visibleJobs();
    const awaitingReview = jobs.filter((j) => j.status === 'AWAITING_REVIEW').length;
    const running = jobs.length - awaitingReview;
    if (awaitingReview > 0 && running > 0) {
      return this.i18n.t('importPill.bothStates', { running, review: awaitingReview });
    }
    if (awaitingReview > 0) {
      return this.i18n.t('importPill.reviewOnly', { count: awaitingReview });
    }
    return this.i18n.t('importPill.processingOnly', { count: running });
  });

  progressTotal(job: Pick<ImportJob, 'status' | 'totalQuestions' | 'explainTotal'>): number | null {
    return job.status === 'GENERATING' ? (job.explainTotal ?? null) : job.totalQuestions;
  }

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('click', (event) => {
        if (!this.panelOpen()) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('app-import-status-pill')) return;
        this.panelOpen.set(false);
      });
    }
  }

  onClick(): void {
    this.panelOpen.update((open) => !open);
  }

  onReview(job: ImportJob): void {
    this.panelOpen.set(false);
    void this.router.navigate(['/questions', job.packId, 'import', job.id]);
  }
}
