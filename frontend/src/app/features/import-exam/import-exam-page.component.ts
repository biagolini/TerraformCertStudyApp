import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ImportExamComponent } from './import-exam.component';
import { IconComponent } from '../../shared/components/icon.component';
import { BanksService } from '../../core/services/banks.service';
import { StorageService } from '../../core/services/storage.service';
import { ImportExamService } from '../../core/services/import-exam.service';
import { importPath } from '../../core/utils/routes.util';
import { I18nService } from '../../core/i18n/i18n.service';

/** /exam/:packId/import/:bankId — attach and process the files of one
 * practice exam. The author and exam are chosen first on the import hub, so
 * every file uploaded here can only land in this bank. */
@Component({
  selector: 'app-import-exam-page',
  standalone: true,
  imports: [ImportExamComponent, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-card">
      <a class="back-link" [routerLink]="hubLink()"><app-icon name="arrow-left" size="14" /> {{ i18n.t('importExam.pageTitle') }}</a>
      @if (bank(); as b) {
        <header class="card-header">
          <span class="author"><app-icon name="user" size="14" /> {{ b.author || i18n.t('banks.noAuthor') }}</span>
          <h2>{{ b.version || i18n.t('banks.noVersion') }}</h2>
          <p class="subtitle">{{ i18n.t('importExam.bankPageSubtitle') }}</p>
        </header>
        <app-import-exam [packId]="packId()" [bankId]="b.id" />
      } @else {
        <p class="subtitle">{{ i18n.t('common.loading') }}</p>
      }
    </section>
  `,
  styles: [
    `
      // A routed page's :host needs its own min-width: 0 escape from
      // .app-main's mobile 1fr grid track (see import-review-page.component.ts).
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
      .back-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        align-self: flex-start;
        color: var(--text-muted);
        font-size: var(--font-size-sm);
        text-decoration: none;
      }
      .back-link:hover {
        color: var(--color-purple);
      }
      .author {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--color-amber);
        font-weight: 600;
        font-size: var(--font-size-sm);
      }
      .card-header h2 {
        font-size: var(--font-size-xl);
        margin: var(--space-xs) 0 0;
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
  private readonly banks = inject(BanksService);
  private readonly storage = inject(StorageService);
  private readonly importService = inject(ImportExamService);
  private readonly router = inject(Router);

  readonly packId = input.required<string>();
  readonly bankId = input.required<string>();

  protected readonly bank = computed(() => {
    const bank = this.banks.getById(this.bankId());
    return bank?.packId === this.packId() ? bank : undefined;
  });

  constructor() {
    // Old links were /import/:jobId: send those to the job's review, and a
    // deleted bank back to the hub.
    effect(() => {
      if (!this.storage.ready() || this.importService.loading() || this.bank()) return;
      const job = this.importService.jobs().find((j) => j.id === this.bankId());
      void this.router.navigate(job ? importPath(job.packId, job.bankId, job.id) : this.hubLink(), { replaceUrl: true });
    });
  }

  hubLink(): string[] {
    return importPath(this.packId());
  }
}
