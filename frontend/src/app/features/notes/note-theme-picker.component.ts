import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { NOTE_READING_THEMES, NoteReadingTheme, readingThemeClass } from '../../core/models/settings.model';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/components/icon.component';

/**
 * Text theme menu of a study note: read it in the site's theme (default) or
 * in a fixed light, dark or sepia theme. Saved in the user's settings, so it
 * follows them to every note and device.
 */
@Component({
  selector: 'app-note-theme-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <button
      type="button"
      class="ui-btn ui-btn-sm"
      (click)="open.set(!open())"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [title]="i18n.t('notes.textTheme')"
    ><app-icon name="palette" /> {{ i18n.t('notes.textTheme') }}</button>
    @if (open()) {
      <div class="menu" role="menu" [attr.aria-label]="i18n.t('notes.textTheme')">
        @for (t of themes; track t) {
          <button type="button" role="menuitemradio" class="item" [attr.aria-checked]="current() === t" (click)="pick(t)">
            <span [class]="'swatch ' + swatchClass(t)" aria-hidden="true">Aa</span>
            <span class="label">{{ i18n.t('notes.textTheme_' + t) }}</span>
            @if (current() === t) {
              <app-icon name="check" size="14" />
            }
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        position: relative;
        display: inline-flex;
      }
      .menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        z-index: 20;
        min-width: 200px;
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
        padding: var(--space-xs) var(--space-sm);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
        text-align: left;
      }
      .item:hover {
        background: var(--bg-subtle);
      }
      .label {
        flex: 1;
      }
      .swatch {
        width: 28px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        background: var(--bg-surface);
        color: var(--text-primary);
        font-size: var(--font-size-xs);
        font-weight: 700;
      }
    `,
  ],
})
export class NoteThemePickerComponent {
  private readonly settings = inject(SettingsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly i18n = inject(I18nService);

  protected readonly themes = NOTE_READING_THEMES;
  protected readonly current = this.settings.noteReadingTheme;
  readonly open = signal(false);

  /** The swatch previews each theme with its own tokens; 'site' uses the page's. */
  protected swatchClass(theme: NoteReadingTheme): string {
    return readingThemeClass(theme);
  }

  protected pick(theme: NoteReadingTheme): void {
    this.settings.setNoteReadingTheme(theme);
    this.open.set(false);
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
