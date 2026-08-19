import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { StorageService } from '../../core/services/storage.service';

@Component({
  selector: 'app-sync-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sync-wrap">
      <button
        type="button"
        class="sync-toggle"
        [class.error]="isError()"
        [class.spinning]="isSyncing()"
        (click)="onClick()"
        [attr.aria-label]="ariaLabel()"
        [title]="ariaLabel()"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M4 4v5h5M20 20v-5h-5"
          />
        </svg>
        @if (isError()) {
          <span class="dot" aria-hidden="true"></span>
        }
      </button>

      @if (panelOpen()) {
        <div class="sync-panel" role="dialog" aria-label="Sync status">
          @if (isError()) {
            <p class="panel-title error-title">Sync failed</p>
            <p class="panel-body">{{ storage.lastError() }}</p>
            <p class="panel-hint">Your changes are still saved on this device. They'll sync once this succeeds.</p>
            <button type="button" class="retry-btn" (click)="onRetry()">
              @if (isSyncing()) { Retrying… } @else { Try again }
            </button>
          } @else if (isSyncing()) {
            <p class="panel-title">Syncing…</p>
            <p class="panel-body">Pulling the latest questions, packs, and chats.</p>
          } @else {
            <p class="panel-title">Up to date</p>
            <p class="panel-body">{{ lastSyncedLabel() }}</p>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        position: relative;
      }
      .sync-wrap {
        position: relative;
        display: inline-flex;
      }
      .sync-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        position: relative;
        transition: color var(--transition-fast), background var(--transition-fast);
      }
      .sync-toggle:hover {
        color: var(--text-primary);
        background: var(--bg-subtle);
      }
      .sync-toggle.error {
        color: var(--color-red);
      }
      .sync-toggle.spinning svg {
        animation: sync-spin 900ms linear infinite;
      }
      .dot {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--color-red);
        border: 2px solid var(--bg-surface);
      }
      .sync-panel {
        position: absolute;
        top: calc(var(--touch-min) + 6px);
        right: 0;
        width: 260px;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        padding: var(--space-md);
        z-index: 40;
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .panel-title {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--text-primary);
      }
      .error-title {
        color: var(--color-red);
      }
      .panel-body {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        line-height: 1.45;
      }
      .panel-hint {
        font-size: var(--font-size-xs);
        color: var(--text-muted);
        line-height: 1.45;
      }
      .retry-btn {
        align-self: flex-start;
        margin-top: var(--space-xs);
        height: 32px;
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-red);
        background: transparent;
        color: var(--color-red);
        font-weight: 600;
        font-size: var(--font-size-sm);
      }
      .retry-btn:hover {
        background: var(--color-red);
        color: #ffffff;
      }
      @keyframes sync-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class SyncStatusComponent {
  protected readonly storage = inject(StorageService);

  protected readonly panelOpen = signal(false);

  readonly isSyncing = computed(() => this.storage.syncStatus() === 'syncing');
  readonly isError = computed(() => this.storage.syncStatus() === 'error');

  readonly lastSyncedLabel = computed(() => {
    const at = this.storage.lastSyncedAt();
    if (!at) return 'Not synced yet.';
    return `Last synced ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });

  readonly ariaLabel = computed(() => {
    if (this.isError()) return 'Sync failed — click for details';
    if (this.isSyncing()) return 'Syncing…';
    return this.lastSyncedLabel();
  });

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('click', (event) => {
        if (!this.panelOpen()) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('app-sync-status')) return;
        this.panelOpen.set(false);
      });
    }
  }

  onClick(): void {
    if (this.isError()) {
      this.panelOpen.update((open) => !open);
      return;
    }
    if (this.panelOpen()) {
      this.panelOpen.set(false);
      return;
    }
    this.panelOpen.set(true);
    void this.storage.refresh();
  }

  onRetry(): void {
    void this.storage.refresh();
  }
}
