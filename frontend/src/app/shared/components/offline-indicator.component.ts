import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';

/** Renders nothing at all while online — appears the moment a token refresh
 * fails because Cognito couldn't be reached (see AuthService.offline) and
 * disappears automatically once connectivity returns, with no dropdown
 * panel needed beyond a click-to-retry affordance on the icon itself. */
@Component({
  selector: 'app-offline-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.offline()) {
      <button
        type="button"
        class="offline-pill"
        (click)="auth.retryNow()"
        [attr.aria-label]="i18n.t('offline.retryNow')"
        [title]="i18n.t('offline.retryNow')"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M2 8.5a16.5 16.5 0 0120 0M5.5 12a11.5 11.5 0 0113 0M9 15.5a6.5 6.5 0 016 0" />
          <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <span>{{ i18n.t('offline.label') }}</span>
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .offline-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 28px;
        padding: 0 var(--space-sm);
        border-radius: var(--radius-pill);
        border: 1px solid var(--color-amber);
        background: transparent;
        color: var(--color-amber);
        font-size: var(--font-size-xs);
        font-weight: 600;
        white-space: nowrap;
      }
      .offline-pill:hover {
        background: rgba(225, 112, 85, 0.08);
      }
    `,
  ],
})
export class OfflineIndicatorComponent {
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);
}
