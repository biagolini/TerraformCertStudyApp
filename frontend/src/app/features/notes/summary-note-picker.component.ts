import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NotesService } from '../../core/services/notes.service';
import { PacksService } from '../../core/services/packs.service';
import { SettingsService } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/components/icon.component';
import { I18nService } from '../../core/i18n/i18n.service';

const NEW_NOTE = '__new__';

/**
 * Picks the summary note a mock-exam question's concept goes into: one of
 * this certification's notes (the one used last here comes preselected) or a
 * new note created on the spot. Emits the chosen note id.
 */
@Component({
  selector: 'app-summary-note-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="ui-modal-backdrop" (click)="closed.emit()">
      <section class="ui-modal" role="dialog" aria-modal="true" aria-labelledby="summary-pick-title" (click)="$event.stopPropagation()">
        <header class="ui-modal-head">
          <div>
            <h2 id="summary-pick-title">{{ i18n.t('summaryNote.title') }}</h2>
            <p>{{ i18n.t('summaryNote.subtitle') }}</p>
          </div>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="closed.emit()" [attr.aria-label]="i18n.t('common.close')"><app-icon name="x" /></button>
        </header>
        <div class="ui-modal-body">
          <div class="options" role="radiogroup" [attr.aria-label]="i18n.t('summaryNote.title')">
            @for (n of notes(); track n.id) {
              <label class="option" [class.on]="choice() === n.id">
                <input type="radio" name="summary-note" [value]="n.id" [checked]="choice() === n.id" (change)="choice.set(n.id)" />
                <span class="option-main">
                  <strong>{{ n.title || i18n.t('notes.untitled') }}</strong>
                  @if (n.id === lastUsed()) {
                    <span class="ui-chip ui-chip-accent">{{ i18n.t('summaryNote.lastUsed') }}</span>
                  }
                </span>
              </label>
            }
            <label class="option" [class.on]="choice() === NEW_NOTE">
              <input type="radio" name="summary-note" [value]="NEW_NOTE" [checked]="choice() === NEW_NOTE" (change)="choice.set(NEW_NOTE)" />
              <span class="option-main"><app-icon name="plus" size="14" /> <strong>{{ i18n.t('summaryNote.newNote') }}</strong></span>
            </label>
          </div>
          @if (choice() === NEW_NOTE) {
            <label class="ui-field">
              <span>{{ i18n.t('summaryNote.newTitle') }}</span>
              <input class="ui-input" type="text" maxlength="120" [ngModel]="newTitle()" (ngModelChange)="newTitle.set($event)" />
            </label>
          }
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
        </div>
        <footer class="ui-modal-foot">
          <button type="button" class="ui-btn" (click)="closed.emit()">{{ i18n.t('common.cancel') }}</button>
          <button type="button" class="ui-btn ui-btn-primary" [disabled]="!canConfirm() || busy()" (click)="confirm()">{{ i18n.t('summaryNote.confirm') }}</button>
        </footer>
      </section>
    </div>
  `,
  styles: [
    `
      .options {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .option {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-input);
        cursor: pointer;
      }
      .option.on {
        border-color: var(--color-purple);
        box-shadow: 0 0 0 1px var(--color-purple);
      }
      .option input {
        accent-color: var(--color-purple);
      }
      .option-main {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-sm);
        min-width: 0;
      }
      .error {
        color: var(--color-red);
        font-size: var(--font-size-sm);
      }
    `,
  ],
})
export class SummaryNotePickerComponent {
  private readonly notesService = inject(NotesService);
  private readonly packs = inject(PacksService);
  private readonly settings = inject(SettingsService);
  protected readonly i18n = inject(I18nService);

  readonly picked = output<string>();
  readonly closed = output<void>();

  protected readonly NEW_NOTE = NEW_NOTE;
  protected readonly notes = computed(() => [...this.notesService.notes()].sort((a, b) => b.updatedAt - a.updatedAt));
  protected readonly lastUsed = computed(() => {
    const id = this.settings.summaryNote(this.packs.activePack().id);
    return id && this.notes().some((n) => n.id === id) ? id : null;
  });
  /** Last used note here, else a new note (no guessing among unrelated notes). */
  readonly choice = signal<string>(this.lastUsed() ?? NEW_NOTE);
  readonly newTitle = signal(this.i18n.t('summaryNote.defaultTitle', { exam: this.packs.activePack().code || this.packs.activePack().name }));
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  protected canConfirm(): boolean {
    return this.choice() !== NEW_NOTE || !!this.newTitle().trim();
  }

  async confirm(): Promise<void> {
    if (!this.canConfirm()) return;
    const packId = this.packs.activePack().id;
    this.busy.set(true);
    this.error.set(null);
    try {
      const noteId = this.choice() === NEW_NOTE ? (await this.notesService.create(packId, this.newTitle().trim())).id : this.choice();
      this.settings.saveSummaryNote(packId, noteId);
      this.picked.emit(noteId);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }
}
