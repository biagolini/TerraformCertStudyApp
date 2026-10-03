import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Question } from '../../core/models/question.model';
import { QuestionBank } from '../../core/models/bank.model';
import { QuestionsService } from '../../core/services/questions.service';
import { BanksService } from '../../core/services/banks.service';
import { PacksService } from '../../core/services/packs.service';
import { ViewportService } from '../../core/services/viewport.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { ALL_BANKS, examPath, questionPath } from '../../core/utils/routes.util';
import { QuestionInputComponent } from '../question-input/question-input.component';
import { QuestionListComponent } from '../question-list/question-list.component';
import { ReviewViewerComponent } from '../review-viewer/review-viewer.component';
import { BankEditorComponent } from '../banks/bank-editor.component';

/**
 * /exam/:packId/banks/:bankId[/:questionId] — the question browser for one
 * bank, or for every bank of the certification when bankId is `all`. A
 * full-width bank header (metadata, domain breakdown that doubles as a
 * filter) sits above the list + viewer columns of the workspace grid.
 */
@Component({
  selector: 'app-questions-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, QuestionInputComponent, QuestionListComponent, ReviewViewerComponent, BankEditorComponent],
  template: `
    @if (!(isMobile() && questionId())) {
      <section class="bank-head ui-card">
        <div class="head-row">
          <a class="ui-btn ui-btn-sm" [routerLink]="banksLink()">← {{ i18n.t('banks.title') }}</a>
          <div class="head-title">
            @if (bank(); as b) {
              <span class="author">👤 {{ b.author || i18n.t('banks.noAuthor') }}</span>
              <h2>{{ b.name }} @if (b.version) { <span class="ui-faint">· {{ b.version }}</span> }</h2>
              @if (b.description) {
                <p class="ui-muted desc">{{ b.description }}</p>
              }
            } @else {
              <h2>{{ i18n.t('banks.allQuestions') }}</h2>
              <p class="ui-muted desc">{{ i18n.t('banks.allQuestionsHint') }}</p>
            }
          </div>
          <div class="ui-actions">
            <label class="bank-switch">
              <span class="ui-sr-only">{{ i18n.t('banks.switchBank') }}</span>
              <select class="ui-input" [value]="bankId()" (change)="switchBank($any($event.target).value)">
                <option [value]="all">{{ i18n.t('banks.allQuestions') }}</option>
                @for (b of banks.banks(); track b.id) {
                  <option [value]="b.id">{{ b.name }}</option>
                }
              </select>
            </label>
            @if (bank(); as b) {
              @if (b.sourceUrl) {
                <a class="ui-btn ui-btn-sm" [href]="b.sourceUrl" target="_blank" rel="noopener noreferrer">{{ i18n.t('banks.source') }} ↗</a>
              }
              <button type="button" class="ui-btn ui-btn-sm" (click)="editingBank.set(true)">{{ i18n.t('common.edit') }}</button>
              <a class="ui-btn ui-btn-sm ui-btn-soft" [routerLink]="importLink()" [queryParams]="{ bank: b.id }">✦ {{ i18n.t('banks.importAi') }}</a>
            }
            <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" (click)="toggleAdd()" [attr.aria-expanded]="adding()">
              {{ adding() ? i18n.t('banks.closeAdd') : '+ ' + i18n.t('banks.addQuestion') }}
            </button>
          </div>
        </div>
        @if (domainCards().length > 0) {
          <div class="domains">
            <div class="domains-title">
              <span class="ui-label">{{ i18n.t('banks.domainBreakdown', { n: scopeTotal() }) }}</span>
              @if (questions.domainFilter()) {
                <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" (click)="questions.domainFilter.set('')">{{ i18n.t('banks.clearFilter') }}</button>
              }
            </div>
            <div class="domain-grid">
              @for (d of domainCards(); track d.name) {
                <button type="button" class="domain-card" [class.active]="questions.domainFilter() === d.name" (click)="toggleDomain(d.name)" [attr.aria-pressed]="questions.domainFilter() === d.name">
                  <span class="d-top"><span class="ui-label">{{ d.label }}</span><span class="pct">{{ d.pct }}%</span></span>
                  <span class="d-name">{{ d.name }}</span>
                  <span class="mono">{{ i18n.t('banks.qs', { n: d.count }) }}</span>
                </button>
              }
            </div>
          </div>
        }
        @if (adding() && banks.banks().length > 0) {
          <label class="target-bank">
            <span>{{ i18n.t('banks.addInto') }}</span>
            <select class="ui-input" [value]="targetBankId()" (change)="targetBankId.set($any($event.target).value)">
              @for (b of banks.banks(); track b.id) {
                <option [value]="b.id">{{ b.name }}</option>
              }
            </select>
          </label>
        }
      </section>
    }

    @if (showLeftColumn()) {
      <section class="column column-left">
        <div class="stack">
          @if (adding() && !(isMobile() && questionId())) {
            <app-question-input [bankId]="targetBankId()" (generated)="onGenerated($event)" />
          }
          @if (showListPanel()) {
            <app-question-list [activeId]="questionId()" (opened)="onOpenQuestion($event)" />
          }
        </div>
      </section>
    }
    @if (showViewerPanel()) {
      <section class="column column-right">
        <app-review-viewer
          [question]="activeQuestion()"
          [showBackButton]="isMobile()"
          (back)="onCloseViewer()"
          (newQuestion)="onNewQuestion()"
          (deleted)="onQuestionDeleted($event)"
        />
        @if (activeQuestion(); as q) {
          @if (banks.banks().length > 1) {
            <label class="move-bank ui-faint">
              {{ i18n.t('banks.moveTo') }}
              <select class="ui-input" [value]="q.bankId" (change)="moveQuestion(q, $any($event.target).value)">
                @for (b of banks.banks(); track b.id) {
                  <option [value]="b.id">{{ b.name }}</option>
                }
              </select>
            </label>
          }
        }
      </section>
    }

    @if (editingBank() && bank()) {
      <app-bank-editor
        [packId]="packId()"
        [bank]="bank()"
        (closed)="editingBank.set(false)"
        (saved)="editingBank.set(false)"
        (deleted)="onBankDeleted()"
      />
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .bank-head {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        min-width: 0;
      }
      .head-row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-md);
      }
      .head-title {
        flex: 1 1 280px;
        min-width: 0;
      }
      .head-title h2 {
        font-size: 20px;
        font-weight: 800;
      }
      .author {
        color: var(--color-amber);
        font-weight: 600;
        font-size: var(--font-size-sm);
      }
      .desc {
        font-size: var(--font-size-sm);
        margin-top: 2px;
      }
      .bank-switch select {
        min-height: 32px;
        padding: 4px 8px;
        max-width: 220px;
      }
      .domains-title {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        margin-bottom: var(--space-sm);
      }
      .domain-grid {
        display: grid;
        gap: var(--space-sm);
        grid-template-columns: repeat(auto-fill, minmax(min(170px, 100%), 1fr));
      }
      .domain-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: var(--space-sm) var(--space-md);
        text-align: left;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        color: inherit;
        cursor: pointer;
      }
      .domain-card:hover,
      .domain-card.active {
        border-color: var(--pack-color, var(--color-purple));
      }
      .domain-card.active {
        background: var(--pack-color-soft, rgba(108, 92, 231, 0.12));
      }
      .d-top {
        display: flex;
        justify-content: space-between;
      }
      .pct {
        color: var(--color-amber);
        font-weight: 700;
        font-size: var(--font-size-sm);
      }
      .d-name {
        font-weight: 600;
        font-size: var(--font-size-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mono {
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
      }
      .target-bank,
      .move-bank {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        font-size: var(--font-size-sm);
      }
      .target-bank select,
      .move-bank select {
        width: auto;
        min-height: 32px;
        padding: 4px 8px;
      }
      .move-bank {
        margin-top: var(--space-sm);
      }
      .column {
        min-width: 0;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
    `,
  ],
})
export class QuestionsPageComponent {
  private readonly router = inject(Router);
  protected readonly questions = inject(QuestionsService);
  protected readonly banks = inject(BanksService);
  private readonly packs = inject(PacksService);
  private readonly viewport = inject(ViewportService);
  protected readonly i18n = inject(I18nService);

