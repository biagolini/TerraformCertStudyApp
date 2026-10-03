import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NotesService } from '../../core/services/notes.service';
import { PacksService } from '../../core/services/packs.service';
import { I18nService } from '../../core/i18n/i18n.service';

/** Copies a piece of generated Markdown (transcript summary, chat summary) into a new note of the active certification. */
@Component({
  selector: 'app-save-as-note',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="ui-btn ui-btn-sm" [disabled]="busy() || !content().trim()" (click)="save()">
      📝 {{ busy() ? i18n.t('common.loading') : i18n.t('notes.saveAsNote') }}
    </button>
    @if (error()) {
      <span class="error" role="alert">{{ error() }}</span>
    }
  `,
  styles: [':host { display: inline-flex; align-items: center; gap: 8px; } .error { color: var(--color-red); font-size: var(--font-size-sm); }'],
})
export class SaveAsNoteComponent {
  private readonly notes = inject(NotesService);
  private readonly packs = inject(PacksService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  readonly title = input.required<string>();
  readonly content = input.required<string>();
  readonly tags = input<string[]>([]);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async save(): Promise<void> {
    const packId = this.packs.activePack().id;
    this.busy.set(true);
    this.error.set(null);
    try {
      const note = await this.notes.create(packId, this.title(), this.content(), this.tags());
      void this.router.navigate(['/exam', packId, 'notes', note.id]);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }
}
