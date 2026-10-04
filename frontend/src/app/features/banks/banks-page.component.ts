import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { BanksService, groupByAuthor } from '../../core/services/banks.service';
import { QuestionsService } from '../../core/services/questions.service';
import { PacksService } from '../../core/services/packs.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { QuestionBank, bankLabel } from '../../core/models/bank.model';
import { IconComponent } from '../../shared/components/icon.component';
import { ALL_BANKS, examPath, questionPath } from '../../core/utils/routes.util';
import { BankEditorComponent } from './bank-editor.component';

interface BankCard {
  bank: QuestionBank;
  total: number;
  /** Count per certification domain, in the certification's domain order (D1, D2, ...). */
  perDomain: { label: string; name: string; count: number }[];
}

/** /exam/:packId/banks — every question bank of the certification, grouped by author. */
@Component({
  selector: 'app-banks-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BankEditorComponent, IconComponent],
  template: `
    <div class="ui-page">
      <header class="ui-page-head">
        <div>
          <h2>{{ i18n.t('banks.title') }}</h2>
          <p>{{ i18n.t('banks.subtitle') }}</p>
        </div>
        <div class="ui-actions">
          <a class="ui-btn ui-btn-soft" [routerLink]="importLink()"><app-icon name="sparkles" /> {{ i18n.t('banks.importAi') }}</a>
          <button type="button" class="ui-btn" (click)="editing.set('new')"><app-icon name="plus" /> {{ i18n.t('banks.newBank') }}</button>
          <a class="ui-btn ui-btn-primary" [routerLink]="allLink()" [queryParams]="{ add: 1 }"><app-icon name="plus" /> {{ i18n.t('banks.addQuestion') }}</a>
        </div>
      </header>

      @if (cards().length === 0) {
        <section class="ui-empty">
          <h3>{{ i18n.t('banks.emptyTitle') }}</h3>
          <p>{{ i18n.t('banks.emptyBody') }}</p>
          <div class="ui-actions">
            <button type="button" class="ui-btn ui-btn-primary" (click)="editing.set('new')"><app-icon name="plus" /> {{ i18n.t('banks.newBank') }}</button>
            <a class="ui-btn ui-btn-soft" [routerLink]="importLink()"><app-icon name="sparkles" /> {{ i18n.t('banks.importAi') }}</a>
          </div>
        </section>
      } @else {
        <div class="filter-row">
          <span class="ui-label">{{ i18n.t('banks.filterByAuthor') }}</span>
          <div class="ui-chip-row">
            <button type="button" class="ui-chip" [class.active]="author() === null" (click)="author.set(null)">
              {{ i18n.t('banks.allAuthors') }} ({{ cards().length }})
            </button>
            @for (group of groups(); track group.author) {
              <button type="button" class="ui-chip" [class.active]="author() === group.author" (click)="author.set(group.author)">
                {{ group.author || i18n.t('banks.noAuthor') }} ({{ group.banks.length }})
              </button>
            }
          </div>
        </div>

        <a class="ui-card ui-card-hover all-card" [routerLink]="allLink()">
          <div>
            <strong>{{ i18n.t('banks.allQuestions') }}</strong>
            <p class="ui-muted">{{ i18n.t('banks.allQuestionsHint') }}</p>
          </div>
          <span class="ui-chip">{{ i18n.t('banks.questionsN', { n: totalQuestions() }) }}</span>
        </a>

        <div class="ui-grid">
          @for (card of visibleCards(); track card.bank.id) {
            <article class="ui-card ui-card-hover bank-card">
              <div class="bank-top">
                <span class="author"><app-icon name="user" size="14" /> {{ card.bank.author || i18n.t('banks.noAuthor') }}</span>
                <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" (click)="editing.set(card.bank)" [attr.aria-label]="i18n.t('banks.editBank') + ': ' + label(card.bank)">
                  {{ i18n.t('common.edit') }}
                </button>
              </div>
              <a class="bank-link" [routerLink]="bankLink(card.bank.id)">
                <h3>{{ card.bank.version || i18n.t('banks.noVersion') }}</h3>
                @if (card.bank.description) {
                  <p class="ui-muted ui-clamp-2 desc">{{ card.bank.description }}</p>
                }
              </a>
              @if (card.perDomain.length > 0) {
                <div class="ui-chip-row">
                  @for (d of card.perDomain; track d.label) {
                    <span class="ui-chip mono" [title]="d.name">{{ d.label }}: {{ d.count }}</span>
                  }
                </div>
              }
              <div class="bank-foot">
                <strong class="mono">{{ i18n.t('banks.questionsN', { n: card.total }) }}</strong>
                <span class="ui-faint">{{ i18n.t('banks.updated', { date: formatDate(card.bank.updatedAt) }) }}</span>
                @if (card.bank.sourceUrl) {
                  <a class="ui-btn ui-btn-ghost ui-btn-sm" [href]="card.bank.sourceUrl" target="_blank" rel="noopener noreferrer">{{ i18n.t('banks.source') }} <app-icon name="external-link" size="14" /></a>
                }
              </div>
            </article>
          }
        </div>
      }
    </div>

    @if (editing(); as target) {
      <app-bank-editor
        [packId]="packId()"
        [bank]="target === 'new' ? null : target"
        (closed)="editing.set(null)"
        (saved)="onSaved($event, target === 'new')"
        (deleted)="editing.set(null)"
      />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        grid-column: 1 / -1;
        min-width: 0;
      }
      .filter-row {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .all-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-md);
        text-decoration: none;
        color: inherit;
        border-style: dashed;
      }
      .bank-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .bank-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .author {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--color-amber);
        font-weight: 600;
        font-size: var(--font-size-sm);
      }
      .bank-link {
        color: inherit;
        text-decoration: none;
      }
      .bank-link:hover h3 {
        color: var(--pack-color, var(--color-purple));
      }
      h3 {
        font-size: var(--font-size-lg);
        font-weight: 700;
      }
      .desc {
        font-size: var(--font-size-sm);
        margin-top: 4px;
      }
      .mono {
        font-family: var(--font-mono);
      }
      .bank-foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-sm);
        margin-top: auto;
        padding-top: var(--space-sm);
        border-top: 1px solid var(--bg-border);
      }
    `,
  ],
})
export class BanksPageComponent {
  private readonly banks = inject(BanksService);
  private readonly questions = inject(QuestionsService);
  private readonly packs = inject(PacksService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  readonly packId = input.required<string>();

  readonly author = signal<string | null>(null);
  readonly editing = signal<QuestionBank | 'new' | null>(null);

  readonly totalQuestions = computed(() => this.questions.questions().length);

  readonly cards = computed<BankCard[]>(() => {
    const domains = [...this.packs.activeDomains()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    const all = this.questions.questions();
    return this.banks.banks().map((bank) => {
      const own = all.filter((q) => q.bankId === bank.id);
      return {
        bank,
        total: own.length,
        perDomain: domains.map((d, i) => ({
          label: `D${d.order ?? i + 1}`,
          name: d.name,
          count: own.filter((q) => q.domain === d.name).length,
        })),
      };
    });
  });

  readonly groups = computed(() => groupByAuthor(this.banks.banks()));

  readonly visibleCards = computed(() => {
    const author = this.author();
    return author === null ? this.cards() : this.cards().filter((c) => c.bank.author.trim() === author);
  });

  allLink(): string[] {
    return questionPath(this.packId(), ALL_BANKS);
  }

  bankLink(bankId: string): string[] {
    return questionPath(this.packId(), bankId);
  }

  importLink(): string[] {
    return examPath(this.packId(), 'import');
  }

  label(bank: QuestionBank): string {
    return bankLabel(bank, this.i18n.t('banks.untitled'));
  }

  formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(this.i18n.lang());
  }

  onSaved(bank: QuestionBank, isNew: boolean): void {
    this.editing.set(null);
    if (isNew) void this.router.navigate(this.bankLink(bank.id));
  }
}
