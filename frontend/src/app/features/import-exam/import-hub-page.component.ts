import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/components/icon.component';
import { AuthorsService } from '../../core/services/authors.service';
import { BanksService } from '../../core/services/banks.service';
import { ImportExamService } from '../../core/services/import-exam.service';
import { StorageService } from '../../core/services/storage.service';
import { ImportJob, ImportJobStatus, isImportJobRunning } from '../../core/models/import-job.model';
import { ImportJobProgressComponent } from '../../shared/components/import-job-progress.component';
import { sameAuthorName } from '../../core/models/author.model';
import { examPath, importPath } from '../../core/utils/routes.util';
import { I18nService } from '../../core/i18n/i18n.service';

const NEW_AUTHOR = '__new_author__';
const NEW_BANK = '__new__';

/**
 * /exam/:packId/import[?author=] — the import hub. First pick the author and
 * the practice exam (creating either when missing); only then does the
 * upload page for that one exam open, so a file can't land in the wrong
 * bank. Below, every import of this certification grouped by practice exam.
 */
@Component({
  selector: 'app-import-hub-page',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, ImportJobProgressComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-card">
      <a class="back-link" [routerLink]="banksLink()"><app-icon name="arrow-left" size="14" /> {{ i18n.t('banks.title') }}</a>
      <header>
        <h2>{{ i18n.t('importExam.pageTitle') }}</h2>
        <p class="subtitle">{{ i18n.t('importExam.pageSubtitle') }}</p>
      </header>

      <section class="step" [attr.aria-label]="i18n.t('importHub.chooseTitle')">
        <h3>{{ i18n.t('importHub.chooseTitle') }}</h3>
        <div class="target">
          <label class="ui-field">
            <span>{{ i18n.t('banks.author') }} *</span>
            @if (typingAuthor() || authorOptions().length === 0) {
              <input class="ui-input" type="text" [ngModel]="author()" (ngModelChange)="author.set($event)" maxlength="80" [placeholder]="i18n.t('banks.authorPlaceholder')" />
              @if (authorOptions().length > 0) {
                <button type="button" class="ui-link" (click)="pickExistingAuthor()">{{ i18n.t('authors.pickExisting') }}</button>
              }
            } @else {
              <select class="ui-input" [ngModel]="author()" (ngModelChange)="onAuthorPick($event)">
                <option value="" disabled>{{ i18n.t('authors.choose') }}</option>
                @for (name of authorOptions(); track name) {
                  <option [value]="name">{{ name }}</option>
                }
                <option [value]="NEW_AUTHOR">+ {{ i18n.t('authors.new') }}</option>
              </select>
            }
          </label>
          <label class="ui-field">
            <span>{{ i18n.t('importHub.exam') }} *</span>
            <select class="ui-input" [ngModel]="bankChoice()" (ngModelChange)="bankChoice.set($event)" [disabled]="!author().trim()">
              <option value="" disabled>{{ i18n.t('importHub.chooseExam') }}</option>
              @for (b of authorBanks(); track b.id) {
                <option [value]="b.id">{{ b.version || i18n.t('banks.noVersion') }}</option>
              }
              <option [value]="NEW_BANK">+ {{ i18n.t('importHub.newExam') }}</option>
            </select>
          </label>
          @if (bankChoice() === NEW_BANK) {
            <label class="ui-field">
              <span>{{ i18n.t('importHub.newExamName') }} *</span>
              <input class="ui-input" type="text" [ngModel]="newExamName()" (ngModelChange)="newExamName.set($event)" maxlength="120" [placeholder]="i18n.t('banks.versionPlaceholder')" />
            </label>
          }
        </div>
        <div class="ui-actions">
          <button type="button" class="ui-btn ui-btn-primary" [disabled]="!canContinue()" (click)="continue()">
            {{ i18n.t('importHub.continue') }} <app-icon name="arrow-right" size="14" />
          </button>
        </div>
      </section>

      <section class="history" [attr.aria-label]="i18n.t('importHub.historyTitle')">
        <h3>{{ i18n.t('importHub.historyTitle') }}</h3>
        @if (importService.loading()) {
          <p class="subtitle">{{ i18n.t('common.loading') }}</p>
        } @else if (history().length === 0) {
          <p class="subtitle">{{ i18n.t('importHub.historyEmpty') }}</p>
        }
        @for (h of history(); track h.bankId) {
          <article class="history-card">
            <div class="history-head">
              @if (h.exists) {
                <a class="history-title title-link" [routerLink]="examLink(h.bankId)">
                  <span class="author"><app-icon name="user" size="14" /> {{ h.author || i18n.t('banks.noAuthor') }}</span>
                  <strong>{{ h.version || i18n.t('banks.noVersion') }}</strong>
                </a>
                <a class="ui-btn ui-btn-sm" [routerLink]="examLink(h.bankId)">{{ i18n.t('importHub.open') }} <app-icon name="arrow-right" size="14" /></a>
              } @else {
                <div class="history-title">
                  <span class="author"><app-icon name="user" size="14" /> {{ h.author || i18n.t('banks.noAuthor') }}</span>
                  <strong>{{ i18n.t('importHub.deletedExam') }}</strong>
                </div>
              }
            </div>
            <ul class="job-list">
              @for (job of h.jobs; track job.id) {
                <li class="job-row">
                  <span class="job-filename" [title]="job.filename">{{ job.filename }}</span>
                  <span class="ui-faint">{{ formatDate(job.createdAt) }}</span>
                  <span class="job-badge" [class]="'job-badge ' + job.status.toLowerCase()">{{ statusLabel(job.status) }}</span>
                  @if (job.status === 'UPLOADED' && h.exists) {
                    <a class="ui-btn ui-btn-sm ui-btn-primary" [routerLink]="examLink(h.bankId)">{{ i18n.t('importHub.process') }}</a>
                  }
                  @if (job.totalQuestions != null && h.exists) {
                    <a class="ui-btn ui-btn-ghost ui-btn-sm" [routerLink]="reviewLink(job)">{{ i18n.t('importExam.reviewCount', { count: job.totalQuestions }) }}</a>
                  }
                  @if (isRunning(job)) {
                    <app-import-job-progress class="job-progress" [job]="job" />
                  }
                </li>
              }
            </ul>
          </article>
        }
      </section>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        grid-column: 1 / -1;
        min-width: 0;
      }
      .page-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-lg);
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
      h2 {
        font-size: var(--font-size-xl);
      }
      h3 {
        font-size: var(--font-size-lg);
        font-weight: 700;
      }
      .subtitle {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        margin: var(--space-xs) 0 0;
      }
      .step, .history {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .step {
        padding: var(--space-md);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
      }
      .target {
        display: grid;
        gap: var(--space-md);
        grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
      }
      .history-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: var(--space-md);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-input);
      }
      .history-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
      }
      .history-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .title-link {
        color: inherit;
        text-decoration: none;
      }
      .title-link:hover strong {
        color: var(--color-purple);
        text-decoration: underline;
      }
      .author {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--color-amber);
        font-weight: 600;
        font-size: var(--font-size-sm);
      }
      .job-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .job-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-sm);
        padding-top: var(--space-xs);
        border-top: 1px solid var(--bg-border);
      }
      .job-progress {
        flex-basis: 100%;
      }
      .job-filename {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
      }
      .job-badge {
        font-size: var(--font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted);
        background: var(--bg-surface);
        padding: 2px var(--space-sm);
        border-radius: var(--radius-pill);
        white-space: nowrap;
      }
    `,
  ],
})
export class ImportHubPageComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly importService = inject(ImportExamService);
  private readonly authors = inject(AuthorsService);
  private readonly banks = inject(BanksService);
  private readonly storage = inject(StorageService);
  private readonly router = inject(Router);

  readonly packId = input.required<string>();
  /** `?author=` preselects the author, e.g. from an author's section on the Banks page. */
  readonly author$ = input<string | undefined>(undefined, { alias: 'author' });

  protected readonly NEW_AUTHOR = NEW_AUTHOR;
  protected readonly NEW_BANK = NEW_BANK;
  protected readonly author = signal('');
  /** Typing a new author name instead of picking a registered one. */
  protected readonly typingAuthor = signal(false);
  /** A bank id, NEW_BANK, or '' (nothing chosen yet). */
  protected readonly bankChoice = signal('');
  protected readonly newExamName = signal('');
  private initialized = false;

  private readonly packBanks = computed(() => this.banks.forPack(this.packId()));

  /** Every registered author (including ones without any bank yet), plus any bank author not registered. */
  protected readonly authorOptions = computed(() => {
    const names = this.authors.authors().map((a) => a.name);
    for (const b of this.packBanks()) {
      if (b.author.trim() && !names.some((n) => sameAuthorName(n, b.author))) names.push(b.author.trim());
    }
    return names.sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }));
  });

  /** The chosen author's practice exams in this certification. */
  protected readonly authorBanks = computed(() => {
    const author = this.author().trim();
    return author ? this.packBanks().filter((b) => sameAuthorName(b.author, author)) : [];
  });

  protected readonly canContinue = computed(() => {
    if (!this.author().trim()) return false;
    const choice = this.bankChoice();
    return choice === NEW_BANK ? !!this.newExamName().trim() : this.authorBanks().some((b) => b.id === choice);
  });

  /** This certification's imports grouped by practice exam, most recent first. */
  protected readonly history = computed(() => {
    const groups = new Map<string, ImportJob[]>();
    for (const job of this.importService.jobs()) {
      if (job.packId !== this.packId()) continue;
      groups.set(job.bankId, [...(groups.get(job.bankId) ?? []), job]);
    }
    return [...groups.entries()]
      .map(([bankId, jobs]) => {
        const bank = this.banks.getById(bankId);
        return {
          bankId,
          exists: !!bank,
          author: bank?.author ?? '',
          version: bank?.version ?? '',
          jobs: [...jobs].sort((a, b) => b.createdAt - a.createdAt),
        };
      })
      .sort((a, b) => b.jobs[0].createdAt - a.jobs[0].createdAt);
  });

  constructor() {
    // Apply ?author= once the authors have loaded.
    effect(() => {
      const options = this.authorOptions();
      const wanted = (this.author$() ?? '').trim();
      untracked(() => {
        if (this.initialized || !this.storage.ready()) return;
        if (!wanted) {
          this.initialized = true;
          return;
        }
        const match = options.find((n) => sameAuthorName(n, wanted));
        if (!match) return;
        this.initialized = true;
        this.setAuthor(match);
      });
    });
    // An author with no practice exam yet goes straight to "new practice exam".
    effect(() => {
      const author = this.author().trim();
      const none = this.authorBanks().length === 0;
      untracked(() => {
        if (author && none && this.bankChoice() === '') this.bankChoice.set(NEW_BANK);
      });
    });
  }

  onAuthorPick(value: string): void {
    if (value === NEW_AUTHOR) {
      this.author.set('');
      this.typingAuthor.set(true);
      this.bankChoice.set(NEW_BANK);
    } else {
      this.setAuthor(value);
    }
  }

  pickExistingAuthor(): void {
    this.setAuthor(this.authorOptions().find((n) => sameAuthorName(n, this.author())) ?? '');
    this.typingAuthor.set(false);
  }

  /** Creates the author and the practice exam when new, then opens that exam's upload page. */
  continue(): void {
    if (!this.canContinue()) return;
    const author = this.authors.ensure(this.author())?.name ?? this.author().trim();
    let bankId = this.bankChoice();
    if (bankId === NEW_BANK) {
      const name = this.newExamName().trim();
      // Typing the name of one of the author's existing exams reuses it instead of duplicating it.
      const existing = this.packBanks().find((b) => sameAuthorName(b.author, author) && sameAuthorName(b.version, name));
      bankId = existing?.id ?? this.banks.create(this.packId(), { author, version: name, sourceUrl: '', description: '' }).id;
    }
    void this.router.navigate(this.examLink(bankId));
  }

  private setAuthor(name: string): void {
    this.author.set(name);
    this.newExamName.set('');
    this.bankChoice.set('');
  }

  statusLabel(status: ImportJobStatus): string {
    switch (status) {
      case 'AWAITING_UPLOAD':
        return this.i18n.t('importHub.statusUploading');
      case 'UPLOADED':
        return this.i18n.t('importExam.readyToProcess');
      case 'EXTRACTING':
        return this.i18n.t('importExam.extracting');
      case 'AWAITING_REVIEW':
        return this.i18n.t('importExam.readyToReview');
      case 'GENERATING':
        return this.i18n.t('importExam.generatingExplanations');
      case 'SUCCEEDED':
        return this.i18n.t('importExam.statusDone');
      case 'PARTIAL':
        return this.i18n.t('importExam.statusDonePartial');
      case 'FAILED':
        return this.i18n.t('importExam.statusFailed');
    }
  }

  isRunning(job: ImportJob): boolean {
    return isImportJobRunning(job);
  }

  formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(this.i18n.lang());
  }

  banksLink(): string[] {
    return examPath(this.packId(), 'banks');
  }

  examLink(bankId: string): string[] {
    return importPath(this.packId(), bankId);
  }

  reviewLink(job: ImportJob): string[] {
    return importPath(job.packId, job.bankId, job.id);
  }
}
