import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
import { Pack } from '../../core/models/pack.model';
import { CertificationDialogComponent } from '../packs/certification-dialog.component';
import { examPath } from '../../core/utils/routes.util';

type DialogState = { mode: 'new'; preset: CatalogEntry | null } | { mode: 'edit'; pack: Pack } | null;

/** Per-device preference: whether the suggestions strip is collapsed. Unset = collapsed once the user has a certification. */
const SUGGESTIONS_KEY = 'cert_study__home_suggestions_collapsed';
const STRIP_SIZE = 4;

/**
 * Home: the certifications the student is working on come first; a compact
 * strip of suggested certifications sits above them (collapsible, and
 * collapsed by default once there is something to study). The full catalog
 * lives in the "Add certification" dialog, not on this page.
 */
@Component({
  selector: 'app-home-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, CertificationDialogComponent],
  template: `
    <div class="ui-page">
      <header class="ui-page-head">
        <div>
          <h1>{{ i18n.t('home.title') }}</h1>
          <p>{{ i18n.t('home.subtitle') }}</p>
        </div>
        <button type="button" class="ui-btn ui-btn-primary" (click)="openNew(null)">+ {{ i18n.t('home.addCertification') }}</button>
      </header>

      @if (strip().length > 0) {
        <section class="suggest" [class.collapsed]="collapsed()" [attr.aria-label]="i18n.t('home.suggestedTitle')">
          <div class="suggest-head">
            <span class="suggest-icon" aria-hidden="true">✦</span>
            <div class="suggest-text">
              <strong>{{ i18n.t('home.suggestedTitle') }}</strong>
              @if (!collapsed()) {
                <span class="ui-muted">{{ i18n.t('home.suggestedSubtitle') }}</span>
              }
            </div>
            <div class="suggest-actions">
              @if (!collapsed()) {
                <a routerLink="/profile" class="ui-chip ui-chip-accent">👤 {{ i18n.t('home.personalize') }}</a>
              }
              <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" (click)="openNew(null)">{{ i18n.t('home.browseAll', { n: available().length }) }} ›</button>
              <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="toggleCollapsed()" [attr.aria-expanded]="!collapsed()" [attr.aria-label]="collapsed() ? i18n.t('home.showSuggestions') : i18n.t('home.hideSuggestions')">
                <svg class="chev" [class.open]="!collapsed()" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
          </div>
          @if (!collapsed()) {
            <div class="strip">
              @for (e of strip(); track e.id) {
                <article class="mini">
                  <div class="mini-top">
                    <span class="ui-code" [style.--chip-color]="e.color">{{ e.code }}</span>
                    @if (profile.interests().has(e.provider)) {
                      <span class="ui-chip ui-chip-accent tiny">★ {{ i18n.t('home.interestMatch') }}</span>
                    }
                    @if (e.examDurationMinutes) {
                      <span class="ui-faint push">⏱ {{ e.examDurationMinutes }}m</span>
                    }
                  </div>
                  <h3 class="mini-name">{{ e.name }}</h3>
                  <p class="ui-muted ui-clamp-2 mini-desc">{{ e.description }}</p>
                  <div class="mini-foot">
                    <span class="ui-faint">{{ i18n.t('home.domainsCount', { n: e.domainCount }) }}</span>
                    <span class="push ui-actions">
                      <button type="button" class="ui-btn ui-btn-sm" (click)="openNew(e)">{{ i18n.t('home.prefill') }}</button>
                      <button type="button" class="ui-btn ui-btn-sm add" [disabled]="adding() === e.id" (click)="quickAdd(e)">+ {{ i18n.t('home.add') }}</button>
                    </span>
                  </div>
                </article>
              }
            </div>
          }
        </section>
      }

      @if (packs.packs().length === 0) {
        <section class="ui-empty empty">
          <span class="empty-icon" aria-hidden="true">🎖</span>
          <h3>{{ i18n.t('home.emptyTitle') }}</h3>
          <p>{{ i18n.t('home.emptyBody') }}</p>
          @if (quickStart().length > 0) {
            <div class="quick">
              @for (e of quickStart(); track e.id) {
                <button type="button" class="quick-card" [disabled]="adding() === e.id" (click)="quickAdd(e)">
                  <span class="ui-code" [style.--chip-color]="e.color">{{ e.code }}</span>
                  <strong>{{ e.name }}</strong>
                  <span class="ui-muted ui-clamp-2 mini-desc">{{ e.description }}</span>
                  <span class="quick-foot">
                    <span>
                      @if (e.examDurationMinutes) { {{ e.examDurationMinutes }} min · }
                      {{ i18n.t('home.domainsCount', { n: e.domainCount }) }}
                    </span>
                    <span>{{ i18n.t('home.start') }} ›</span>
                  </span>
                </button>
              }
            </div>
          }
          <div class="ui-actions">
            <button type="button" class="ui-btn ui-btn-primary" (click)="openNew(null)">+ {{ i18n.t('home.addCertification') }}</button>
            <button type="button" class="ui-btn ui-btn-soft" [disabled]="loadingStarter()" (click)="loadStarter()">
              ✦ {{ loadingStarter() ? i18n.t('common.loading') : i18n.t('home.loadStarter') }}
            </button>
          </div>
          <p class="ui-faint">{{ i18n.t('home.starterHint') }}</p>
        </section>
      } @else {
        <section class="active" [attr.aria-label]="i18n.t('home.activeStudies')">
          <div class="active-head">
            <label class="ui-search">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 18a7 7 0 100-14 7 7 0 000 14zm9 2l-4-4"/></svg>
              <input class="ui-input" type="search" [ngModel]="query()" (ngModelChange)="query.set($event)" [placeholder]="i18n.t('common.search')" [attr.aria-label]="i18n.t('home.searchMine')" />
            </label>
            <span class="ui-faint push">{{ i18n.t('home.activeCount', { shown: cards().length, total: packs.packs().length }) }}</span>
          </div>
          <div class="ui-grid study-grid">
            @for (card of cards(); track card.pack.id) {
              <article class="ui-card ui-card-hover study">
                <div class="study-top">
                  <span class="study-icon" [style.background]="card.pack.color" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 15a6 6 0 100-12 6 6 0 000 12zm-3.5 4.5L12 15l3.5 4.5M8.5 13.5L7 21l5-2.5L17 21l-1.5-7.5"/></svg>
                  </span>
                  <div class="study-title">
                    <div class="ui-chip-row">
                      @if (card.pack.code) {
                        <span class="ui-chip mono">{{ card.pack.code }}</span>
                      }
                      @if (card.status) {
                        <span class="ui-chip" [class.ui-chip-good]="card.status === 'earned'">{{ i18n.t('track.' + card.status) }}</span>
                      }
                    </div>
                    <h3>{{ card.pack.name }}</h3>
                  </div>
                  <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="openEdit(card.pack)" [attr.aria-label]="i18n.t('home.editCertification') + ': ' + card.pack.name" [title]="i18n.t('home.editCertification')">⋮</button>
                </div>
                @if (card.pack.description) {
                  <p class="ui-muted ui-clamp-2 desc">{{ card.pack.description }}</p>
                }
                <div class="stats">
                  <div class="ui-stat"><strong>{{ card.notes }}</strong><span>{{ i18n.t('home.statNotes') }}</span></div>
                  <div class="ui-stat"><strong>{{ card.questions }}</strong><span>{{ i18n.t('home.statQuestions') }}</span></div>
                  <div class="ui-stat"><strong>{{ card.banks }}</strong><span>{{ i18n.t('home.statBanks') }}</span></div>
                  <div class="ui-stat"><strong>{{ card.attempts }}</strong><span>{{ i18n.t('home.statExams') }}</span></div>
                </div>
                <div class="study-meta ui-faint">
                  <span>
                    @if (card.pack.examDurationMinutes) {
                      ⏱ {{ i18n.t('workspace.minutes', { n: card.pack.examDurationMinutes }) }}
                      @if (card.pack.accommodationMinutes) {
                        <span class="extra">(+{{ card.pack.accommodationMinutes }}m {{ i18n.t('home.extra') }})</span>
                      }
                    }
                  </span>
                  <span>{{ i18n.t('home.lastStudied') }}: <strong>{{ lastStudied(card.pack) }}</strong></span>
                </div>
                <a class="ui-btn open" [routerLink]="['/exam', card.pack.id]">{{ i18n.t('home.openWorkspace') }}</a>
              </article>
            } @empty {
              <p class="ui-muted">{{ i18n.t('home.catalogEmpty') }}</p>
            }
          </div>
        </section>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </div>

    @if (dialog(); as d) {
      <app-certification-dialog
        [pack]="d.mode === 'edit' ? d.pack : null"
        [preset]="d.mode === 'new' ? d.preset : null"
        (cancelled)="dialog.set(null)"
        (saved)="onSaved($event.pack, $event.created)"
        (deleted)="dialog.set(null)"
      />
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
        padding: var(--space-md);
        border: 1px solid rgba(225, 112, 85, 0.3);
        border-radius: var(--radius-lg);
        background: linear-gradient(180deg, rgba(225, 112, 85, 0.06), transparent 140px), var(--bg-surface);
      }
      .suggest.collapsed {
        padding: 10px var(--space-md);
        background: var(--bg-surface);
        border-color: var(--bg-border);
      }
      .suggest-head {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex-wrap: wrap;
      }
      .suggest-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: var(--radius-md);
        background: rgba(225, 112, 85, 0.14);
        color: var(--color-amber);
        flex-shrink: 0;
      }
      .suggest-text {
        display: flex;
        flex-direction: column;
        flex: 1 1 240px;
        min-width: 0;
        line-height: 1.3;
      }
      .suggest-text .ui-muted {
        font-size: var(--font-size-sm);
      }
      .suggest-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
      }
      .chev {
        transition: transform var(--transition-fast);
      }
      .chev.open {
        transform: rotate(180deg);
      }
      .strip {
        display: grid;
        gap: var(--space-sm);
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      @media (max-width: 1024px) {
        .strip {
          grid-template-columns: none;
          grid-auto-flow: column;
          grid-auto-columns: minmax(240px, 1fr);
          overflow-x: auto;
          padding-bottom: 4px;
        }
      }
      .mini {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        padding: 12px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
      }
      .mini-top {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--font-size-xs);
      }
      .tiny {
        font-size: var(--font-size-xs);
        padding: 0 6px;
      }
      .push {
        margin-left: auto;
      }
      .mini-name {
        font-size: var(--font-size-base);
        font-weight: 700;
        line-height: 1.3;
      }
      .mini-desc {
        font-size: var(--font-size-sm);
      }
      .mini-foot {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: auto;
        padding-top: 8px;
        border-top: 1px solid var(--bg-border);
        font-size: var(--font-size-xs);
      }
      .add {
        background: var(--color-amber);
        border-color: var(--color-amber);
        color: #fff;
      }
      .add:hover:not(:disabled) {
        filter: brightness(1.05);
        background: var(--color-amber);
      }
      .empty {
        gap: var(--space-md);
        padding: var(--space-xl) var(--space-lg);
      }
      .empty-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        border-radius: var(--radius-lg);
        background: rgba(225, 112, 85, 0.12);
        font-size: 26px;
      }
      .quick {
        display: grid;
        gap: var(--space-md);
        grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
        width: min(620px, 100%);
      }
      .quick-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        padding: var(--space-md);
        text-align: left;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        background: var(--bg-surface);
        color: var(--text-primary);
        cursor: pointer;
      }
      .quick-card:hover {
        border-color: var(--color-amber);
      }
      .quick-foot {
        display: flex;
        justify-content: space-between;
        width: 100%;
        padding-top: 8px;
        margin-top: auto;
        border-top: 1px solid var(--bg-border);
        color: var(--color-amber);
        font-size: var(--font-size-sm);
        font-weight: 600;
      }
      .active {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .active-head {
        display: flex;
        align-items: center;
        gap: var(--space-md);
      }
      .study-grid {
        grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr));
      }
      .study {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
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
        margin-top: 2px;
      }
      .study-title {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .study-title h3 {
        font-size: var(--font-size-lg);
        font-weight: 700;
        line-height: 1.3;
      }
      .mono {
        font-family: var(--font-mono);
      }
      .desc {
        font-size: var(--font-size-sm);
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
      .study-meta strong {
        color: var(--text-secondary);
      }
      .extra {
        color: var(--color-amber);
      }
      .open {
        margin-top: auto;
        width: 100%;
        background: var(--bg-elevated);
      }
      .error {
        color: var(--color-red);
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

  readonly dialog = signal<DialogState>(null);
  readonly adding = signal<string | null>(null);
  readonly loadingStarter = signal(false);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  private readonly collapsedPref = signal<boolean | null>(readCollapsedPref());

  /** Collapsed by default once the student has a certification; an explicit choice is remembered on this device. */
  readonly collapsed = computed(() => this.collapsedPref() ?? this.packs.packs().length > 0);

  /** Catalog entries not yet in the workspace and not marked earned in the profile, best match first. */
  readonly available = computed(() => {
    const inWorkspace = new Set(this.packs.packs().map((p) => p.catalogId).filter(Boolean));
    const tracks = this.profile.profile().tracks;
    const interests = this.profile.interests();
    const score = (e: CatalogEntry) => (interests.has(e.provider) ? 2 : 0) + (tracks[e.id]?.status === 'backlog' ? 1 : 0);
    return this.catalog
      .entries()
      .filter((e) => !inWorkspace.has(e.id) && tracks[e.id]?.status !== 'earned')
      .sort((a, b) => score(b) - score(a));
  });

  readonly strip = computed(() => this.available().slice(0, STRIP_SIZE));
  readonly quickStart = computed(() => this.available().slice(0, 2));

  readonly cards = computed(() => {
    const q = this.query().trim().toLowerCase();
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

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsedPref.set(next);
    try {
      localStorage.setItem(SUGGESTIONS_KEY, String(next));
    } catch {
      /* storage unavailable: the choice lasts for this page view only */
    }
  }

  openNew(preset: CatalogEntry | null): void {
    this.dialog.set({ mode: 'new', preset });
  }

  openEdit(pack: Pack): void {
    this.dialog.set({ mode: 'edit', pack });
  }

  onSaved(pack: Pack, created: boolean): void {
    this.dialog.set(null);
    if (created) {
      this.markInProgress(pack);
      void this.router.navigate(examPath(pack.id));
    }
  }

  async quickAdd(entry: CatalogEntry): Promise<void> {
    this.adding.set(entry.id);
    this.error.set(null);
    try {
      const pack = this.packs.create(await this.catalog.draftFor(entry));
      this.banks.ensureDefault(pack.id);
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

function readCollapsedPref(): boolean | null {
  try {
    const v = localStorage.getItem(SUGGESTIONS_KEY);
    return v === null ? null : v === 'true';
  } catch {
    return null;
  }
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return map;
}
