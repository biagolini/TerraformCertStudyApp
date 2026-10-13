import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthorsService } from '../../core/services/authors.service';
import { BankAuthor, BankAuthorDraft, EMPTY_AUTHOR_DRAFT } from '../../core/models/author.model';
import { IconComponent } from '../../shared/components/icon.component';
import { I18nService } from '../../core/i18n/i18n.service';

/**
 * Manage bank authors (shared by every certification): add, edit — a rename
 * also renames them on their banks — and delete, choosing where their banks go.
 */
@Component({
  selector: 'app-authors-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NgTemplateOutlet, IconComponent],
  template: `
    <div class="ui-modal-backdrop" (click)="closed.emit()">
      <div class="ui-modal" role="dialog" aria-modal="true" aria-labelledby="authors-title" (click)="$event.stopPropagation()">
        <header class="ui-modal-head">
          <div>
            <h2 id="authors-title">{{ i18n.t('authors.title') }}</h2>
            <p>{{ i18n.t('authors.subtitle') }}</p>
          </div>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="closed.emit()" [attr.aria-label]="i18n.t('common.close')"><app-icon name="x" /></button>
        </header>

        <div class="ui-modal-body">
          @if (editingId() === 'new') {
            <ng-container *ngTemplateOutlet="form" />
          } @else {
            <button type="button" class="ui-btn ui-btn-primary add" (click)="startNew()"><app-icon name="plus" /> {{ i18n.t('authors.new') }}</button>
          }

          @if (authors.authors().length === 0) {
            <p class="ui-muted">{{ i18n.t('authors.empty') }}</p>
          }
          <ul class="author-list">
            @for (a of authors.authors(); track a.id) {
              <li class="author-row">
                @if (editingId() === a.id) {
                  <ng-container *ngTemplateOutlet="form" />
                } @else if (deletingId() === a.id) {
                  <div class="confirm" role="alert">
                    <strong>{{ i18n.t('authors.deleteTitle', { name: a.name }) }}</strong>
                    @if (countOf(a) > 0) {
                      <label class="ui-field">
                        <span>{{ i18n.t('authors.moveBanks', { count: countOf(a) }) }}</span>
                        <select class="ui-input" [ngModel]="reassignTo()" (ngModelChange)="reassignTo.set($event)">
                          <option value="">{{ i18n.t('banks.noAuthor') }}</option>
                          @for (other of others(a); track other.id) {
                            <option [value]="other.name">{{ other.name }}</option>
                          }
                        </select>
                      </label>
                    } @else {
                      <p class="ui-muted">{{ i18n.t('authors.noBanks') }}</p>
                    }
                    @if (error()) {
                      <p class="error">{{ error() }}</p>
                    }
                    <div class="ui-actions">
                      <button type="button" class="ui-btn ui-btn-ghost" (click)="deletingId.set(null)">{{ i18n.t('common.cancel') }}</button>
                      <button type="button" class="ui-btn ui-btn-danger" [disabled]="busy()" (click)="confirmDelete(a)"><app-icon name="trash" /> {{ i18n.t('authors.delete') }}</button>
                    </div>
                  </div>
                } @else {
                  <div class="author-main">
                    <span class="author-name"><app-icon name="user" size="14" /> {{ a.name }}</span>
                    <span class="ui-faint">{{ i18n.t('authors.bankCount', { count: countOf(a) }) }}</span>
                    @if (a.url) {
                      <a class="author-link" [href]="a.url" target="_blank" rel="noopener noreferrer"><app-icon name="external-link" size="12" /> {{ a.url }}</a>
                    }
                    @if (a.notes) {
                      <span class="author-notes ui-clamp-2">{{ a.notes }}</span>
                    }
                  </div>
                  <div class="ui-actions">
                    <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" (click)="startEdit(a)" [attr.aria-label]="i18n.t('authors.editNamed', { name: a.name })"><app-icon name="pencil" size="14" /> {{ i18n.t('common.edit') }}</button>
                    <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" (click)="startDelete(a)" [attr.aria-label]="i18n.t('authors.deleteNamed', { name: a.name })"><app-icon name="trash" size="14" /></button>
                  </div>
                }
              </li>
            }
          </ul>
        </div>
      </div>
    </div>

    <ng-template #form>
      <form class="author-form" (ngSubmit)="save()">
        <label class="ui-field">
          <span>{{ i18n.t('authors.name') }} *</span>
          <input class="ui-input" name="name" [(ngModel)]="draft.name" required maxlength="80" [placeholder]="i18n.t('banks.authorPlaceholder')" />
        </label>
        <label class="ui-field">
          <span>{{ i18n.t('authors.url') }}</span>
          <input class="ui-input" name="url" type="url" [(ngModel)]="draft.url" placeholder="https://" />
        </label>
        <label class="ui-field">
          <span>{{ i18n.t('authors.notes') }}</span>
          <textarea class="ui-input" name="notes" rows="2" [(ngModel)]="draft.notes"></textarea>
        </label>
        @if (editingId() !== 'new' && renameCount() > 0) {
          <p class="ui-faint">{{ i18n.t('authors.renameHint', { count: renameCount() }) }}</p>
        }
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <div class="ui-actions">
          <button type="button" class="ui-btn ui-btn-ghost" (click)="cancel()">{{ i18n.t('common.cancel') }}</button>
          <button type="submit" class="ui-btn ui-btn-primary" [disabled]="!draft.name.trim()">{{ i18n.t('common.save') }}</button>
        </div>
      </form>
    </ng-template>
  `,
  styles: [
    `
      .add { align-self: flex-start; }
      .author-list { display: flex; flex-direction: column; gap: var(--space-sm); }
      .author-row { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-md); padding: var(--space-sm) var(--space-md); border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-input); }
      .author-row:has(.author-form), .author-row:has(.confirm) { display: block; }
      .author-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .author-name { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
      .author-link { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); color: var(--color-blue); overflow-wrap: anywhere; }
      .author-notes { font-size: var(--font-size-sm); color: var(--text-muted); }
      .author-form, .confirm { display: flex; flex-direction: column; gap: var(--space-sm); }
      .author-form { padding: var(--space-md); border: 1px solid var(--color-purple); border-radius: var(--radius-md); background: var(--bg-surface); }
      .error { color: var(--color-red); font-size: var(--font-size-sm); }
    `,
  ],
})
export class AuthorsDialogComponent {
  protected readonly authors = inject(AuthorsService);
  protected readonly i18n = inject(I18nService);

