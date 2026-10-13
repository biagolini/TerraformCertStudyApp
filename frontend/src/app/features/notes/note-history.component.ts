import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { NoteVersion } from '../../core/models/note.model';
import { NotesService } from '../../core/services/notes.service';
import { SettingsService } from '../../core/services/settings.service';
import { readingThemeClass } from '../../core/models/settings.model';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/components/icon.component';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';

/**
 * Version history of a study note: every save is an S3 object version (the
 * newest 250 are kept). Pick one to read it; restoring saves that text as a
 * new version, so the body it replaces stays in the history as well.
 */
@Component({
  selector: 'app-note-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MarkdownRendererComponent],
  template: `
    <div class="ui-modal-backdrop" (click)="closed.emit()">
      <section class="ui-modal history" role="dialog" aria-modal="true" aria-labelledby="note-history-title" (click)="$event.stopPropagation()">
        <header class="ui-modal-head">
          <div>
            <h2 id="note-history-title">{{ i18n.t('notes.history') }}</h2>
            <p>{{ i18n.t('notes.historySubtitle', { n: max }) }}</p>
          </div>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="closed.emit()" [attr.aria-label]="i18n.t('common.close')"><app-icon name="x" /></button>
        </header>
        <div class="ui-modal-body body">
          @if (loading()) {
            <p class="ui-muted">{{ i18n.t('common.loading') }}</p>
          } @else if (versions().length === 0) {
            <p class="ui-muted">{{ i18n.t('notes.noVersions') }}</p>
          } @else {
            <ul class="versions">
              @for (v of versions(); track v.versionId) {
                <li>
                  <button type="button" class="version" [class.on]="selected()?.versionId === v.versionId" (click)="open(v)">
                    <span class="when">{{ formatDate(v.savedAt) }}</span>
                    <span class="meta">
                      {{ formatSize(v.size) }}
                      @if (v.isLatest) {
                        <span class="ui-chip ui-chip-accent">{{ i18n.t('notes.currentVersion') }}</span>
                      }
                    </span>
                  </button>
                </li>
              }
            </ul>
            <div class="viewer" [class]="themeClass()">
              @if (selected(); as v) {
                @if (loadingVersion()) {
                  <p class="ui-muted">{{ i18n.t('common.loading') }}</p>
                } @else if (content() !== null) {
                  <app-markdown-renderer [source]="content()!" [document]="true" />
                }
              } @else {
                <p class="ui-muted">{{ i18n.t('notes.pickVersion') }}</p>
              }
            </div>
          }
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
        </div>
        <footer class="ui-modal-foot">
          <span class="ui-faint hint">{{ i18n.t('notes.restoreHint') }}</span>
          <button type="button" class="ui-btn" (click)="closed.emit()">{{ i18n.t('common.close') }}</button>
          <button
            type="button"
            class="ui-btn ui-btn-primary"
            [disabled]="!selected() || selected()!.isLatest || content() === null || loadingVersion()"
            (click)="restore.emit(content()!)"
          ><app-icon name="rotate-ccw" /> {{ i18n.t('notes.restoreVersion') }}</button>
        </footer>
      </section>
    </div>
  `,
  styles: [
    `
      .history {
        width: min(1100px, calc(100vw - 32px));
        max-width: none;
      }
      .body {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--space-md);
        min-height: 0;
      }
      @media (min-width: 800px) {
        .body {
          grid-template-columns: 260px minmax(0, 1fr);
          height: min(65vh, 720px);
        }
      }
      .versions {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 2px;
        overflow-y: auto;
        max-height: 30vh;
      }
      @media (min-width: 800px) {
        .versions {
          max-height: none;
        }
      }
      .version {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--space-xs) var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        text-align: left;
      }
      .version:hover {
        background: var(--bg-subtle);
      }
      .version.on {
        border-color: var(--color-purple);
        background: var(--bg-subtle);
      }
      .when {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--text-primary);
      }
      .meta {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }
      .viewer {
        min-width: 0;
        overflow: auto;
        padding: var(--space-md);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
      }
      .hint {
        flex: 1;
        font-size: var(--font-size-xs);
      }
      .error {
        color: var(--color-red);
        font-size: var(--font-size-sm);
      }
    `,
  ],
})
export class NoteHistoryComponent implements OnInit {
  private readonly notes = inject(NotesService);
  protected readonly i18n = inject(I18nService);

  readonly noteId = input.required<string>();
  /** Emits the chosen version's Markdown; the editor saves it as the new body. */
  readonly restore = output<string>();
  readonly closed = output<void>();

  protected readonly max = 250;
  private readonly settings = inject(SettingsService);
  protected readonly themeClass = computed(() => readingThemeClass(this.settings.noteReadingTheme()));
  protected readonly loading = signal(true);
  protected readonly loadingVersion = signal(false);
  protected readonly versions = signal<NoteVersion[]>([]);
  protected readonly selected = signal<NoteVersion | null>(null);
  protected readonly content = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.versions.set(await this.notes.listVersions(this.noteId()));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async open(version: NoteVersion): Promise<void> {
    this.selected.set(version);
    this.content.set(null);
    this.error.set(null);
    this.loadingVersion.set(true);
    try {
      const markdown = await this.notes.loadVersion(this.noteId(), version.versionId);
      if (this.selected() === version) this.content.set(markdown);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingVersion.set(false);
    }
  }

  protected formatDate(ms: number): string {
    return new Date(ms).toLocaleString(this.i18n.lang(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected formatSize(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  }
}
