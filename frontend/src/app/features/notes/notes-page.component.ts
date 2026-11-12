import { IconComponent } from '../../shared/components/icon.component';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NotesService } from '../../core/services/notes.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { examPath } from '../../core/utils/routes.util';
import { NoteEditorComponent } from './note-editor.component';
import { NoteSortMenuComponent } from './note-sort-menu.component';
import { SettingsService } from '../../core/services/settings.service';
import { NOTE_LIST_VIEWS, sortNotes } from '../../core/models/note.model';

/** /exam/:packId/notes[/:noteId] — note list, or the editor when a note is open. */
@Component({
  selector: 'app-notes-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FormsModule, RouterLink, NoteEditorComponent, NoteSortMenuComponent],
  template: `
    @if (noteId(); as id) {
      @if (notes.getById(id); as note) {
        <app-note-editor [note]="note" (back)="toList()" (deleted)="toList()" />
      } @else {
        <section class="ui-empty">
          <h3>{{ i18n.t('notes.notFound') }}</h3>
          <a class="ui-btn" [routerLink]="listLink()">{{ i18n.t('notes.backToNotes') }}</a>
        </section>
      }
    } @else {
      <div class="ui-page">
        <header class="ui-page-head">
          <div>
            <h2>{{ i18n.t('notes.title') }}</h2>
            <p>{{ i18n.t('notes.subtitle') }}</p>
          </div>
          <div class="ui-actions">
            <button type="button" class="ui-btn ui-btn-primary" [disabled]="creating()" (click)="create()"><app-icon name="plus" /> {{ i18n.t('notes.newNote') }}</button>
          </div>
        </header>

        @if (notes.notes().length > 0) {
          <div class="tools">
            <div class="search-row">
            <label class="ui-search">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 18a7 7 0 100-14 7 7 0 000 14zm9 2l-4-4"/></svg>
              <input class="ui-input" type="search" [ngModel]="query()" (ngModelChange)="query.set($event)" [placeholder]="i18n.t('notes.search')" [attr.aria-label]="i18n.t('notes.search')" />
            </label>
            <app-note-sort-menu />
            <div class="ui-segmented view-toggle" role="group" [attr.aria-label]="i18n.t('notes.viewAs')">
              @for (v of views; track v) {
                <button type="button" [class.on]="view() === v" [attr.aria-pressed]="view() === v" (click)="settings.setNoteListView(v)" [attr.aria-label]="i18n.t('notes.view_' + v)" [title]="i18n.t('notes.view_' + v)">
                  <app-icon [name]="v === 'cards' ? 'layout-grid' : 'list'" size="16" />
                </button>
              }
            </div>
            </div>
            @if (tags().length > 0) {
              <div class="ui-chip-row">
                @for (t of tags(); track t) {
                  <button type="button" class="ui-chip" [class.active]="tag() === t" (click)="tag.set(tag() === t ? '' : t)">#{{ t }}</button>
                }
              </div>
            }
          </div>
        }

        @if (notes.notes().length === 0) {
          <section class="ui-empty">
            <span class="icon" aria-hidden="true"><app-icon name="file-text" size="28" /></span>
            <h3>{{ i18n.t('notes.emptyTitle') }}</h3>
            <p>{{ i18n.t('notes.emptyBody') }}</p>
            <button type="button" class="ui-btn ui-btn-primary" [disabled]="creating()" (click)="create()"><app-icon name="plus" /> {{ i18n.t('notes.newNote') }}</button>
          </section>
        } @else if (view() === 'table') {
          @if (filtered().length === 0) {
            <p class="ui-muted">{{ i18n.t('notes.noMatch') }}</p>
          } @else {
            <div class="ui-card table-wrap">
              <table class="note-table">
                <thead>
                  <tr>
                    <th scope="col">{{ i18n.t('notes.sort_title') }}</th>
                    <th scope="col" class="col-tags">{{ i18n.t('notes.tags') }}</th>
                    <th scope="col" class="num">{{ i18n.t('notes.sort_wordCount') }}</th>
                    <th scope="col" class="col-created">{{ i18n.t('notes.sort_createdAt') }}</th>
                    <th scope="col">{{ i18n.t('notes.sort_updatedAt') }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (n of filtered(); track n.id) {
                    <!-- The whole row opens the note; the title link keeps it reachable by keyboard. -->
                    <tr (click)="open(n.id)">
                      <td class="col-title">
                        <a [routerLink]="noteLink(n.id)" (click)="$event.stopPropagation()">{{ n.title || i18n.t('notes.untitled') }}</a>
                        <span class="ui-faint ui-clamp-2 row-excerpt">{{ n.excerpt || i18n.t('notes.emptyNote') }}</span>
                      </td>
                      <td class="col-tags">
                        @if (n.tags.length) {
                          <div class="ui-chip-row">
                            @for (t of n.tags; track t) {
                              <span class="ui-chip">#{{ t }}</span>
                            }
                          </div>
                        }
                      </td>
                      <td class="num">{{ n.wordCount }}</td>
                      <td class="col-created">{{ formatDate(n.createdAt) }}</td>
                      <td>{{ formatDate(n.updatedAt) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        } @else {
          <div class="ui-grid">
            @for (n of filtered(); track n.id) {
              <a class="ui-card ui-card-hover note-card" [routerLink]="noteLink(n.id)">
                <h3>{{ n.title }}</h3>
                <p class="ui-muted ui-clamp-2 excerpt">{{ n.excerpt || i18n.t('notes.emptyNote') }}</p>
                @if (n.tags.length) {
                  <div class="ui-chip-row">
                    @for (t of n.tags; track t) {
                      <span class="ui-chip">#{{ t }}</span>
                    }
                  </div>
                }
                <span class="ui-faint meta">{{ i18n.t('notes.words', { n: n.wordCount }) }} · {{ formatDate(n.updatedAt) }}</span>
              </a>
            } @empty {
              <p class="ui-muted">{{ i18n.t('notes.noMatch') }}</p>
            }
          </div>
        }
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        grid-column: 1 / -1;
        min-width: 0;
      }
      .tools {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .search-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-sm);
      }
      .search-row .ui-search {
        flex: 1 1 240px;
      }
      .view-toggle > button {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
      }
      .table-wrap {
        padding: 0;
        /* A narrow phone scrolls the table sideways instead of squeezing the title. */
        overflow-x: auto;
      }
      .note-table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--font-size-sm);
      }
      .note-table th,
      .note-table td {
        padding: var(--space-sm) var(--space-md);
        text-align: left;
        vertical-align: top;
        border-bottom: 1px solid var(--bg-border);
      }
      .note-table thead th {
        font-size: var(--font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-faint);
        white-space: nowrap;
      }
      .note-table tbody tr {
        cursor: pointer;
        transition: background var(--transition-fast);
      }
      .note-table tbody tr:hover {
        background: var(--bg-subtle);
      }
      .note-table tbody tr:last-child td {
        border-bottom: 0;
      }
      .note-table td:not(.col-title):not(.col-tags) {
        white-space: nowrap;
        color: var(--text-muted);
      }
      .col-title {
        min-width: 220px;
      }
      .col-title a {
        display: block;
        font-weight: 700;
        color: var(--text-primary);
        text-decoration: none;
      }
      .col-title a:hover {
        color: var(--color-purple);
      }
      .row-excerpt {
        font-size: var(--font-size-xs);
      }
      .num {
        text-align: right !important;
        font-variant-numeric: tabular-nums;
      }
      @media (max-width: 640px) {
        .col-created,
        .col-tags {
          display: none;
        }
      }
      .note-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        color: inherit;
        text-decoration: none;
        min-height: 150px;
      }
      .note-card h3 {
        font-size: var(--font-size-lg);
        font-weight: 700;
      }
      .excerpt {
        font-size: var(--font-size-sm);
      }
      .meta {
        margin-top: auto;
      }
      .icon {
        font-size: 32px;
      }
      .error {
        color: var(--color-red);
      }
    `,
  ],
})
export class NotesPageComponent {
  protected readonly notes = inject(NotesService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);
  protected readonly settings = inject(SettingsService);
  protected readonly views = NOTE_LIST_VIEWS;
  /** Cards or table; saved in the user's settings, so it follows them across visits and browsers. */
  readonly view = this.settings.noteListView;