  readonly closed = output<void>();

  /** 'new', an author id being edited, or null. */
  readonly editingId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);
  readonly reassignTo = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  protected draft: BankAuthorDraft = { ...EMPTY_AUTHOR_DRAFT };

  /** Banks that a rename of the author being edited will update. */
  readonly renameCount = computed(() => {
    const id = this.editingId();
    return id && id !== 'new' ? (this.authors.bankCounts().get(id) ?? 0) : 0;
  });

  countOf(a: BankAuthor): number {
    return this.authors.bankCounts().get(a.id) ?? 0;
  }

  others(a: BankAuthor): BankAuthor[] {
    return this.authors.authors().filter((o) => o.id !== a.id);
  }

  startNew(): void {
    this.draft = { ...EMPTY_AUTHOR_DRAFT };
    this.error.set(null);
    this.deletingId.set(null);
    this.editingId.set('new');
  }

  startEdit(a: BankAuthor): void {
    this.draft = { name: a.name, url: a.url, notes: a.notes };
    this.error.set(null);
    this.deletingId.set(null);
    this.editingId.set(a.id);
  }

  startDelete(a: BankAuthor): void {
    this.error.set(null);
    this.editingId.set(null);
    this.reassignTo.set('');
    this.deletingId.set(a.id);
  }

  cancel(): void {
    this.editingId.set(null);
    this.error.set(null);
  }

  save(): void {
    const id = this.editingId();
    if (!id || !this.draft.name.trim()) return;
    const clash = this.authors.byName(this.draft.name);
    if (clash && clash.id !== id) {
      this.error.set(this.i18n.t('authors.duplicate', { name: clash.name }));
      return;
    }
    if (id === 'new') this.authors.create(this.draft);
    else this.authors.update(id, this.draft);
    this.editingId.set(null);
  }

  async confirmDelete(a: BankAuthor): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    const ok = await this.authors.remove(a.id, this.reassignTo());
    this.busy.set(false);
    if (ok) this.deletingId.set(null);
    else this.error.set(this.i18n.t('authors.deleteFailed'));
  }
}
