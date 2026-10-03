import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMPTY_BANK_DRAFT, QuestionBank, QuestionBankDraft } from '../../core/models/bank.model';
import { BanksService } from '../../core/services/banks.service';
import { QuestionsService } from '../../core/services/questions.service';
import { I18nService } from '../../core/i18n/i18n.service';

/** Create/edit/delete a question bank, as a modal. */
@Component({
  selector: 'app-bank-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="ui-modal-backdrop" (click)="closed.emit()">
      <form class="ui-modal" role="dialog" aria-modal="true" aria-labelledby="bank-editor-title" (click)="$event.stopPropagation()" (ngSubmit)="save()">
        <header class="ui-modal-head">
          <div>
            <h2 id="bank-editor-title">{{ bank() ? i18n.t('banks.editBank') : i18n.t('banks.newBank') }}</h2>
            <p>{{ i18n.t('banks.editorHint') }}</p>
          </div>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="closed.emit()" [attr.aria-label]="i18n.t('common.close')">✕</button>
        </header>
        <div class="ui-modal-body">
          <label class="ui-field">
            <span>{{ i18n.t('banks.name') }} *</span>
            <input class="ui-input" name="name" [(ngModel)]="draft.name" required [placeholder]="i18n.t('banks.namePlaceholder')" />
          </label>
          <div class="ui-form-row">
            <label class="ui-field">
              <span>{{ i18n.t('banks.author') }}</span>
              <input class="ui-input" name="author" [(ngModel)]="draft.author" [placeholder]="i18n.t('banks.authorPlaceholder')" list="bank-authors" />
              <datalist id="bank-authors">
                @for (a of knownAuthors(); track a) {
                  <option [value]="a"></option>
                }
              </datalist>
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('banks.version') }}</span>
              <input class="ui-input" name="version" [(ngModel)]="draft.version" placeholder="v1" />
            </label>
          </div>
          <label class="ui-field">
            <span>{{ i18n.t('banks.sourceUrl') }}</span>
            <input class="ui-input" name="sourceUrl" type="url" [(ngModel)]="draft.sourceUrl" placeholder="https://" />
          </label>
          <label class="ui-field">
            <span>{{ i18n.t('banks.description') }}</span>
            <textarea class="ui-input" name="description" rows="3" [(ngModel)]="draft.description"></textarea>
          </label>
          @if (confirmDelete()) {
            <div class="confirm" role="alert">
              <p>{{ i18n.t('banks.deleteConfirm', { name: bank()?.name, n: questionCount() }) }}</p>
              <div class="ui-actions">
                <button type="button" class="ui-btn ui-btn-sm" (click)="confirmDelete.set(false)">{{ i18n.t('common.cancel') }}</button>
                <button type="button" class="ui-btn ui-btn-danger ui-btn-sm" [disabled]="busy()" (click)="remove()">{{ i18n.t('common.delete') }}</button>
              </div>
            </div>
          }
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
        </div>
        <footer class="ui-modal-foot">
          @if (bank()) {
            <button type="button" class="ui-btn ui-btn-danger" (click)="confirmDelete.set(true)">{{ i18n.t('banks.deleteBank') }}</button>
            <span class="spacer"></span>
          }
          <button type="button" class="ui-btn" (click)="closed.emit()">{{ i18n.t('common.cancel') }}</button>
          <button type="submit" class="ui-btn ui-btn-primary" [disabled]="!draft.name.trim()">{{ i18n.t('common.save') }}</button>
        </footer>
      </form>
    </div>
  `,
  styles: [
    `
      .spacer {
        flex: 1;
      }
      .confirm {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: var(--space-md);
        border: 1px solid rgba(214, 48, 49, 0.35);
        border-radius: var(--radius-md);
        background: rgba(214, 48, 49, 0.06);
      }
      .error {
        color: var(--color-red);
      }
    `,
  ],
})
export class BankEditorComponent implements OnInit {
  private readonly banks = inject(BanksService);
  private readonly questions = inject(QuestionsService);
  protected readonly i18n = inject(I18nService);

  readonly packId = input.required<string>();
  readonly bank = input<QuestionBank | null>(null);
  readonly closed = output<void>();
  readonly saved = output<QuestionBank>();
  readonly deleted = output<string>();

  protected draft: QuestionBankDraft = { ...EMPTY_BANK_DRAFT };
  readonly confirmDelete = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly knownAuthors = computed(() => [
    ...new Set(this.banks.forPack(this.packId()).map((b) => b.author).filter(Boolean)),
  ]);
  readonly questionCount = computed(() => {
    const id = this.bank()?.id;
    return id ? this.questions.allQuestions().filter((q) => q.bankId === id).length : 0;
  });

  ngOnInit(): void {
    const b = this.bank();
    if (b) this.draft = { name: b.name, author: b.author, version: b.version, sourceUrl: b.sourceUrl, description: b.description };
  }

  save(): void {
    if (!this.draft.name.trim()) return;
    const existing = this.bank();
    if (existing) {
      this.banks.update(existing.id, this.draft);
      this.saved.emit(this.banks.getById(existing.id) ?? existing);
    } else {
      this.saved.emit(this.banks.create(this.packId(), this.draft));
    }
  }

  async remove(): Promise<void> {
    const b = this.bank();
    if (!b) return;
    this.busy.set(true);
    this.error.set(null);
    const ok = await this.banks.remove(b.id);
    this.busy.set(false);
    if (ok) this.deleted.emit(b.id);
    else this.error.set(this.i18n.t('banks.deleteFailed'));
  }
}
