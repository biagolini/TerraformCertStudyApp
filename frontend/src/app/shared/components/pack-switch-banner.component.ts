import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { StorageService } from '../../core/services/storage.service';
import { I18nService } from '../../core/i18n/i18n.service';

/** Surfaces StorageService.pendingPackSwitch — set the instant a remote sync
 * reports a different active pack than this device's own record (see
 * StorageService.reconcileActivePackId). Deliberately never shown while on
 * `/quiz`: a conflict detected mid-attempt waits, silently, until the user
 * navigates anywhere else, so an in-progress quiz is never interrupted. */
@Component({
  selector: 'app-pack-switch-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="pack-switch-banner">
        <p>{{ i18n.t('packSwitch.message', { packName: pending()!.packName }) }}</p>
        <div class="pack-switch-actions">
          <button type="button" class="btn-ghost-sm" (click)="onStay()">{{ i18n.t('packSwitch.stay') }}</button>
          <button type="button" class="btn-switch" (click)="onSwitch()">{{ i18n.t('packSwitch.switch') }}</button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .pack-switch-banner {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-md);
        padding: var(--space-md) var(--space-lg);
        border-bottom: 1.5px solid var(--color-blue);
        background: var(--bg-elevated);
      }
      .pack-switch-banner p {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .pack-switch-actions {
        display: flex;
        gap: var(--space-sm);
        flex-shrink: 0;
      }
      .btn-ghost-sm {
        padding: 0 var(--space-md);
        min-height: var(--touch-min);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        cursor: pointer;
      }
      .btn-ghost-sm:hover {
        background: var(--bg-subtle);
      }
      .btn-switch {
        padding: 0 var(--space-md);
        min-height: var(--touch-min);
        border-radius: var(--radius-md);
        border: none;
        background: var(--color-purple);
        color: #fff;
        font-weight: 600;
        font-size: var(--font-size-sm);
        cursor: pointer;
      }
      .btn-switch:hover {
        filter: brightness(1.08);
      }
    `,
  ],
})
export class PackSwitchBannerComponent {
  private readonly storage = inject(StorageService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  protected readonly pending = this.storage.pendingPackSwitch;

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly visible = computed(() => this.pending() !== null && !this.currentUrl().startsWith('/quiz'));

  onSwitch(): void {
    const p = this.pending();
    if (!p) return;
    this.storage.pendingPackSwitch.set(null);
    void this.router.navigate(['/questions', p.packId]);
  }

  onStay(): void {
    if (!this.pending()) return;
    this.storage.pendingPackSwitch.set(null);
    this.storage.forceSyncSettings();
  }
}
