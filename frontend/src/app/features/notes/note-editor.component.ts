import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Note, countWords } from '../../core/models/note.model';
import { NotesService } from '../../core/services/notes.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';
import { NoteCopilotComponent } from './note-copilot.component';

type ViewMode = 'edit' | 'split' | 'preview';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const AUTOSAVE_MS = 1500;

/** Markdown note editor with toolbar, live preview, autosave, image upload and the AI copilot panel. */
@Component({
  selector: 'app-note-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MarkdownRendererComponent, NoteCopilotComponent],
  template: `
    <div class="editor-shell" [class.with-copilot]="copilotOpen()">
      <div class="editor-main">
        <div class="topbar">
          <button type="button" class="ui-btn ui-btn-sm" (click)="leave()">← {{ i18n.t('notes.backToNotes') }}</button>
          <span class="ui-faint stats">{{ i18n.t('notes.words', { n: words() }) }} · {{ i18n.t('notes.readTime', { n: readMinutes() }) }}</span>
          <span class="save-state" [class.error]="saveState() === 'error'" aria-live="polite">{{ saveLabel() }}</span>
          <span class="spacer"></span>
          <div class="view-toggle" role="group" [attr.aria-label]="i18n.t('notes.viewMode')">
            @for (m of modes; track m) {
              <button type="button" class="ui-btn ui-btn-sm" [class.ui-btn-primary]="mode() === m" (click)="mode.set(m)" [attr.aria-pressed]="mode() === m">{{ i18n.t('notes.mode_' + m) }}</button>
            }
          </div>
          <button type="button" class="ui-btn ui-btn-sm ui-btn-soft" (click)="copilotOpen.set(!copilotOpen())" [attr.aria-pressed]="copilotOpen()">✦ {{ i18n.t('notes.copilot') }}</button>
          <button type="button" class="ui-btn ui-btn-sm ui-btn-danger" (click)="confirmDelete.set(true)" [attr.aria-label]="i18n.t('notes.deleteNote')">🗑</button>
        </div>

        @if (confirmDelete()) {
          <div class="confirm" role="alert">
            <span>{{ i18n.t('notes.deleteConfirm') }}</span>
            <button type="button" class="ui-btn ui-btn-sm" (click)="confirmDelete.set(false)">{{ i18n.t('common.cancel') }}</button>
            <button type="button" class="ui-btn ui-btn-sm ui-btn-danger" (click)="remove()">{{ i18n.t('common.delete') }}</button>
          </div>
        }

        <input class="title-input" [ngModel]="title()" (ngModelChange)="onTitle($event)" [attr.aria-label]="i18n.t('notes.noteTitle')" [placeholder]="i18n.t('notes.untitled')" />
        <label class="tags">
          <span aria-hidden="true">🏷</span>
          <span class="ui-sr-only">{{ i18n.t('notes.tags') }}</span>
          <input class="tags-input" [ngModel]="tagsText()" (ngModelChange)="tagsText.set($event)" (blur)="commitTags()" [placeholder]="i18n.t('notes.tagsPlaceholder')" />
        </label>

        @if (mode() !== 'preview') {
          <div class="toolbar" role="toolbar" [attr.aria-label]="i18n.t('notes.formatting')">
            <button type="button" (click)="wrap('**', '**')" [attr.aria-label]="i18n.t('notes.bold')"><strong>B</strong></button>
            <button type="button" (click)="wrap('*', '*')" [attr.aria-label]="i18n.t('notes.italic')"><em>I</em></button>
            <span class="sep" aria-hidden="true"></span>
            <button type="button" (click)="linePrefix('# ')" aria-label="H1">H1</button>
            <button type="button" (click)="linePrefix('## ')" aria-label="H2">H2</button>
            <button type="button" (click)="linePrefix('### ')" aria-label="H3">H3</button>
            <span class="sep" aria-hidden="true"></span>
            <button type="button" (click)="linePrefix('- ')" [attr.aria-label]="i18n.t('notes.bulletList')">•</button>
            <button type="button" (click)="linePrefix('1. ')" [attr.aria-label]="i18n.t('notes.numberedList')">1.</button>
            <button type="button" (click)="linePrefix('- [ ] ')" [attr.aria-label]="i18n.t('notes.taskList')">☑</button>
            <span class="sep" aria-hidden="true"></span>
            <button type="button" (click)="linePrefix('> ')" [attr.aria-label]="i18n.t('notes.quote')">❝</button>
            <button type="button" (click)="wrap('\`', '\`')" [attr.aria-label]="i18n.t('notes.inlineCode')">&lt;/&gt;</button>
            <button type="button" (click)="wrap('\\n\`\`\`\\n', '\\n\`\`\`\\n')" [attr.aria-label]="i18n.t('notes.codeBlock')">{{ '{ }' }}</button>
            <button type="button" (click)="wrap('[', '](https://)')" [attr.aria-label]="i18n.t('notes.link')">🔗</button>
            <button type="button" class="takeaway" (click)="linePrefix('> **' + i18n.t('notes.keyTakeaway') + ':** ')">⚑ {{ i18n.t('notes.keyTakeaway') }}</button>
            <button type="button" (click)="imageInput.click()" [disabled]="uploading()" [attr.aria-label]="i18n.t('notes.insertImage')">🖼</button>
            <input #imageInput type="file" accept=".png,.jpg,.jpeg,.gif,.webp" hidden (change)="onImage($event)" />
          </div>
        }

        @if (loading()) {
          <p class="ui-muted">{{ i18n.t('common.loading') }}</p>
        } @else {
          <div class="panes" [class.split]="mode() === 'split'">
            @if (mode() !== 'preview') {
              <textarea
                #area
                class="body"
                [ngModel]="body()"
                (ngModelChange)="onBody($event)"
                (keydown)="onKeydown($event)"
                [attr.aria-label]="i18n.t('notes.body')"
                [placeholder]="i18n.t('notes.bodyPlaceholder')"
                spellcheck="true"
              ></textarea>
            }
            @if (mode() !== 'edit') {
              <article class="preview ui-card">
                @if (body().trim()) {
                  <app-markdown-renderer [source]="body()" />
                } @else {
                  <p class="ui-muted">{{ i18n.t('notes.emptyNote') }}</p>
                }
              </article>
            }
          </div>
        }
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </div>

      @if (copilotOpen()) {
        <app-note-copilot
          [noteId]="note().id"
          [title]="title()"
          [markdown]="body()"
          (insert)="insertAtCursor($event)"
          (append)="append($event)"
          (replace)="replaceAll($event)"
          (closed)="copilotOpen.set(false)"
        />
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        grid-column: 1 / -1;
        min-width: 0;
      }
      .editor-shell {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--space-lg);
        max-width: 1280px;
        margin: 0 auto;
      }
      @media (min-width: 1024px) {
        .editor-shell.with-copilot {
          grid-template-columns: minmax(0, 1fr) 380px;
        }
      }
      .editor-main {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        min-width: 0;
      }
      .topbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-sm);
        padding-bottom: var(--space-sm);
        border-bottom: 1px solid var(--bg-border);
      }
      .stats {
        font-family: var(--font-mono);
      }
      .save-state {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .save-state.error {
        color: var(--color-red);
      }
      .spacer {
        flex: 1;
      }
      .view-toggle {
        display: inline-flex;
        gap: 2px;
      }
      .confirm {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        background: rgba(214, 48, 49, 0.06);
        border: 1px solid rgba(214, 48, 49, 0.35);
      }
      .title-input {
        border: 0;
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        font-size: clamp(22px, 3vw, 32px);
        font-weight: 800;
        letter-spacing: -0.02em;
        padding: var(--space-sm) 0 0;
        width: 100%;
      }
      .title-input:focus,
      .tags-input:focus,
      .body:focus {
        outline: none;
      }
      .tags {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--text-muted);
        border-bottom: 1px dashed var(--bg-border);
        padding-bottom: var(--space-sm);
      }
      .tags-input {
        flex: 1;
        border: 0;
        background: transparent;
        color: var(--text-secondary);
        font: inherit;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
      }
      .toolbar button {
        min-width: 34px;
        height: 32px;
        padding: 0 8px;
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        font-weight: 600;
      }
      .toolbar button:hover:not(:disabled) {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .toolbar .takeaway {
        color: var(--color-amber);
      }
      .sep {
        width: 1px;
        height: 20px;
        background: var(--bg-border);
        margin: 0 4px;
      }
      .panes {
        display: grid;
        gap: var(--space-md);
        grid-template-columns: 1fr;
      }
      @media (min-width: 900px) {
        .panes.split {
          grid-template-columns: 1fr 1fr;
        }
      }
      .body {
        width: 100%;
        min-height: 60vh;
        resize: vertical;
        padding: var(--space-md) var(--space-lg);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        background: var(--bg-surface);
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: 14px;
        line-height: 1.7;
      }
      .preview {
        min-height: 60vh;
        padding: var(--space-md) var(--space-lg);
        overflow-x: auto;
      }
      .error {
        color: var(--color-red);
      }
    `,
  ],
})
export class NoteEditorComponent implements OnInit, OnDestroy {
  private readonly notes = inject(NotesService);
  protected readonly i18n = inject(I18nService);

