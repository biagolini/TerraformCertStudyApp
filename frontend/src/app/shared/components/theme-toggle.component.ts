import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SettingsService } from '../../core/services/settings.service';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="theme-toggle"
      (click)="onToggle()"
      [attr.aria-label]="ariaLabel()"
    >
      @if (isDark()) {
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <line x1="12" y1="2.5" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="21.5" />
            <line x1="2.5" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="21.5" y2="12" />
            <line x1="5.2" y1="5.2" x2="7" y2="7" />
            <line x1="17" y1="17" x2="18.8" y2="18.8" />
            <line x1="5.2" y1="18.8" x2="7" y2="17" />
            <line x1="17" y1="7" x2="18.8" y2="5.2" />
          </g>
        </svg>
      } @else {
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M20.5 14.2a8 8 0 01-10.7-10.7 1 1 0 00-1.2-1.3A10 10 0 1021.8 15.4a1 1 0 00-1.3-1.2z"
          />
        </svg>
      }
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .theme-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        transition: color var(--transition-fast), background var(--transition-fast);
      }
      .theme-toggle:hover {
        color: var(--text-primary);
        background: var(--bg-subtle);
      }
    `,
  ],
})
export class ThemeToggleComponent {
  private readonly settings = inject(SettingsService);
  private readonly themeService = inject(ThemeService);

  readonly isDark = computed(() => this.settings.theme() === 'dark');
  readonly ariaLabel = computed(() =>
    this.isDark() ? 'Switch to light mode' : 'Switch to dark mode',
  );

  onToggle(): void {
    this.themeService.toggle();
  }
}