  readonly packId = input.required<string>();
  readonly noteId = input<string | null>(null);

  readonly query = signal('');
  readonly tag = signal('');
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);

  readonly tags = computed(() => [...new Set(this.notes.notes().flatMap((n) => n.tags))].sort());

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const tag = this.tag();
    const matching = this.notes
      .notes()
      .filter((n) => !tag || n.tags.includes(tag))
      .filter((n) => !q || `${n.title} ${n.excerpt} ${n.tags.join(' ')}`.toLowerCase().includes(q));
    return sortNotes(matching, this.settings.noteSort(), this.i18n.lang());
  });

  listLink(): string[] {
    return examPath(this.packId(), 'notes');
  }

  noteLink(id: string): string[] {
    return examPath(this.packId(), 'notes', id);
  }

  open(id: string): void {
    void this.router.navigate(this.noteLink(id));
  }

  toList(): void {
    void this.router.navigate(this.listLink());
  }

  async create(): Promise<void> {
    this.creating.set(true);
    this.error.set(null);
    try {
      const note = await this.notes.create(this.packId(), this.i18n.t('notes.untitled'));
      void this.router.navigate(this.noteLink(note.id));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.creating.set(false);
    }
  }

  formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(this.i18n.lang(), { dateStyle: 'medium' });
  }
}