  readonly packId = input.required<string>();
  readonly bankId = input<string>(ALL_BANKS);
  readonly questionId = input<string | null>(null);
  /** `?add=1` opens the add-question form (Banks page "Add question" button). */
  readonly add = input<string | undefined>(undefined);

  protected readonly all = ALL_BANKS;
  readonly isMobile = this.viewport.isMobile;
  readonly adding = signal(false);
  readonly editingBank = signal(false);
  readonly targetBankId = signal('');

  readonly bank = computed<QuestionBank | null>(() => {
    const id = this.bankId();
    return id && id !== ALL_BANKS ? (this.banks.getById(id) ?? null) : null;
  });

  // questions() is already scoped to the active certification (the route
  // resolver made it active), so a question id from another certification
  // can never be opened here by editing the URL.
  readonly activeQuestion = computed<Question | null>(() => {
    const id = this.questionId();
    if (!id) return null;
    return this.questions.questions().find((q) => q.id === id) ?? null;
  });

  /** Bank-scoped (domain filter ignored) so the breakdown always shows every domain's share. */
  private readonly scopeQuestions = computed(() => {
    const bank = this.bankId();
    return this.questions.questions().filter((q) => bank === ALL_BANKS || q.bankId === bank);
  });
  readonly scopeTotal = computed(() => this.scopeQuestions().length);