  readonly note = input.required<Note>();
  readonly back = output<void>();
  readonly deleted = output<void>();

  private readonly area = viewChild<ElementRef<HTMLTextAreaElement>>('area');

  protected readonly modes: ViewMode[] = ['edit', 'split', 'preview'];
  readonly mode = signal<ViewMode>('edit');
  readonly copilotOpen = signal(false);
  readonly confirmDelete = signal(false);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly saveState = signal<SaveState>('idle');

  readonly title = signal('');
  readonly tagsText = signal('');
  readonly body = signal('');

  readonly words = computed(() => countWords(this.body()));
  readonly readMinutes = computed(() => Math.max(1, Math.round(this.words() / 200)));
  readonly saveLabel = computed(() => {
    switch (this.saveState()) {
      case 'dirty':
        return this.i18n.t('notes.unsaved');
      case 'saving':
        return this.i18n.t('notes.saving');
      case 'saved':
        return this.i18n.t('notes.saved');
      case 'error':
        return this.i18n.t('notes.saveFailed');
      default:
        return '';
    }
  });

  private timer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    const n = this.note();
    this.title.set(n.title);
    this.tagsText.set(n.tags.join(', '));
    try {
      this.body.set(await this.notes.loadBody(n.id));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    // Leaving with pending edits saves them instead of dropping them.
    if (this.timer) {
      clearTimeout(this.timer);
      void this.save();
    }
  }

