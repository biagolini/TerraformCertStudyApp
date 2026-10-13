import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/components/icon.component';
import { OutlineItem, hasChildren, visibleOutline } from '../../core/utils/note-outline.util';

/**
 * Heading index of a study note (like a word processor's navigation pane):
 * sticky beside the preview, up to the chosen number of levels, collapsible
 * per heading, current section highlighted. Clicking a row asks the editor
 * to scroll there.
 */
@Component({
  selector: 'app-note-outline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <nav class="outline" [attr.aria-label]="i18n.t('notes.outline')">
      <header class="outline-head">
        <strong>{{ i18n.t('notes.outline') }}</strong>
        <label class="depth">
          <span>{{ i18n.t('notes.outlineDepth') }}</span>
          <select class="ui-input ui-input-sm" [value]="depth()" (change)="setDepth($event)">
            @for (n of levels; track n) {
              <option [value]="n" [selected]="n === depth()">H{{ n }}</option>
            }
          </select>
        </label>
        <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon ui-btn-sm" (click)="closed.emit()" [attr.aria-label]="i18n.t('common.close')"><app-icon name="x" size="14" /></button>
      </header>
      @if (rows().length === 0) {
        <p class="ui-faint empty">{{ i18n.t('notes.outlineEmpty') }}</p>
      } @else {
        <ul>
          @for (item of rows(); track item.index) {
            <li [style.--indent]="item.level - 1">
              @if (canCollapse(item)) {
                <button
                  type="button"
                  class="twisty"
                  (click)="toggle(item.index)"
                  [attr.aria-expanded]="!collapsed().has(item.index)"
                  [attr.aria-label]="i18n.t(collapsed().has(item.index) ? 'notes.outlineExpand' : 'notes.outlineCollapse', { title: item.text })"
                >
                  <app-icon [name]="collapsed().has(item.index) ? 'chevron-right' : 'chevron-down'" size="12" />
                </button>
              } @else {
                <span class="twisty" aria-hidden="true"></span>
              }
              <button
                type="button"
                class="entry"
                [class.top]="item.level === 1"
                [class.active]="item.index === highlighted()"
                [attr.aria-current]="item.index === highlighted() ? 'location' : null"
                (click)="jump.emit(item.index)"
              >{{ item.text || '—' }}</button>
            </li>
          }
        </ul>
      }
    </nav>
  `,
  styles: [
    `
      .outline {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: var(--space-sm);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        background: var(--bg-surface);
        max-height: inherit;
        min-height: 0;
      }
      .outline-head {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: 0 var(--space-xs);
      }
      .outline-head strong {
        flex: 1;
        font-size: var(--font-size-sm);
      }
      .depth {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }
      .depth select {
        width: auto;
      }
      ul {
        list-style: none;
        overflow-y: auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      li {
        display: flex;
        align-items: center;
        gap: 2px;
        padding-left: calc(var(--indent) * var(--space-md));
      }
      .twisty {
        flex: 0 0 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        color: var(--text-muted);
      }
      button.twisty:hover {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .entry {
        flex: 1;
        min-width: 0;
        text-align: left;
        padding: 3px var(--space-xs);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .entry.top {
        color: var(--text-primary);
        font-weight: 700;
      }
      .entry:hover {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .entry.active {
        background: var(--pack-color-soft, var(--bg-subtle));
        color: var(--text-primary);
        box-shadow: inset 2px 0 0 var(--pack-color, var(--color-purple));
      }
      .empty {
        padding: 0 var(--space-xs);
        font-size: var(--font-size-sm);
      }
    `,
  ],
})
export class NoteOutlineComponent {
  private readonly settings = inject(SettingsService);
  protected readonly i18n = inject(I18nService);

  readonly items = input.required<OutlineItem[]>();
  /** Heading the reader is currently in (index among all headings), or null. */
  readonly activeIndex = input<number | null>(null);
  readonly jump = output<number>();
  readonly closed = output<void>();

  protected readonly levels = [1, 2, 3, 4, 5, 6];
  protected readonly depth = this.settings.noteOutlineDepth;
  protected readonly collapsed = signal<ReadonlySet<number>>(new Set());
  protected readonly rows = computed(() => visibleOutline(this.items(), this.depth(), this.collapsed()));
  /** The active heading, or the closest shown row above it when it is hidden (deeper or collapsed). */
  protected readonly highlighted = computed(() => {
    const active = this.activeIndex();
    if (active === null) return null;
    let best: number | null = null;
    for (const row of this.rows()) if (row.index <= active) best = row.index;
    return best;
  });

  protected canCollapse(item: OutlineItem): boolean {
    return hasChildren(this.items(), item, this.depth());
  }

  protected toggle(index: number): void {
    const next = new Set(this.collapsed());
    if (next.has(index)) next.delete(index);
    else next.add(index);
    this.collapsed.set(next);
  }

  protected setDepth(event: Event): void {
    this.settings.setNoteOutlineDepth(Number((event.target as HTMLSelectElement).value));
  }
}
