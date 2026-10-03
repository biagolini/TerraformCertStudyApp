import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PacksService } from '../../core/services/packs.service';
import { BanksService } from '../../core/services/banks.service';
import { QuestionsService } from '../../core/services/questions.service';
import { NotesService } from '../../core/services/notes.service';
import { CatalogEntry, CatalogService } from '../../core/services/catalog.service';
import { ProfileService } from '../../core/services/profile.service';
import { QuizAttemptsService } from '../../core/services/quiz-attempts.service';
import { StarterKitService } from '../../core/services/starter-kit.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PROVIDER_CATEGORIES, Pack, ProviderCategory } from '../../core/models/pack.model';
import { PackEditorComponent } from '../packs/pack-editor.component';
import { examPath } from '../../core/utils/routes.util';

type EditorState = { mode: 'new'; preset: CatalogEntry | null } | { mode: 'edit'; pack: Pack } | null;

/**
 * Home: the user's certifications ("active studies"), a catalog of
 * suggested certifications filtered by ecosystem, the add/edit certification
 * editor, and the starter kit for a first visit.
 */
@Component({
  selector: 'app-home-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NgTemplateOutlet, RouterLink, PackEditorComponent],
  template: `
    <div class="ui-page">
      <header class="ui-page-head">
        <div>
          <h1>{{ i18n.t('home.title') }}</h1>
          <p>{{ i18n.t('home.subtitle') }}</p>
        </div>
        <div class="ui-actions">
          <button type="button" class="ui-btn ui-btn-primary" (click)="openNew(null)">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
            {{ i18n.t('home.addCertification') }}
          </button>
        </div>
      </header>

      <!-- Suggested certifications -->
      <section class="ui-card suggest" [attr.aria-label]="i18n.t('home.suggestedTitle')">
        <button type="button" class="suggest-head" (click)="catalogOpen.set(!catalogOpen())" [attr.aria-expanded]="catalogOpen()">
          <span class="suggest-icon" aria-hidden="true">✦</span>
          <span class="suggest-text">
            <strong>{{ i18n.t('home.suggestedTitle') }}</strong>
            <span class="ui-muted">{{ i18n.t('home.suggestedSubtitle') }}</span>
          </span>
          @if (!profile.isEmpty() && profile.interests().size > 0) {
            <span class="ui-chip ui-chip-accent">{{ i18n.t('home.basedOnProfile') }}</span>
          } @else {
            <a routerLink="/profile" class="ui-chip" (click)="$event.stopPropagation()">{{ i18n.t('home.personalize') }}</a>
          }
          <svg class="chev" [class.open]="catalogOpen()" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
        </button>

        @if (!catalogOpen() && topSuggestions().length > 0) {
          <div class="ui-grid suggest-grid">
            @for (entry of topSuggestions(); track entry.id) {
              <ng-container *ngTemplateOutlet="catalogCard; context: { $implicit: entry }" />
            }
          </div>
        }

        @if (catalogOpen()) {
          <div class="catalog-tools">
            <div class="ui-chip-row" role="group" [attr.aria-label]="i18n.t('home.ecosystem')">
              <button type="button" class="ui-chip" [class.active]="ecosystem() === 'all'" (click)="ecosystem.set('all')">
                {{ i18n.t('home.allEcosystems') }} ({{ available().length }})
              </button>
              @for (p of providersWithEntries(); track p.id) {
                <button type="button" class="ui-chip" [class.active]="ecosystem() === p.id" (click)="ecosystem.set(p.id)">
                  {{ i18n.t('provider.' + p.id) }} ({{ p.count }})
                </button>
              }
            </div>
            <label class="ui-search">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 18a7 7 0 100-14 7 7 0 000 14zm9 2l-4-4"/></svg>
              <input class="ui-input" type="search" [(ngModel)]="catalogQuery" [placeholder]="i18n.t('home.searchCatalog')" [attr.aria-label]="i18n.t('home.searchCatalog')" />
            </label>
          </div>
          @if (filteredCatalog().length === 0) {
            <p class="ui-muted">{{ i18n.t('home.catalogEmpty') }}</p>
          } @else {
            <div class="ui-grid">
              @for (entry of filteredCatalog(); track entry.id) {
                <ng-container *ngTemplateOutlet="catalogCard; context: { $implicit: entry }" />
              }
            </div>
          }
        }
      </section>

      <ng-template #catalogCard let-entry>
        <article class="ui-card cat-card">
          <div class="cat-top">
            <span class="ui-code" [style.--chip-color]="entry.color">{{ entry.code }}</span>
            <span class="ui-chip">{{ i18n.t('level.' + entry.level) }}</span>
            @if (profile.interests().has(entry.provider)) {
              <span class="ui-chip ui-chip-accent">★ {{ i18n.t('home.interestMatch') }}</span>
            }
            @if (entry.examDurationMinutes) {
              <span class="ui-faint push">{{ i18n.t('workspace.minutes', { n: entry.examDurationMinutes }) }}</span>
            }
          </div>
          <h3>{{ entry.name }}</h3>
          <p class="ui-muted ui-clamp-2 desc">{{ entry.description }}</p>
          <div class="cat-foot">
            <span class="ui-faint">
              {{ i18n.t('home.domainsCount', { n: entry.domainCount }) }}
              @if (entry.examTotalQuestions) { · {{ i18n.t('home.questionsCount', { n: entry.examTotalQuestions }) }} }
            </span>
            <span class="ui-actions push">
              @if (entry.officialUrl) {
                <a class="ui-btn ui-btn-ghost ui-btn-sm" [href]="entry.officialUrl" target="_blank" rel="noopener noreferrer" [attr.aria-label]="i18n.t('home.officialPage') + ': ' + entry.name">{{ i18n.t('home.official') }}</a>
              }
              <button type="button" class="ui-btn ui-btn-sm" (click)="openNew(entry)">{{ i18n.t('home.customize') }}</button>
              <button type="button" class="ui-btn ui-btn-accent ui-btn-sm" [disabled]="adding() === entry.id" (click)="quickAdd(entry)">
                + {{ i18n.t('home.add') }}
              </button>
            </span>
          </div>
        </article>
      </ng-template>

      <!-- Active studies -->
      @if (packs.packs().length === 0) {
        <section class="ui-empty">
          <span class="empty-icon" aria-hidden="true">🎓</span>
          <h3>{{ i18n.t('home.emptyTitle') }}</h3>
          <p>{{ i18n.t('home.emptyBody') }}</p>
          <div class="ui-actions">
            <button type="button" class="ui-btn ui-btn-primary" (click)="openNew(null)">+ {{ i18n.t('home.addCertification') }}</button>
            <button type="button" class="ui-btn ui-btn-soft" [disabled]="loadingStarter()" (click)="loadStarter()">
              ✦ {{ loadingStarter() ? i18n.t('common.loading') : i18n.t('home.loadStarter') }}
            </button>
          </div>
          <p class="ui-faint">{{ i18n.t('home.starterHint') }}</p>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
        </section>
      } @else {
        <section class="active">
          <div class="active-head">
            <h2>{{ i18n.t('home.activeStudies') }}</h2>
            <label class="ui-search">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 18a7 7 0 100-14 7 7 0 000 14zm9 2l-4-4"/></svg>
              <input class="ui-input" type="search" [(ngModel)]="query" [placeholder]="i18n.t('common.search')" [attr.aria-label]="i18n.t('home.searchMine')" />
            </label>
            <span class="ui-faint">{{ i18n.t('home.activeCount', { shown: activeCards().length, total: packs.packs().length }) }}</span>
          </div>
          <div class="ui-grid">
            @for (card of activeCards(); track card.pack.id) {
              <article class="ui-card ui-card-hover study-card">
                <div class="study-top">
                  <span class="study-icon" [style.background]="card.pack.color" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 15a6 6 0 100-12 6 6 0 000 12zm-3.5 4.5L12 15l3.5 4.5M8.5 13.5L7 21l5-2.5L17 21l-1.5-7.5"/></svg>
                  </span>
                  <div class="study-title">
                    <div class="ui-chip-row">
                      @if (card.pack.code) {
                        <span class="ui-code" [style.--chip-color]="card.pack.color">{{ card.pack.code }}</span>
                      }
                      @if (card.status) {
                        <span class="ui-chip" [class.ui-chip-good]="card.status === 'earned'">{{ i18n.t('track.' + card.status) }}</span>
                      }
                    </div>
                    <h3>{{ card.pack.name }}</h3>
                  </div>
                  <div class="menu">
                    <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="openEdit(card.pack)" [attr.aria-label]="i18n.t('home.editCertification') + ': ' + card.pack.name">
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>
                    </button>
                  </div>
                </div>
                @if (card.pack.description) {
                  <p class="ui-muted ui-clamp-2 desc">{{ card.pack.description }}</p>
                }
                <div class="stats">
                  <div class="ui-stat"><strong>{{ card.questions }}</strong><span>{{ i18n.t('home.statQuestions') }}</span></div>
                  <div class="ui-stat"><strong>{{ card.banks }}</strong><span>{{ i18n.t('home.statBanks') }}</span></div>
                  <div class="ui-stat"><strong>{{ card.notes }}</strong><span>{{ i18n.t('home.statNotes') }}</span></div>
                  <div class="ui-stat"><strong>{{ card.attempts }}</strong><span>{{ i18n.t('home.statExams') }}</span></div>
                </div>
                <div class="study-meta">
                  <span class="ui-faint">
                    @if (card.pack.examDurationMinutes) {
                      ⏱ {{ i18n.t('workspace.minutes', { n: card.pack.examDurationMinutes }) }}
                      @if (card.pack.accommodationMinutes) {
                        <span class="extra">(+{{ card.pack.accommodationMinutes }} {{ i18n.t('home.extra') }})</span>
                      }
                    }
                  </span>
                  <span class="ui-faint">{{ i18n.t('home.lastStudied') }}: {{ lastStudied(card.pack) }}</span>
                </div>
                <a class="ui-btn open" [routerLink]="['/exam', card.pack.id]">{{ i18n.t('home.openWorkspace') }}</a>
              </article>
            }
          </div>
        </section>
      }
    </div>

    @if (editor(); as state) {
      <div class="ui-modal-backdrop" (click)="closeEditor()">
        <div class="editor-host" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <app-pack-editor
            [pack]="state.mode === 'edit' ? state.pack : null"
            [preset]="state.mode === 'new' ? state.preset : null"
            (cancelled)="closeEditor()"
            (saved)="onSaved($event, state.mode === 'new')"
            (deleted)="closeEditor()"
          />
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .suggest {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        border-color: rgba(225, 112, 85, 0.35);
        background: linear-gradient(180deg, rgba(225, 112, 85, 0.06), transparent 160px), var(--bg-surface);
      }
      .suggest-head {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        width: 100%;
        background: none;
        border: 0;
        padding: 0;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .suggest-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: var(--radius-md);
        background: rgba(225, 112, 85, 0.14);
        color: var(--color-amber);
        flex-shrink: 0;
      }
      .suggest-text {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
      }
      .suggest-text .ui-muted {
        font-size: var(--font-size-sm);
      }
      .chev {
        transition: transform var(--transition-fast);
        color: var(--text-muted);
        flex-shrink: 0;
      }
      .chev.open {
        transform: rotate(180deg);
      }
      .catalog-tools {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .cat-card,
      .study-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .cat-top {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
      }
      .push {
        margin-left: auto;
      }
      h3 {
        font-size: var(--font-size-lg);
        font-weight: 700;
        line-height: 1.3;
      }
      .desc {
        font-size: var(--font-size-sm);
      }
      .cat-foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-sm);
        margin-top: auto;
        padding-top: var(--space-sm);
        border-top: 1px solid var(--bg-border);
      }
      .active {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .active-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-md);
      }
      .active-head h2 {
        font-size: 20px;
        font-weight: 700;
      }
      .active-head .ui-faint {
        margin-left: auto;
      }
      .study-top {
        display: flex;
        gap: var(--space-sm);
        align-items: flex-start;
      }
      .study-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 38px;
        height: 38px;
        border-radius: var(--radius-md);
        flex-shrink: 0;
      }
      .study-title {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        padding: var(--space-sm) 0;
        border-top: 1px solid var(--bg-border);
        border-bottom: 1px solid var(--bg-border);
      }
      .study-meta {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-sm);
      }
      .extra {
        color: var(--color-amber);
      }
      .open {
        margin-top: auto;
        width: 100%;
      }
      .empty-icon {
        font-size: 36px;
      }
      .error {
        color: var(--color-red);
      }
      .editor-host {
        width: min(760px, 100%);
      }
    `,
  ],
})
export class HomePageComponent {
  protected readonly packs = inject(PacksService);
  private readonly banks = inject(BanksService);
  private readonly questions = inject(QuestionsService);
  private readonly notes = inject(NotesService);
  private readonly catalog = inject(CatalogService);
  protected readonly profile = inject(ProfileService);
  private readonly attempts = inject(QuizAttemptsService);
  private readonly starter = inject(StarterKitService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  readonly catalogOpen = signal(false);
  readonly ecosystem = signal<ProviderCategory | 'all'>('all');
  readonly editor = signal<EditorState>(null);
  readonly adding = signal<string | null>(null);
  readonly loadingStarter = signal(false);
  readonly error = signal<string | null>(null);
  private readonly querySignal = signal('');
  private readonly catalogQuerySignal = signal('');

  get query(): string {
    return this.querySignal();
  }
  set query(v: string) {
    this.querySignal.set(v);
  }
  get catalogQuery(): string {
    return this.catalogQuerySignal();
  }
  set catalogQuery(v: string) {
    this.catalogQuerySignal.set(v);
  }

  /** Catalog entries not already in the workspace and not marked earned in the profile. ("In progress"
   * alone does not hide an entry: a certification deleted from the workspace must be addable again.) */
  readonly available = computed(() => {
    const inWorkspace = new Set(this.packs.packs().map((p) => p.catalogId).filter(Boolean));
    const tracks = this.profile.profile().tracks;
    return this.catalog
      .entries()
      .filter((e) => !inWorkspace.has(e.id))
      .filter((e) => tracks[e.id]?.status !== 'earned');
  });

  /** Interest matches first, then backlog items, then the rest (catalog order). */
  private readonly ranked = computed(() => {
    const interests = this.profile.interests();
    const tracks = this.profile.profile().tracks;
    const score = (e: CatalogEntry) => (interests.has(e.provider) ? 2 : 0) + (tracks[e.id]?.status === 'backlog' ? 1 : 0);
    return [...this.available()].sort((a, b) => score(b) - score(a));
  });

  readonly topSuggestions = computed(() => this.ranked().slice(0, 4));

  readonly providersWithEntries = computed(() =>
    PROVIDER_CATEGORIES.map((id) => ({ id, count: this.available().filter((e) => e.provider === id).length })).filter(
      (p) => p.count > 0,
    ),
  );

  readonly filteredCatalog = computed(() => {
    const eco = this.ecosystem();
    const q = this.catalogQuerySignal().trim().toLowerCase();
    return this.ranked()
      .filter((e) => eco === 'all' || e.provider === eco)
      .filter((e) => !q || `${e.code} ${e.name} ${e.description}`.toLowerCase().includes(q));
  });

  readonly activeCards = computed(() => {
    const q = this.querySignal().trim().toLowerCase();
    const questionCounts = countBy(this.questions.allQuestions(), (x) => x.packId);
    const bankCounts = countBy(this.banks.all(), (x) => x.packId);
    const noteCounts = countBy(this.notes.all(), (x) => x.packId);
    const attemptCounts = countBy(this.attempts.finishedAttempts(), (x) => x.packId);
    return [...this.packs.packs()]
      .filter((p) => !q || `${p.code ?? ''} ${p.name}`.toLowerCase().includes(q))
      .sort((a, b) => (b.lastStudiedAt ?? b.createdAt) - (a.lastStudiedAt ?? a.createdAt))
      .map((pack) => ({
        pack,
        questions: questionCounts.get(pack.id) ?? 0,
        banks: bankCounts.get(pack.id) ?? 0,
        notes: noteCounts.get(pack.id) ?? 0,
        attempts: attemptCounts.get(pack.id) ?? 0,
        status: this.profile.statusOf(this.profile.trackKey(pack)),
      }));
  });

  constructor() {
    void this.catalog.load();
    void this.attempts.load();
  }

  openNew(preset: CatalogEntry | null): void {
    this.editor.set({ mode: 'new', preset });
  }

  openEdit(pack: Pack): void {
    this.editor.set({ mode: 'edit', pack });
  }

  closeEditor(): void {
    this.editor.set(null);
  }

  onSaved(pack: Pack, isNew: boolean): void {
    this.closeEditor();
    if (isNew) {
      this.markInProgress(pack);
      void this.router.navigate(examPath(pack.id));
    }
  }

  async quickAdd(entry: CatalogEntry): Promise<void> {
    this.adding.set(entry.id);
    this.error.set(null);
    try {
      const pack = this.packs.create(await this.catalog.draftFor(entry));
      this.markInProgress(pack);
      void this.router.navigate(examPath(pack.id));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.adding.set(null);
    }
  }

  async loadStarter(): Promise<void> {
    this.loadingStarter.set(true);
    this.error.set(null);
    try {
      const pack = await this.starter.load();
      void this.router.navigate(examPath(pack.id));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingStarter.set(false);
    }
  }

  lastStudied(pack: Pack): string {
    const ts = pack.lastStudiedAt;
    if (!ts) return this.i18n.t('home.never');
    const days = Math.floor((Date.now() - ts) / 86_400_000);
    if (days <= 0) return this.i18n.t('home.today');
    if (days === 1) return this.i18n.t('home.yesterday');
    return this.i18n.t('home.daysAgo', { n: days });
  }

  /** Adding a certification to the workspace means "currently studying" unless the profile already says otherwise. */
  private markInProgress(pack: Pack): void {
    const key = this.profile.trackKey(pack);
    if (!this.profile.statusOf(key)) this.profile.setStatus(key, 'in-progress');
  }
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return map;
}