  onTitle(value: string): void {
    this.title.set(value);
    this.notes.updateMeta(this.note().id, { title: value });
  }

  commitTags(): void {
    this.notes.updateMeta(this.note().id, { tags: this.tagsText().split(',') });
  }

  onBody(value: string): void {
    this.body.set(value);
    this.scheduleSave();
  }

  onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.save();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.wrap('**', '**');
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      this.wrap('*', '*');
    }
  }

  /** Wraps the current selection (or inserts the markers at the cursor). */
  wrap(before: string, after: string): void {
    this.edit((text, start, end) => {
      const selected = text.slice(start, end);
      return { text: text.slice(0, start) + before + selected + after + text.slice(end), cursor: start + before.length + selected.length };
    });
  }

  /** Prefixes every line touched by the selection (headings, lists, quotes). */
  linePrefix(prefix: string): void {
    this.edit((text, start, end) => {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const block = text.slice(lineStart, end);
      const prefixed = block
        .split('\n')
        .map((line) => prefix + line.replace(/^(#{1,6}\s|[-*]\s\[[ xX]\]\s|[-*]\s|\d+\.\s|>\s)/, ''))
        .join('\n');
      return { text: text.slice(0, lineStart) + prefixed + text.slice(end), cursor: lineStart + prefixed.length };
    });
  }

  insertAtCursor(markdown: string): void {
    this.edit((text, start, end) => {
      const insert = `\n\n${markdown.trim()}\n\n`;
      return { text: text.slice(0, start) + insert + text.slice(end), cursor: start + insert.length };
    });
  }

  append(markdown: string): void {
    this.onBody(`${this.body().trimEnd()}\n\n${markdown.trim()}\n`);
  }

  replaceAll(markdown: string): void {
    this.onBody(markdown.trim() + '\n');
  }

  async onImage(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    this.uploading.set(true);
    this.error.set(null);
    try {
      const ref = await this.notes.uploadImage(this.note().id, file);
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '');
      this.insertAtCursor(`![${alt}](${ref})`);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.uploading.set(false);
    }
  }

  async leave(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      await this.save();
    }
    this.commitTags();
    this.back.emit();
  }

  async remove(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ok = await this.notes.remove(this.note().id);
    if (ok) this.deleted.emit();
    else this.error.set(this.i18n.t('notes.deleteFailed'));
  }

  private edit(fn: (text: string, start: number, end: number) => { text: string; cursor: number }): void {
    const el = this.area()?.nativeElement;
    const text = this.body();
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const result = fn(text, start, end);
    this.onBody(result.text);
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(result.cursor, result.cursor);
      });
    }
  }

  private scheduleSave(): void {
    this.saveState.set('dirty');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, AUTOSAVE_MS);
  }

  private async save(): Promise<void> {
    this.saveState.set('saving');
    try {
      await this.notes.saveBody(this.note().id, this.body());
      this.saveState.set('saved');
    } catch (err) {
      this.saveState.set('error');
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }
}
