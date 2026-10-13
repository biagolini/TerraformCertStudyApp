import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ImportJob, importJobProgressPct, importJobProgressTotal } from '../../core/models/import-job.model';
import { I18nService } from '../../core/i18n/i18n.service';

/** Progress of a running import (extraction or AI explanations): phase,
 * bar and "N of M processed". Fed by ImportExamService's poller, so it keeps
 * moving wherever it is shown — the import hub, an exam's upload page or the
 * review screen — including after the window was closed and reopened. */
@Component({
  selector: 'app-import-job-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <span class="phase">{{ job().status === 'GENERATING' ? i18n.t('importExam.generatingExplanations') : i18n.t('importExam.extracting') }}</span>
      <span class="count">
        @if (total(); as t) {
          {{ i18n.t('importExam.processedOf', { processed: job().processedCount, total: t }) }}
        } @else {
          {{ i18n.t('importExam.startingDetecting') }}
        }
      </span>
    </div>
    <div class="ui-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="pct()" [attr.aria-label]="job().filename">
      <span [style.width.%]="pct()"></span>
    </div>
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: 6px; width: 100%; }
      .head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-sm); font-size: var(--font-size-sm); }
      .phase { font-weight: 600; color: var(--color-blue); }
      .count { color: var(--text-secondary); font-family: var(--font-mono); font-size: var(--font-size-xs); }
      .ui-progress > span { transition: width 300ms ease; }
    `,
  ],
})
export class ImportJobProgressComponent {
  protected readonly i18n = inject(I18nService);
  readonly job = input.required<ImportJob>();
  protected readonly total = computed(() => importJobProgressTotal(this.job()));
  protected readonly pct = computed(() => Math.round(importJobProgressPct(this.job())));
}