  readonly domainCards = computed(() => {
    const total = this.scopeTotal();
    const domains = [...this.packs.activeDomains()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    const known = new Set(domains.map((d) => d.name));
    const cards = domains.map((d, i) => {
      const count = this.scopeQuestions().filter((q) => q.domain === d.name).length;
      return { label: `D${d.order ?? i + 1}`, name: d.name, count, pct: total ? Math.round((count / total) * 100) : 0 };
    });
    const other = this.scopeQuestions().filter((q) => !known.has(q.domain));
    for (const name of [...new Set(other.map((q) => q.domain))]) {
      const count = other.filter((q) => q.domain === name).length;
      cards.push({ label: '·', name, count, pct: total ? Math.round((count / total) * 100) : 0 });
    }
    return cards;
  });

  readonly showListPanel = computed(() => !this.isMobile() || !this.questionId());
  readonly showViewerPanel = computed(() => !this.isMobile() || !!this.questionId());
  readonly showLeftColumn = computed(() => this.adding() || this.showListPanel());

  constructor() {
    effect(() => {
      // Keep the shared filter in sync with the URL; reset the domain filter on bank change.
      this.questions.bankFilter.set(this.bankId() || ALL_BANKS);
    });
    effect(() => {
      // Default "add into" bank: the bank being viewed, else keep the user's pick, else the first bank.
      const b = this.bank();
      const list = this.banks.banks();
      untracked(() => {
        const current = this.targetBankId();
        if (b) this.targetBankId.set(b.id);
        else if (!list.some((x) => x.id === current)) this.targetBankId.set(list[0]?.id ?? '');
      });
    });
    effect(() => {
      if (this.add()) this.adding.set(true);
    });
    let lastBank: string | null = null;
    effect(() => {
      const id = this.bankId();
      if (lastBank !== null && lastBank !== id) this.questions.domainFilter.set('');
      lastBank = id;
    });
  }

  banksLink(): string[] {
    return examPath(this.packId(), 'banks');
  }

  importLink(): string[] {
    return examPath(this.packId(), 'import');
  }

  toggleAdd(): void {
    this.adding.update((v) => !v);
  }

  toggleDomain(name: string): void {
    this.questions.domainFilter.set(this.questions.domainFilter() === name ? '' : name);
  }

  switchBank(id: string): void {
    void this.router.navigate(questionPath(this.packId(), id));
  }

  moveQuestion(q: Question, bankId: string): void {
    if (bankId && bankId !== q.bankId) this.questions.moveToBank([q.id], bankId);
  }

  onGenerated(question: Question): void {
    void this.router.navigate(questionPath(this.packId(), this.bankId(), question.id));
  }

  onOpenQuestion(question: Question): void {
    void this.router.navigate(questionPath(this.packId(), this.bankId(), question.id));
  }

  onCloseViewer(): void {
    void this.router.navigate(questionPath(this.packId(), this.bankId()));
  }

  onNewQuestion(): void {
    this.adding.set(true);
    void this.router.navigate(questionPath(this.packId(), this.bankId()));
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  onQuestionDeleted(id: string): void {
    if (this.questionId() === id) void this.router.navigate(questionPath(this.packId(), this.bankId()));
  }

  onBankDeleted(): void {
    this.editingBank.set(false);
    void this.router.navigate(this.banksLink());
  }
}
