import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { PacksService } from './core/services/packs.service';
import { AuthService } from './core/services/auth.service';
import { ThemeService } from './core/services/theme.service';
import { ThemeToggleComponent } from './shared/components/theme-toggle.component';
import { SyncStatusComponent } from './shared/components/sync-status.component';
import { ImportStatusPillComponent } from './shared/components/import-status-pill.component';
import { OfflineIndicatorComponent } from './shared/components/offline-indicator.component';
import { I18nService } from './core/i18n/i18n.service';
import { withAlpha } from './core/utils/color.util';
import { IconComponent } from './shared/components/icon.component';

/**
 * Authenticated layout: a sticky header (brand → Home, breadcrumb to the
 * open certification, global actions) and the routed page. Certification
 * tabs live in ExamWorkspaceComponent, not here, so global pages (Home,
 * Profile, Settings, Costs) never show a certification context they don't have.
 */
@Component({
  selector: 'app-main',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    ThemeToggleComponent,
    SyncStatusComponent,
    ImportStatusPillComponent,
    OfflineIndicatorComponent,
  ],
  styleUrl: './app.component.scss',
  template: `
    <div class="shell" [style.--pack-color]="packColor()" [style.--pack-color-soft]="packColorSoft()">
      <header class="app-header">
        <div class="header-left">
          <a routerLink="/" class="brand" [attr.aria-label]="i18n.t('app.home')">
            <span class="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M2 9l10-5 10 5-10 5L2 9zm4 2v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>
              </svg>
            </span>
            <span class="brand-text">
              <span class="brand-title">Cert Study</span>
              <span class="brand-subtitle">{{ i18n.t('app.tagline') }}</span>
            </span>
          </a>
          @if (workspacePack(); as pack) {
            <svg class="crumb-sep" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9 6l6 6-6 6"/>
            </svg>
            <a class="crumb" [routerLink]="['/exam', pack.id]" [title]="pack.name">
              <span class="crumb-dot" [style.background]="pack.color" aria-hidden="true"></span>
              @if (pack.code) {
                <span class="crumb-code">{{ pack.code }}</span>
              }
              <span class="crumb-name">{{ pack.name }}</span>
            </a>
          }
        </div>
        <nav class="header-actions" [attr.aria-label]="i18n.t('app.globalNav')">
          <app-offline-indicator />
          <app-import-status-pill />
          <app-sync-status />
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" class="icon-btn" [attr.aria-label]="i18n.t('app.home')" [title]="i18n.t('app.home')">
            <app-icon name="home" size="20" />
          </a>
          <a routerLink="/costs" routerLinkActive="active" class="icon-btn" [attr.aria-label]="i18n.t('app.costs')" [title]="i18n.t('app.costs')">
            <app-icon name="circle-dollar" size="20" />
          </a>
          <a routerLink="/profile" routerLinkActive="active" class="icon-btn" [attr.aria-label]="i18n.t('app.profile')" [title]="i18n.t('app.profile')">
            <app-icon name="user" size="20" />
          </a>
          <app-theme-toggle />
          <a routerLink="/settings" routerLinkActive="active" class="icon-btn" [attr.aria-label]="i18n.t('app.openSettings')" [title]="i18n.t('app.openSettings')">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/>
              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M19.4 13.5l1.6 1-2 3.4-1.9-.6a7.6 7.6 0 01-2 1.2l-.5 2H10.4l-.5-2a7.6 7.6 0 01-2-1.2l-1.9.6-2-3.4 1.6-1A7.6 7.6 0 014.5 12c0-.5.1-1 .2-1.5l-1.6-1 2-3.4 1.9.6a7.6 7.6 0 012-1.2l.5-2h4.2l.5 2c.7.3 1.4.7 2 1.2l1.9-.6 2 3.4-1.6 1c.1.5.2 1 .2 1.5s-.1 1-.2 1.5z"/>
            </svg>
          </a>
          <button type="button" class="icon-btn" (click)="onLogout()" [attr.aria-label]="i18n.t('app.signOut')" [title]="i18n.t('app.signOut')">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M15 12H4m0 0l3.5-3.5M4 12l3.5 3.5M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4"/>
            </svg>
          </button>
        </nav>
      </header>

      <main class="app-main">
        <router-outlet />
      </main>
    </div>
  `,
})
export class AppComponent {
  private readonly packs = inject(PacksService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly themeService = inject(ThemeService);
  protected readonly i18n = inject(I18nService);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** The certification whose workspace is open, or null on global pages. */
  readonly workspacePack = computed(() => {
    const match = /^\/exam\/([^/?#]+)/.exec(this.url());
    return match ? (this.packs.getById(decodeURIComponent(match[1])) ?? null) : null;
  });

  readonly packColor = computed(() => this.workspacePack()?.color ?? 'var(--color-purple)');
  readonly packColorSoft = computed(() => {
    const color = this.workspacePack()?.color;
    return color ? withAlpha(color, 0.16) : 'rgba(108, 92, 231, 0.16)';
  });

  onLogout(): void {
    this.auth.logout();
  }
}
