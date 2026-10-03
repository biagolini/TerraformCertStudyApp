import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ProfileService } from '../../core/services/profile.service';
import { CatalogEntry, CatalogService } from '../../core/services/catalog.service';
import { PacksService } from '../../core/services/packs.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PROVIDER_CATEGORIES, ProviderCategory } from '../../core/models/pack.model';
import { CERT_TRACK_STATUSES, CertTrackStatus, EXPERIENCE_LEVELS, StudentProfile } from '../../core/models/profile.model';
import { examPath } from '../../core/utils/routes.util';

interface TrackRow {
  key: string;
  name: string;
  code: string;
  provider: ProviderCategory;
  level: string;
  color: string;
  description: string;
  status: CertTrackStatus | null;
  earnedDate?: string;
  targetDate?: string;
  /** Pack in the workspace for this certification, if any. */
  packId: string | null;
  entry: CatalogEntry | null;
}

type IdentityDraft = Pick<StudentProfile, 'name' | 'headline' | 'bio' | 'experienceLevel' | 'linkedinUrl' | 'githubUrl' | 'otherInterests'>;

/** /profile — who the student is, which ecosystems they care about, and where each certification stands. */
@Component({
  selector: 'app-profile-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="ui-page">
      <header class="ui-page-head">
        <div>
          <h1>{{ i18n.t('profile.title') }}</h1>
          <p>{{ i18n.t('profile.subtitle') }}</p>
        </div>
        <a routerLink="/" class="ui-btn">{{ i18n.t('workspace.allCertifications') }}</a>
      </header>

      <div class="counters">
        <div class="ui-card counter"><span class="c-icon good" aria-hidden="true">🏆</span><div><strong>{{ counts().earned }}</strong><span>{{ i18n.t('profile.earnedCerts') }}</span></div></div>
        <div class="ui-card counter"><span class="c-icon warn" aria-hidden="true">🎯</span><div><strong>{{ counts().track }}</strong><span>{{ i18n.t('profile.inTrack') }}</span></div></div>
        <div class="ui-card counter"><span class="c-icon info" aria-hidden="true">📚</span><div><strong>{{ packs.packs().length }}</strong><span>{{ i18n.t('profile.activeStudies') }}</span></div></div>
      </div>

      <div class="layout">
        <div class="side">
          <form class="ui-card identity" (ngSubmit)="saveIdentity()">
            <div class="id-head">
              <span class="avatar" aria-hidden="true">{{ initials() }}</span>
              <div>
                <strong>{{ i18n.t('profile.identity') }}</strong>
                <span class="ui-faint">{{ draft.headline || i18n.t('profile.candidate') }}</span>
              </div>
            </div>
            <label class="ui-field"><span>{{ i18n.t('profile.name') }}</span><input class="ui-input" name="name" [(ngModel)]="draft.name" autocomplete="name" /></label>
            <label class="ui-field"><span>{{ i18n.t('profile.headline') }}</span><input class="ui-input" name="headline" [(ngModel)]="draft.headline" [placeholder]="i18n.t('profile.headlinePlaceholder')" /></label>
            <label class="ui-field">
              <span>{{ i18n.t('profile.experience') }}</span>
              <select class="ui-input" name="exp" [(ngModel)]="draft.experienceLevel">
                @for (l of experienceLevels; track l) {
                  <option [value]="l">{{ i18n.t('profile.exp_' + l) }}</option>
                }
              </select>
            </label>
            <label class="ui-field"><span>{{ i18n.t('profile.bio') }}</span><textarea class="ui-input" name="bio" rows="4" [(ngModel)]="draft.bio" [placeholder]="i18n.t('profile.bioPlaceholder')"></textarea></label>
            <span class="ui-label">{{ i18n.t('profile.links') }}</span>
            <input class="ui-input" name="li" type="url" [(ngModel)]="draft.linkedinUrl" placeholder="https://linkedin.com/in/…" [attr.aria-label]="'LinkedIn'" />
            <input class="ui-input" name="gh" type="url" [(ngModel)]="draft.githubUrl" placeholder="https://github.com/…" [attr.aria-label]="'GitHub'" />
            <button type="submit" class="ui-btn ui-btn-accent">{{ saved() ? '✓ ' + i18n.t('profile.saved') : i18n.t('profile.save') }}</button>
          </form>

          <section class="ui-card">
            <strong>{{ i18n.t('profile.accommodation') }}</strong>
            <p class="ui-muted small">{{ i18n.t('profile.accommodationHint') }}</p>
            <label class="switch-row">
              <input type="checkbox" [checked]="profile.profile().useAccommodationByDefault" (change)="profile.save({ useAccommodationByDefault: $any($event.target).checked })" />
              <span>{{ i18n.t('profile.useAccommodation') }}</span>
            </label>
          </section>

          <section class="ui-card interests">
            <strong>{{ i18n.t('profile.interests') }}</strong>
            <p class="ui-muted small">{{ i18n.t('profile.interestsHint') }}</p>
            @for (p of providers; track p) {
              <button type="button" class="interest" [class.on]="profile.interests().has(p)" (click)="profile.toggleInterest(p)" [attr.aria-pressed]="profile.interests().has(p)">
                <span>{{ i18n.t('provider.' + p) }}</span>
                <span class="ui-chip" [class.ui-chip-accent]="profile.interests().has(p)">{{ profile.interests().has(p) ? '✓ ' + i18n.t('profile.interested') : '+ ' + i18n.t('profile.follow') }}</span>
              </button>
            }
            @if (profile.interests().has('other')) {
              <input class="ui-input" [(ngModel)]="draft.otherInterests" (blur)="profile.save({ otherInterests: draft.otherInterests })" [placeholder]="i18n.t('profile.otherPlaceholder')" [attr.aria-label]="i18n.t('profile.otherPlaceholder')" />
            }
          </section>
        </div>

        <section class="tracker">
          <div class="ui-card tracker-head">
            <strong>{{ i18n.t('profile.tracker') }}</strong>
            <p class="ui-muted small">{{ i18n.t('profile.trackerHint') }}</p>
            <div class="ui-chip-row">
              <button type="button" class="ui-chip" [class.active]="eco() === 'all'" (click)="eco.set('all')">{{ i18n.t('home.allEcosystems') }}</button>
              @for (p of providersWithRows(); track p) {
                <button type="button" class="ui-chip" [class.active]="eco() === p" (click)="eco.set(p)">{{ i18n.t('provider.' + p) }}</button>
              }
            </div>
            <div class="filters">
              <label class="ui-search">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 18a7 7 0 100-14 7 7 0 000 14zm9 2l-4-4"/></svg>
                <input class="ui-input" type="search" [ngModel]="query()" (ngModelChange)="query.set($event)" [placeholder]="i18n.t('home.searchCatalog')" [attr.aria-label]="i18n.t('home.searchCatalog')" />
              </label>
              <select class="ui-input status-filter" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)" [attr.aria-label]="i18n.t('profile.statusFilter')">
                <option value="all">{{ i18n.t('profile.statusAll') }}</option>
                <option value="none">{{ i18n.t('profile.notPlanned') }}</option>
                @for (st of statuses; track st) {
                  <option [value]="st">{{ i18n.t('track.' + st) }}</option>
                }
              </select>
            </div>
          </div>

          @for (row of rows(); track row.key) {
            <article class="ui-card track-row">
              <span class="t-icon" [style.background]="row.color" aria-hidden="true">{{ row.code.slice(0, 3) }}</span>
              <div class="t-main">
                <div class="ui-chip-row">
                  <span class="ui-code" [style.--chip-color]="row.color">{{ row.code }}</span>
                  @if (row.level) {
                    <span class="ui-chip">{{ i18n.t('level.' + row.level) }}</span>
                  }
                  @if (profile.interests().has(row.provider)) {
                    <span class="ui-chip ui-chip-accent">★ {{ i18n.t('home.interestMatch') }}</span>
                  }
                </div>
                <h3>{{ row.name }}</h3>
                <p class="ui-muted ui-clamp-2 small">{{ row.description }}</p>
                @if (row.status === 'earned') {
                  <label class="date-row ui-faint">{{ i18n.t('profile.earnedOn') }} <input type="date" class="ui-input" [value]="row.earnedDate ?? ''" (change)="profile.setTrackDate(row.key, 'earnedDate', $any($event.target).value)" /></label>
                } @else if (row.status) {
                  <label class="date-row ui-faint">{{ i18n.t('profile.targetDate') }} <input type="date" class="ui-input" [value]="row.targetDate ?? ''" (change)="profile.setTrackDate(row.key, 'targetDate', $any($event.target).value)" /></label>
                }
              </div>
              <div class="t-side">
                <div class="segmented" role="radiogroup" [attr.aria-label]="i18n.t('profile.statusFor', { name: row.name })">
                  <button type="button" role="radio" [attr.aria-checked]="row.status === null" [class.on]="row.status === null" (click)="profile.setStatus(row.key, null)">{{ i18n.t('profile.notPlanned') }}</button>
                  @for (st of statuses; track st) {
                    <button type="button" role="radio" [attr.aria-checked]="row.status === st" [class.on]="row.status === st" (click)="profile.setStatus(row.key, st)">{{ i18n.t('track.' + st) }}</button>
                  }
                </div>
                @if (row.packId) {
                  <a class="ui-btn ui-btn-sm" [routerLink]="['/exam', row.packId]">{{ i18n.t('home.openWorkspace') }}</a>
                } @else if (row.entry) {
                  <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" [disabled]="adding() === row.key" (click)="addToWorkspace(row)">+ {{ i18n.t('profile.addToWorkspace') }}</button>
                }
              </div>
            </article>
          } @empty {
            <p class="ui-muted">{{ i18n.t('home.catalogEmpty') }}</p>
          }
        </section>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .counters {
        display: grid;
        gap: var(--space-md);
        grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
      }
      .counter {
        display: flex;
        align-items: center;
        gap: var(--space-md);
      }
      .counter strong {
        display: block;
        font-size: 24px;
        font-weight: 800;
      }
      .counter span {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
      }
      .c-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: var(--radius-md);
        font-size: 20px;
      }
      .c-icon.good {
        background: rgba(0, 184, 148, 0.12);
      }
      .c-icon.warn {
        background: rgba(225, 112, 85, 0.12);
      }
      .c-icon.info {
        background: rgba(9, 132, 227, 0.12);
      }
      .layout {
        display: grid;
        gap: var(--space-lg);
        grid-template-columns: 1fr;
      }
      @media (min-width: 1024px) {
        .layout {
          grid-template-columns: 340px minmax(0, 1fr);
        }
      }
      .side,
      .tracker {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        min-width: 0;
      }
      .identity {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .id-head {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .id-head div {
        display: flex;
        flex-direction: column;
      }
      .avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: var(--radius-md);
        background: var(--color-amber);
        color: #fff;
        font-weight: 800;
      }
      .small {
        font-size: var(--font-size-sm);
        margin: 4px 0 var(--space-sm);
      }
      .switch-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .interests {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .interest {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
        padding: 8px 12px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-input);
        color: var(--text-primary);
        font-weight: 600;
        cursor: pointer;
      }
      .interest.on {
        border-color: var(--color-amber);
      }
      .tracker-head .filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-sm);
        margin-top: var(--space-sm);
      }
      .status-filter {
        width: auto;
      }
      .track-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--space-md);
      }
      @media (min-width: 900px) {
        .track-row {
          grid-template-columns: auto minmax(0, 1fr) auto;
        }
      }
      .t-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        border-radius: var(--radius-md);
        color: #fff;
        font-weight: 800;
        font-size: var(--font-size-sm);
      }
      .t-main h3 {
        font-size: var(--font-size-lg);
        font-weight: 700;
        margin-top: 4px;
      }
      .t-side {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--space-sm);
      }
      @media (min-width: 900px) {
        .t-side {
          grid-column: auto;
        }
      }
      .segmented {
        display: inline-flex;
        flex-wrap: wrap;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        overflow: hidden;
      }
      .segmented button {
        padding: 6px 10px;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--text-muted);
        background: var(--bg-input);
        border-right: 1px solid var(--bg-border);
      }
      .segmented button:last-child {
        border-right: 0;
      }
      .segmented button.on {
        background: var(--text-primary);
        color: var(--bg-surface);
      }
      .date-row {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
      }
      .date-row input {
        width: auto;
        min-height: 30px;
        padding: 2px 6px;
      }
    `,
  ],
})
export class ProfilePageComponent implements OnInit {
  protected readonly profile = inject(ProfileService);
  private readonly catalog = inject(CatalogService);
  protected readonly packs = inject(PacksService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  protected readonly providers = PROVIDER_CATEGORIES;
  protected readonly statuses = CERT_TRACK_STATUSES;
  protected readonly experienceLevels = EXPERIENCE_LEVELS;

  protected draft: IdentityDraft = this.toDraft();
  readonly saved = signal(false);
  readonly eco = signal<ProviderCategory | 'all'>('all');
  readonly query = signal('');
  readonly statusFilter = signal<CertTrackStatus | 'none' | 'all'>('all');
  readonly adding = signal<string | null>(null);

  readonly initials = computed(() => {
    const name = this.profile.profile().name.trim();
    return name ? name.split(/\s+/).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') : '🎓';
  });

  /** Catalog certifications plus hand-made ones from the workspace, each with its track status. */
  private readonly allRows = computed<TrackRow[]>(() => {
    const tracks = this.profile.profile().tracks;
    const packsByCatalog = new Map(this.packs.packs().filter((p) => p.catalogId).map((p) => [p.catalogId!, p.id]));
    const rows: TrackRow[] = this.catalog.entries().map((e) => ({
      key: e.id,
      name: e.name,
      code: e.code,
      provider: e.provider,
      level: e.level,
      color: e.color,
      description: e.description,
      status: tracks[e.id]?.status ?? null,
      earnedDate: tracks[e.id]?.earnedDate,
      targetDate: tracks[e.id]?.targetDate,
      packId: packsByCatalog.get(e.id) ?? null,
      entry: e,
    }));
    for (const p of this.packs.packs().filter((x) => !x.catalogId)) {
      const key = this.profile.trackKey(p);
      rows.push({
        key,
        name: p.name,
        code: p.code || p.name.slice(0, 6).toUpperCase(),
        provider: p.provider ?? 'other',
        level: p.level ?? '',
        color: p.color,
        description: p.description,
        status: tracks[key]?.status ?? null,
        earnedDate: tracks[key]?.earnedDate,
        targetDate: tracks[key]?.targetDate,
        packId: p.id,
        entry: null,
      });
    }
    return rows;
  });

  readonly providersWithRows = computed(() => PROVIDER_CATEGORIES.filter((p) => this.allRows().some((r) => r.provider === p)));

  readonly rows = computed(() => {
    const eco = this.eco();
    const q = this.query().trim().toLowerCase();
    const st = this.statusFilter();
    const interests = this.profile.interests();
    return this.allRows()
      .filter((r) => eco === 'all' || r.provider === eco)
      .filter((r) => st === 'all' || (st === 'none' ? r.status === null : r.status === st))
      .filter((r) => !q || `${r.code} ${r.name} ${r.description}`.toLowerCase().includes(q))
      .sort((a, b) => Number(interests.has(b.provider)) - Number(interests.has(a.provider)));
  });

  readonly counts = computed(() => {
    const values = Object.values(this.profile.profile().tracks);
    return {
      earned: values.filter((t) => t.status === 'earned').length,
      track: values.filter((t) => t.status === 'backlog' || t.status === 'in-progress').length,
    };
  });

  ngOnInit(): void {
    void this.catalog.load();
    this.draft = this.toDraft();
  }

  saveIdentity(): void {
    this.profile.save({ ...this.draft });
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2000);
  }

  async addToWorkspace(row: TrackRow): Promise<void> {
    if (!row.entry) return;
    this.adding.set(row.key);
    try {
      const pack = this.packs.create(await this.catalog.draftFor(row.entry));
      if (!row.status || row.status === 'backlog') this.profile.setStatus(row.key, 'in-progress');
      void this.router.navigate(examPath(pack.id));
    } finally {
      this.adding.set(null);
    }
  }

  private toDraft(): IdentityDraft {
    const p = this.profile.profile();
    return {
      name: p.name,
      headline: p.headline,
      bio: p.bio,
      experienceLevel: p.experienceLevel,
      linkedinUrl: p.linkedinUrl,
      githubUrl: p.githubUrl,
      otherInterests: p.otherInterests,
    };
  }
}
