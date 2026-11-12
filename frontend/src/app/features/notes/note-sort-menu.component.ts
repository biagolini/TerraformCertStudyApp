import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { NOTE_SORT_FIELDS, NoteSortDir, NoteSortField } from '../../core/models/note.model';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/components/icon.component';

/**
 * "Sort" menu of the notes list: one field (modified, created, title, word
 * count) and a direction. The choice is saved in the user's settings, so the
 * list opens the same way next time.
 */
@Component({
  selector: 'app-note-sort-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <button type="button" class="ui-btn ui-btn-sm trigger" (click)="open.set(!open())" aria-haspopup="menu" [attr.aria-expanded]="open()" [title]="i18n.t('notes.sortBy')">
      <app-icon [name]="sort().dir === 'asc' ? 'arrow-up' : 'arrow-down'" size="14" />
      <span class="trigger-label">{{ i18n.t('notes.sortBy') }}:</span>
      <strong>{{ i18n.t('notes.sort_' + sort().field) }}</strong>
      <app-icon name="chevron-down" size="14" />
    </button>
    @if (open()) {
      <div class="menu" role="menu" [attr.aria-label]="i18n.t('notes.sortBy')">
        @for (f of fields; track f) {
          <button type="button" role="menuitemradio" class="item" [class.on]="sort().field === f" [attr.aria-checked]="sort().field === f" (click)="pick(f)">
            <span class="check" aria-hidden="true">
              @if (sort().field === f) {
                <app-icon name="check" size="14" />
              }
            </span>
            {{ i18n.t('notes.sort_' + f) }}
          </button>
        }
        <div class="sep" aria-hidden="true"></div>
        <div class="ui-segmented dir" role="group" [attr.aria-label]="i18n.t('notes.sortDirection')">
          @for (d of dirs; track d) {
            <button type="button" [class.on]="sort().dir === d" [attr.aria-pressed]="sort().dir === d" (click)="setDir(d)">
              <app-icon [name]="d === 'asc' ? 'arrow-up' : 'arrow-down'" size="14" /> {{ dirLabel(d) }}
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        position: relative;
        display: inline-flex;
      }
      .trigger {
        gap: var(--space-xs);
      }
      .trigger-label {
        color: var(--text-muted);
        font-weight: 400;
      }
      .menu {
        position: absolute;
        top: calc(100% + 4px);
        /* Opens toward the right from the button's left edge: on a phone the
           button wraps to the start of its row, and a right-anchored menu ran
           off the left of the screen. The width never exceeds the viewport. */
        left: 0;
        z-index: 20;
        width: 260px;
        max-width: calc(100vw - 2 * var(--space-md));
        display: flex;
        flex-direction: column;
        padding: var(--space-xs);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        box-shadow: var(--shadow-md);
      }
      .item {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
        text-align: left;
      }
      .item:hover {
        background: var(--bg-subtle);
      }
      .item.on {
        font-weight: 600;
        color: var(--color-purple);
      }
      .check {
        display: inline-flex;
        width: 14px;
      }
      .sep {
        height: 1px;
        margin: var(--space-xs) 0;
        background: var(--bg-border);
      }
      .dir {
        display: flex;
      }
      .dir button {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-xs);
      }
    `,
  ],
})
export class NoteSortMenuComponent {
  private readonly settings = inject(SettingsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly i18n = inject(I18nService);

  protected readonly fields = NOTE_SORT_FIELDS;
  protected readonly dirs: NoteSortDir[] = ['asc', 'desc'];
  readonly sort = this.settings.noteSort;
  readonly open = signal(false);

  /** "A to Z" / "Oldest first" / "Fewest first" read better than a bare "ascending". */
  protected readonly dirKeys = computed(() => (this.sort().field === 'title' ? 'alpha' : this.sort().field === 'wordCount' ? 'count' : 'date'));

  dirLabel(dir: NoteSortDir): string {
    return this.i18n.t(`notes.sortDir_${this.dirKeys()}_${dir}`);
  }

  pick(field: NoteSortField): void {
    // A new field starts in its natural direction: titles A to Z, dates and counts largest first.
    this.settings.setNoteSort({ field, dir: field === this.sort().field ? this.sort().dir : field === 'title' ? 'asc' : 'desc' });
  }

  setDir(dir: NoteSortDir): void {
    this.settings.setNoteSort({ ...this.sort(), dir });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
