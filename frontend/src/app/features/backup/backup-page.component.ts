import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { BACKUP_TABLES, BackupService, BackupTable } from '../../core/services/backup.service';
import { StorageService } from '../../core/services/storage.service';
import { PacksService } from '../../core/services/packs.service';
import { sameAuthorName } from '../../core/models/author.model';
import { IconComponent } from '../../shared/components/icon.component';
import { I18nService } from '../../core/i18n/i18n.service';
import { slugify } from '../../core/utils/file-splitter.util';

/**
 * /backup — download the student's own data: a ZIP with one JSON file per
 * table, or any single table, for every certification or just one. Only the
 * signed-in account's data is ever fetched (the API is partitioned by user).
 */
@Component({
  selector: 'app-backup-page',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page">
      <header class="ui-page-head">
        <div>
          <h2>{{ i18n.t('backup.title') }}</h2>
          <p>{{ i18n.t('backup.subtitle') }}</p>
        </div>
      </header>

      <section class="ui-card block">
        <span class="ui-label">{{ i18n.t('backup.scope') }}</span>
        <div class="ui-chip-row" role="radiogroup" [attr.aria-label]="i18n.t('backup.scope')">
          <button type="button" role="radio" class="ui-chip" [class.active]="scope() === null" [attr.aria-checked]="scope() === null" (click)="scope.set(null)">
            {{ i18n.t('backup.allCertifications') }}
          </button>
          @for (p of packs.packs(); track p.id) {
            <button type="button" role="radio" class="ui-chip" [class.active]="scope() === p.id" [attr.aria-checked]="scope() === p.id" (click)="scope.set(p.id)">
              {{ p.code || p.name }}
            </button>
          }
        </div>
        <div class="ui-actions">
          <button type="button" class="ui-btn ui-btn-primary" [disabled]="busy() !== null" (click)="downloadAll()">
            <app-icon name="download" /> {{ busy() === 'all' ? i18n.t('backup.preparing') : i18n.t('backup.downloadZip') }}
          </button>
        </div>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </section>

      <section class="ui-card block">
        <span class="ui-label">{{ i18n.t('backup.tables') }}</span>
        <ul class="tables">
          @for (t of tables(); track t.name) {
            <li class="table-row">
              <div class="table-main">
                <strong class="mono">{{ t.name }}.json</strong>
                <span class="ui-faint">{{ i18n.t('backup.table.' + t.name) }}</span>
              </div>
              <span class="ui-chip mono">{{ t.count ?? '…' }}</span>
              <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" [disabled]="busy() !== null" (click)="downloadTable(t.name)" [attr.aria-label]="i18n.t('backup.downloadTable', { name: t.name })">
                <app-icon name="download" size="14" /> {{ busy() === t.name ? i18n.t('backup.preparing') : '.json' }}
              </button>
            </li>
          }
        </ul>
        <p class="ui-faint">{{ i18n.t('backup.imagesNote') }}</p>
        <p class="ui-faint">{{ i18n.t('settings.privacyNote') }}</p>
      </section>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        grid-column: 1 / -1;
        min-width: 0;
      }
      .block {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .tables {
        display: flex;
        flex-direction: column;
      }
      .table-row {
        display: flex;
        align-items: center;
        gap: var(--space-md);
        padding: var(--space-sm) 0;
        border-top: 1px solid var(--bg-border);
      }
      .table-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
      }
      .mono {
        font-family: var(--font-mono);
      }
      .error {
        color: var(--color-red);
        font-size: var(--font-size-sm);
      }
    `,
  ],
})
export class BackupPageComponent {
  private readonly backup = inject(BackupService);
  private readonly storage = inject(StorageService);
  protected readonly packs = inject(PacksService);
  protected readonly i18n = inject(I18nService);

  /** Certification id, or null for all of them. */
  readonly scope = signal<string | null>(null);
  readonly busy = signal<'all' | BackupTable | null>(null);
  readonly error = signal<string | null>(null);
  private readonly attemptPackIds = signal<string[] | null>(null);

  /** Row per table with its item count in the current scope (null while unknown). */
  readonly tables = computed(() => {
    const packId = this.scope();
    const inPack = (items: { packId: string }[]) => (packId ? items.filter((i) => i.packId === packId).length : items.length);
    const banks = this.storage.getBanks().filter((b) => !packId || b.packId === packId);
    const authors = this.storage.getAuthors();
    const attempts = this.attemptPackIds();
    const counts: Record<BackupTable, number | null> = {
      certifications: packId ? 1 : this.storage.getPacks().length,
      banks: banks.length,
      authors: packId ? authors.filter((a) => banks.some((b) => sameAuthorName(b.author, a.name))).length : authors.length,
      questions: inPack(this.storage.getQuestions()),
      notes: inPack(this.storage.getNotes()),
      transcripts: inPack(this.storage.getScripts()),
      chats: inPack(this.storage.getChats()),
      attempts: attempts === null ? null : packId ? attempts.filter((id) => id === packId).length : attempts.length,
      settings: 1,
      profile: this.storage.getProfile() ? 1 : 0,
    };
    return BACKUP_TABLES.filter((name) => !packId || (name !== 'settings' && name !== 'profile')).map((name) => ({ name, count: counts[name] }));
  });

  constructor() {
    // Attempts are not part of the main /data payload; count them once.
    effect(() => {
      if (!this.storage.ready() || this.attemptPackIds() !== null) return;
      void this.storage.listAttempts().then((list) => this.attemptPackIds.set(list.map((a) => a.packId)));
    });
  }

  async downloadAll(): Promise<void> {
    await this.run('all', () => this.backup.downloadZip(this.scope(), this.fileStem()));
  }

  async downloadTable(name: BackupTable): Promise<void> {
    await this.run(name, () => this.backup.downloadTable(name, this.scope(), this.fileStem()));
  }

  private fileStem(): string {
    const pack = this.scope() ? this.packs.getById(this.scope()!) : null;
    return pack ? `cert-study-backup-${slugify(pack.code || pack.name)}` : 'cert-study-backup';
  }

  private async run(what: 'all' | BackupTable, task: () => Promise<void>): Promise<void> {
    this.busy.set(what);
    this.error.set(null);
    try {
      await task();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(null);
    }
  }
}
