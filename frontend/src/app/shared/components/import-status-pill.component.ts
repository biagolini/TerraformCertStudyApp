import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ImportExamService } from '../../core/services/import-exam.service';
import { ImportJob, isImportJobRunning } from '../../core/models/import-job.model';

/** Keeps any in-progress bulk exam import visible in the header while its
 * Step Functions pipeline runs in the background, so progress isn't lost
 * just because the user navigated to another tab. Mirrors SyncStatusComponent's
 * icon-toggle + dropdown-panel pattern. Only appears while at least one job
 * is actually running (either pipeline phase — see isImportJobRunning) —
 * uploaded-but-not-yet-processed and awaiting-review files don't need a
 * persistent header indicator, they're visible in the import panel itself. */
@Component({
  selector: 'app-import-status-pill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (processingJobs().length > 0) {
      <div class="import-wrap">
        <button
          type="button"
          class="import-toggle spinning"
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
          <div class="import-panel" role="dialog" aria-label="Exam import status">
            @for (job of processingJobs(); track job.id) {
              <div class="job-line">
                <p class="panel-title">{{ job.filename }}</p>
                <p class="panel-body">
                  {{ progressTotal(job) ? job.processedCount + ' of ' + progressTotal(job) + ' processed' : 'Detecting questions…' }}
                </p>
              </div>
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
      .job-line + .job-line { padding-top: var(--space-sm); border-top: 1px solid var(--bg-border); }
      .panel-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .panel-body { font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.45; margin: 2px 0 0; }
      @keyframes import-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
    `,
  ],
})
export class ImportStatusPillComponent {
  private readonly importService = inject(ImportExamService);

  protected readonly panelOpen = signal(false);
  readonly processingJobs = computed(() => this.importService.jobs().filter((j) => isImportJobRunning(j)));

  readonly ariaLabel = computed(() => {
    const n = this.processingJobs().length;
    return `Exam import: processing ${n} file${n === 1 ? '' : 's'}`;
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
}
