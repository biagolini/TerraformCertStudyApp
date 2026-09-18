import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NAV_ITEMS } from './core/models/nav-item.model';
import { PacksService } from './core/services/packs.service';
import { QuestionsService } from './core/services/questions.service';
import { AuthService } from './core/services/auth.service';
import { SettingsService } from './core/services/settings.service';
import { ThemeService } from './core/services/theme.service';
import { PacksDrawerComponent } from './features/packs/packs-drawer.component';
import { SettingsComponent } from './features/settings/settings.component';
import { ThemeToggleComponent } from './shared/components/theme-toggle.component';
import { SyncStatusComponent } from './shared/components/sync-status.component';
import { ImportStatusPillComponent } from './shared/components/import-status-pill.component';

@Component({
  selector: 'app-main',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    SettingsComponent,
    PacksDrawerComponent,
    ThemeToggleComponent,
    SyncStatusComponent,
    ImportStatusPillComponent,
  ],
  styleUrl: './app.component.scss',
  template: `
    <div
      class="shell"
      [style.--pack-color]="activePackColor()"
      [style.--pack-color-soft]="activePackColorSoft()"
    >
      <header class="app-header">
        <button type="button" class="brand" (click)="openPacks()" aria-label="Open pack switcher">
          <span class="brand-mark" aria-hidden="true"></span>
          <span class="brand-text">
            <span class="brand-title">{{ activePackName() }}</span>
            @if (activePackVersion()) {
              <span class="brand-version">{{ activePackVersion() }}</span>
            } @else {
              <span class="brand-subtitle">Tap to switch pack</span>
            }
          </span>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" class="brand-chev">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <div class="header-actions">
          <app-import-status-pill />
          <app-sync-status />
          <app-theme-toggle />
          <button type="button" class="icon-btn" (click)="openSettings()" aria-label="Open settings">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/>
              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M19.4 13.5l1.6 1-2 3.4-1.9-.6a7.6 7.6 0 01-2 1.2l-.5 2H10.4l-.5-2a7.6 7.6 0 01-2-1.2l-1.9.6-2-3.4 1.6-1A7.6 7.6 0 014.5 12c0-.5.1-1 .2-1.5l-1.6-1 2-3.4 1.9.6a7.6 7.6 0 012-1.2l.5-2h4.2l.5 2c.7.3 1.4.7 2 1.2l1.9-.6 2 3.4-1.6 1c.1.5.2 1 .2 1.5s-.1 1-.2 1.5z"/>
            </svg>
          </button>
          <button type="button" class="icon-btn" (click)="onLogout()" aria-label="Sign out">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M15 12H4m0 0l3.5-3.5M4 12l3.5 3.5M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4"/>
            </svg>
          </button>
        </div>
      </header>

      <main class="app-main">
        <router-outlet />
      </main>

      <nav class="tabbar" aria-label="Primary">
        @for (item of visibleNavItems(); track item.id) {
          <a
            [routerLink]="item.path"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: false }"
            class="tab"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" [attr.d]="item.icon"/>
            </svg>
            <span>{{ item.label }}</span>
            @if (item.id === 'export' && selectedCount() > 0) {
              <span class="badge">{{ selectedCount() }}</span>
            }
          </a>
        }
      </nav>

      @if (packsOpen()) {
        <div class="overlay" (click)="closePacks()" aria-hidden="true"></div>
        <aside class="drawer-host drawer-host-left" role="dialog" aria-label="Exam packs">
          <app-packs-drawer (closed)="closePacks()" />
        </aside>
      }

      @if (settingsOpen()) {
        <div class="overlay" (click)="closeSettings()" aria-hidden="true"></div>
        <aside class="drawer-host" role="dialog" aria-label="Settings">
          <app-settings (closed)="closeSettings()" />
        </aside>
      }
    </div>
  `,
})
export class AppComponent {
  private readonly packs = inject(PacksService);
  private readonly questionsService = inject(QuestionsService);
  private readonly auth = inject(AuthService);
  private readonly settingsService = inject(SettingsService);
  protected readonly themeService = inject(ThemeService);

  protected readonly settingsOpen = signal(false);
  protected readonly packsOpen = signal(false);

  readonly visibleNavItems = computed(() => {
    const hidden = this.settingsService.hiddenNavTabs();
    return NAV_ITEMS.filter((item) => !hidden.includes(item.id));
  });

  readonly activePackName = computed(() => this.packs.activePack().name);
  readonly activePackVersion = computed(() => this.packs.activePack().version);
  readonly activePackColor = computed(() => this.packs.activeColor());
  readonly activePackColorSoft = computed(() => withAlpha(this.activePackColor(), 0.16));

  readonly selectedCount = this.questionsService.selectedCount;

  constructor() {
    effect(() => {
      const anyOpen = this.settingsOpen() || this.packsOpen();
      if (typeof document === 'undefined') return;
      document.body.style.overflow = anyOpen ? 'hidden' : '';
    });
  }

  openSettings(): void { this.settingsOpen.set(true); }
  closeSettings(): void { this.settingsOpen.set(false); }
  onLogout(): void { this.auth.logout(); }
  openPacks(): void { this.packsOpen.set(true); }
  closePacks(): void { this.packsOpen.set(false); }
}

function withAlpha(hexColor: string, alpha: number): string {
  const match = /^#?([a-f\d]{6})$/i.exec(hexColor.trim());
  if (!match) return hexColor;
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
