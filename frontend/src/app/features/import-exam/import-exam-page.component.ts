import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ImportExamComponent } from './import-exam.component';
import { I18nService } from '../../core/i18n/i18n.service';

/** Routed at /import/:packId — same pack-scoped pattern as
 * questions-page.component.ts (packId comes from the route via
 * packIdResolver, not from PacksService.activePack() directly), so each
 * pack keeps its own persistent import job history reachable by a
 * bookmarkable/shareable URL instead of a single global /import page whose
 * "current pack" lived only in an in-page dropdown. */
@Component({
  selector: 'app-import-exam-page',
  standalone: true,
  imports: [ImportExamComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-card">
      <header class="card-header">
        <h2>{{ i18n.t('importExam.pageTitle') }}</h2>
        <p class="subtitle">{{ i18n.t('importExam.pageSubtitle') }}</p>
      </header>
      <app-import-exam [packId]="packId()" />
    </section>
  `,
  styles: [
    `
      // See import-review-page.component.ts's own :host comment — same
      // fix, same reason (a routed page's :host needs its own min-width: 0
      // escape from .app-main's mobile 1fr grid track, mirrored from
      // AppComponent's .column-full utility class since a rule written
      // there can't reach a router-inserted sibling).
      :host {
        display: block;
        grid-column: 1 / -1;
        min-width: 0;
      }
      .page-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        padding: var(--space-lg);
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
        max-width: 960px;
        margin: 0 auto;
      }
      .card-header h2 {
        font-size: var(--font-size-xl);
        margin: 0;
      }
      .subtitle {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        margin: var(--space-xs) 0 0;
      }
    `,
  ],
})
export class ImportExamPageComponent {
  protected readonly i18n = inject(I18nService);
  readonly packId = input.required<string>();
}
