import { IconComponent } from '../../shared/components/icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
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
import { ConceptRequest, NoteIntegrationService } from '../../core/services/note-integration.service';
import { SettingsService } from '../../core/services/settings.service';
import { noteOutline } from '../../core/utils/note-outline.util';
import { readingThemeClass } from '../../core/models/settings.model';
import { NoteOutlineComponent } from './note-outline.component';
import { NoteHistoryComponent } from './note-history.component';
import { NoteThemePickerComponent } from './note-theme-picker.component';
import { NoteExportMenuComponent } from './note-export-menu.component';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => IMAGE_TYPES.includes(f.type));
}

/** While editing: Markdown only, or Markdown beside a live preview. */
type EditLayout = 'edit' | 'split';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Study note page. Opens in reading mode (rendered preview, optional sticky
 * heading index); "Edit" switches to Markdown and nothing is written until
 * "Save", since every save becomes a restorable version (S3 versioning, see
 * NoteHistoryComponent). AI copilot changes made while reading are saved at
 * once, as that is an explicit action too.
 */
@Component({
  selector: 'app-note-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FormsModule, MarkdownRendererComponent, NoteCopilotComponent, NoteOutlineComponent, NoteHistoryComponent, NoteThemePickerComponent, NoteExportMenuComponent],
  template: `
    <div class="editor-shell" [class.with-copilot]="copilotOpen()">
      <div class="editor-main">
        <div class="topbar">
          <button type="button" class="ui-btn ui-btn-sm" (click)="leave()"><app-icon name="arrow-left" /> {{ i18n.t('notes.backToNotes') }}</button>
          <span class="ui-faint stats">{{ i18n.t('notes.words', { n: words() }) }} · {{ i18n.t('notes.readTime', { n: readMinutes() }) }}</span>
          <span class="save-state" [class.error]="saveState() === 'error'" aria-live="polite">{{ saveLabel() }}</span>
          <span class="spacer"></span>
          @if (editing()) {
            <div class="ui-segmented" role="group" [attr.aria-label]="i18n.t('notes.viewMode')">
              @for (m of layouts; track m) {
                <button type="button" [class.on]="layout() === m" (click)="layout.set(m)" [attr.aria-pressed]="layout() === m">{{ i18n.t('notes.mode_' + m) }}</button>
              }
            </div>
            <button type="button" class="ui-btn ui-btn-sm" [disabled]="saveState() === 'saving'" (click)="cancelEdit()">{{ i18n.t('common.cancel') }}</button>
            <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" [disabled]="!dirty() || saveState() === 'saving'" (click)="saveEdit()"><app-icon name="check" /> {{ i18n.t('common.save') }}</button>
          } @else {
            <button type="button" class="ui-btn ui-btn-sm" [class.ui-btn-soft]="outlineOpen()" (click)="settings.setNoteOutlineOpen(!outlineOpen())" [attr.aria-pressed]="outlineOpen()"><app-icon name="list-ordered" /> {{ i18n.t('notes.outline') }}</button>
            <app-note-theme-picker />
            <app-note-export-menu [title]="title()" [markdown]="body()" />
            <button type="button" class="ui-btn ui-btn-sm" (click)="historyOpen.set(true)"><app-icon name="clock" /> {{ i18n.t('notes.historyButton') }}</button>
            <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" [disabled]="loading()" (click)="startEdit()"><app-icon name="pencil" /> {{ i18n.t('notes.edit') }}</button>
          }
          <button type="button" class="ui-btn ui-btn-sm ui-btn-soft" (click)="copilotOpen.set(!copilotOpen())" [attr.aria-pressed]="copilotOpen()"><app-icon name="sparkles" /> {{ i18n.t('notes.copilot') }}</button>
          <button type="button" class="ui-btn ui-btn-sm ui-btn-danger" (click)="confirmDelete.set(true)" [attr.aria-label]="i18n.t('notes.deleteNote')"><app-icon name="trash" /></button>
        </div>

        @if (confirmLeave()) {
          <div class="confirm" role="alert">
            <span>{{ i18n.t('notes.unsavedLeave') }}</span>
            <button type="button" class="ui-btn ui-btn-sm" (click)="confirmLeave.set(false)">{{ i18n.t('notes.keepEditing') }}</button>
            <button type="button" class="ui-btn ui-btn-sm ui-btn-danger" (click)="discardAndLeave()">{{ i18n.t('notes.discardChanges') }}</button>
            <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" (click)="saveAndLeave()">{{ i18n.t('common.save') }}</button>
          </div>
        }

        @if (confirmDelete()) {
          <div class="confirm" role="alert">
            <span>{{ i18n.t('notes.deleteConfirm') }}</span>
            <button type="button" class="ui-btn ui-btn-sm" (click)="confirmDelete.set(false)">{{ i18n.t('common.cancel') }}</button>
            <button type="button" class="ui-btn ui-btn-sm ui-btn-danger" (click)="remove()">{{ i18n.t('common.delete') }}</button>
          </div>
        }

        @if (editing()) {
          <input class="title-input" [ngModel]="title()" (ngModelChange)="title.set($event)" [attr.aria-label]="i18n.t('notes.noteTitle')" [placeholder]="i18n.t('notes.untitled')" />
          <label class="tags">
            <span aria-hidden="true"><app-icon name="tag" size="14" /></span>
            <span class="ui-sr-only">{{ i18n.t('notes.tags') }}</span>
            <input class="tags-input" [ngModel]="tagsText()" (ngModelChange)="tagsText.set($event)" [placeholder]="i18n.t('notes.tagsPlaceholder')" />
          </label>
        } @else {
          <h1 class="title-input">{{ title() || i18n.t('notes.untitled') }}</h1>
          @if (tagsText().trim()) {
            <p class="tags"><app-icon name="tag" size="14" /> {{ tagsText() }}</p>
          }
        }

        @if (editing()) {
          <div class="toolbar" role="toolbar" [attr.aria-label]="i18n.t('notes.formatting')">
            <button type="button" (click)="wrap('**', '**')" [attr.aria-label]="i18n.t('notes.bold')"><strong>B</strong></button>
            <button type="button" (click)="wrap('*', '*')" [attr.aria-label]="i18n.t('notes.italic')"><em>I</em></button>
            <span class="sep" aria-hidden="true"></span>
            <button type="button" (click)="linePrefix('# ')" aria-label="H1">H1</button>
            <button type="button" (click)="linePrefix('## ')" aria-label="H2">H2</button>
            <button type="button" (click)="linePrefix('### ')" aria-label="H3">H3</button>
            <span class="sep" aria-hidden="true"></span>
            <button type="button" (click)="linePrefix('- ')" [attr.aria-label]="i18n.t('notes.bulletList')"><app-icon name="list" /></button>
            <button type="button" (click)="linePrefix('1. ')" [attr.aria-label]="i18n.t('notes.numberedList')">1.</button>
            <button type="button" (click)="linePrefix('- [ ] ')" [attr.aria-label]="i18n.t('notes.taskList')"><app-icon name="list-checks" /></button>
            <span class="sep" aria-hidden="true"></span>
            <button type="button" (click)="linePrefix('> ')" [attr.aria-label]="i18n.t('notes.quote')"><app-icon name="quote" /></button>
            <button type="button" (click)="wrap('\`', '\`')" [attr.aria-label]="i18n.t('notes.inlineCode')">&lt;/&gt;</button>
            <button type="button" (click)="wrap('\\n\`\`\`\\n', '\\n\`\`\`\\n')" [attr.aria-label]="i18n.t('notes.codeBlock')">{{ '{ }' }}</button>
            <button type="button" (click)="wrap('[', '](https://)')" [attr.aria-label]="i18n.t('notes.link')"><app-icon name="link" /></button>
            <button type="button" class="takeaway" (click)="linePrefix('> **' + i18n.t('notes.keyTakeaway') + ':** ')"><app-icon name="flag" /> {{ i18n.t('notes.keyTakeaway') }}</button>
            <button type="button" (click)="imageInput.click()" [disabled]="uploading()" [title]="i18n.t('notes.imageHint')"><app-icon name="image" /> {{ uploading() ? i18n.t('imageUpload.uploading') : i18n.t('notes.insertImage') }}</button>
            <input #imageInput type="file" accept=".png,.jpg,.jpeg,.gif,.webp" multiple hidden (change)="onImage($event)" />
          </div>
        }

        @if (loading()) {
          <p class="ui-muted">{{ i18n.t('common.loading') }}</p>
        } @else {
          @if (editing()) {
          <div class="panes" [class.split]="layout() === 'split'">
              <textarea
                #area
                class="body"
                [ngModel]="body()"
                (ngModelChange)="onBody($event)"
                (keydown)="onKeydown($event)"
                (paste)="onPaste($event)"
                (dragover)="onDragOver($event)"
                (drop)="onDrop($event)"
                [attr.aria-label]="i18n.t('notes.body')"
                [placeholder]="i18n.t('notes.bodyPlaceholder')"
                spellcheck="true"
              ></textarea>
            @if (layout() === 'split') {
              <article class="preview ui-card" [class]="themeClass()">
                <app-markdown-renderer [source]="body()" [document]="true" />
              </article>
            }
          </div>
          } @else {
            <div class="reader" [class.with-outline]="outlineOpen()">
              @if (outlineOpen()) {
                <aside class="outline-slot">
                  <app-note-outline [items]="outline()" [activeIndex]="activeHeading()" (jump)="scrollToHeading($event)" (closed)="settings.setNoteOutlineOpen(false)" />
                </aside>
              }
              <article #reader class="preview ui-card" [class]="themeClass()">
                @if (body().trim()) {
                  <app-markdown-renderer [source]="body()" [document]="true" />
                } @else {
                  <p class="ui-muted">{{ i18n.t('notes.emptyNote') }}</p>
                  <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" (click)="startEdit()"><app-icon name="pencil" /> {{ i18n.t('notes.edit') }}</button>
                }
              </article>
            </div>
          }
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
          [concept]="concept()"
          (insert)="insertAtCursor($event)"
          (append)="append($event)"
          (replace)="replaceAll($event)"
          (restore)="applyBody($event)"
          (closed)="copilotOpen.set(false)"
        />
      }
    </div>

    @if (historyOpen()) {
      <app-note-history [noteId]="note().id" (restore)="restoreVersion($event)" (closed)="historyOpen.set(false)" />
    }
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
      h1.title-input {
        margin: 0;
      }
      p.tags {
        border-bottom: 0;
        font-size: var(--font-size-sm);
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
        min-width: 0;
        padding: var(--space-md) var(--space-lg);
        overflow-x: auto;
      }
      .reader {
        display: grid;
        gap: var(--space-md);
        grid-template-columns: minmax(0, 1fr);
        align-items: start;
      }
      .outline-slot {
        /* Stays in view while the note scrolls, just under the header and tabs. */
        position: sticky;
        top: calc(var(--header-height) + 56px);
        z-index: 2;
        display: flex;
        max-height: calc(100dvh - var(--header-height) - 72px);
      }
      .outline-slot app-note-outline {
        display: flex;
        flex-direction: column;
        width: 100%;
        max-height: inherit;
        min-height: 0;
      }
      @media (min-width: 900px) {
        .reader.with-outline {
          grid-template-columns: 280px minmax(0, 1fr);
        }
      }
      @media (max-width: 899px) {
        .outline-slot {
          max-height: 45dvh;
        }
      }
      .error {
        color: var(--color-red);
      }
    `,
  ],
})
export class NoteEditorComponent implements OnInit, OnDestroy {
  private readonly notes = inject(NotesService);
  private readonly integration = inject(NoteIntegrationService);
  protected readonly settings = inject(SettingsService);
  protected readonly i18n = inject(I18nService);

  readonly note = input.required<Note>();
  readonly back = output<void>();
  readonly deleted = output<void>();

  private readonly area = viewChild<ElementRef<HTMLTextAreaElement>>('area');
  private readonly reader = viewChild<ElementRef<HTMLElement>>('reader');

  protected readonly layouts: EditLayout[] = ['edit', 'split'];
  readonly editing = signal(false);
  readonly layout = signal<EditLayout>('edit');
  readonly copilotOpen = signal(false);
  readonly historyOpen = signal(false);
  /** A mock-exam question whose concept the copilot should fit into this note (see NoteIntegrationService). */
  readonly concept = signal<ConceptRequest | null>(null);
  readonly confirmDelete = signal(false);
  readonly confirmLeave = signal(false);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly saveState = signal<SaveState>('idle');

  readonly title = signal('');
  readonly tagsText = signal('');
  readonly body = signal('');
  /** Last saved state, for dirty tracking and Cancel. */
  private readonly saved = signal({ title: '', tags: '', body: '' });

  readonly dirty = computed(() => {
    const s = this.saved();
    return this.editing() && (this.body() !== s.body || this.title() !== s.title || this.tagsText() !== s.tags);
  });
  readonly outlineOpen = this.settings.noteOutlineOpen;
  /** Text theme class for the note body; none when it follows the site theme. */
  readonly themeClass = computed(() => readingThemeClass(this.settings.noteReadingTheme()));
  readonly outline = computed(() => noteOutline(this.body()));
  /** Heading the reader is scrolled to (index among all headings). */
  readonly activeHeading = signal<number | null>(null);

  readonly words = computed(() => countWords(this.body()));
  readonly readMinutes = computed(() => Math.max(1, Math.round(this.words() / 200)));
  readonly saveLabel = computed(() => {
    if (this.dirty() && this.saveState() !== 'saving') return this.i18n.t('notes.unsaved');
    switch (this.saveState()) {
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

  private scrollFrame = 0;

  constructor() {
    const onScroll = () => {
      if (this.scrollFrame) return;
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = 0;
        this.trackActiveHeading();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('scroll', onScroll);
      if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    });
  }

  async ngOnInit(): Promise<void> {
    const n = this.note();
    const tags = n.tags.join(', ');
    this.title.set(n.title);
    this.tagsText.set(tags);
    try {
      const body = await this.notes.loadBody(n.id);
      this.body.set(body);
      this.saved.set({ title: n.title, tags, body });
      // Nothing to read yet: a new note opens straight in the editor.
      if (!body.trim()) this.editing.set(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
    // Arrived from "Add to summary note" in a mock exam: open the copilot on that question.
    const concept = this.integration.take(n.id);
    if (concept) {
      this.concept.set(concept);
      this.copilotOpen.set(true);
    }
    requestAnimationFrame(() => this.trackActiveHeading());
  }

  ngOnDestroy(): void {
    // Navigating away mid-edit keeps the work instead of dropping it.
    if (this.dirty()) void this.persist();
  }

  /** Browser close or reload with unsaved edits: let the browser ask first. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  startEdit(): void {
    this.confirmLeave.set(false);
    this.saveState.set('idle');
    this.editing.set(true);
    requestAnimationFrame(() => this.area()?.nativeElement.focus());
  }

  async saveEdit(): Promise<void> {
    if (await this.persist()) this.editing.set(false);
  }

  cancelEdit(): void {
    const s = this.saved();
    this.title.set(s.title);
    this.tagsText.set(s.tags);
    this.body.set(s.body);
    this.error.set(null);
    this.saveState.set('idle');
    this.editing.set(false);
  }

  onBody(value: string): void {
    this.body.set(value);
  }

  /** Copilot "undo": while reading, the restored text is saved right away. */
  applyBody(value: string): void {
    this.body.set(value);
    if (!this.editing()) void this.persist();
  }

  onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (this.dirty()) void this.persist();
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
    this.applyBody(`${this.body().trimEnd()}\n\n${markdown.trim()}\n`);
  }

  replaceAll(markdown: string): void {
    this.applyBody(markdown.trim() + '\n');
  }

  /** History "Restore": saved as a new version, so the replaced text stays restorable too. */
  async restoreVersion(markdown: string): Promise<void> {
    this.historyOpen.set(false);
    this.editing.set(false);
    const s = this.saved();
    this.title.set(s.title);
    this.tagsText.set(s.tags);
    this.body.set(markdown);
    await this.persist();
  }

  scrollToHeading(index: number): void {
    const target = this.headingElements()[index];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.activeHeading.set(index);
  }

  async onImage(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const files = Array.from(inputEl.files ?? []);
    inputEl.value = '';
    await this.insertImages(files);
  }

  /** A screenshot pasted into the text goes in at the cursor, like a typed image link. */
  onPaste(event: ClipboardEvent): void {
    const files = imageFiles(event.clipboardData?.files);
    if (files.length === 0) return;
    event.preventDefault();
    void this.insertImages(files);
  }

  onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  }

  /** Images dropped on the text go in at the cursor (a textarea does not
   * expose the text position under the pointer). */
  onDrop(event: DragEvent): void {
    const files = imageFiles(event.dataTransfer?.files);
    if (files.length === 0) return;
    event.preventDefault();
    void this.insertImages(files);
  }

  /** Uploads each image and inserts `![name](ref)` at the cursor, in order. */
  private async insertImages(files: File[]): Promise<void> {
    if (files.length === 0) return;
    this.uploading.set(true);
    this.error.set(null);
    try {
      for (const file of files) {
        const ref = await this.notes.uploadImage(this.note().id, file);
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '') || this.i18n.t('notes.imageAlt');
        this.insertAtCursor(`![${alt}](${ref})`);
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.uploading.set(false);
    }
  }

  leave(): void {
    if (this.dirty()) {
      this.confirmLeave.set(true);
      return;
    }
    this.back.emit();
  }

  async saveAndLeave(): Promise<void> {
    if (await this.persist()) this.back.emit();
  }

  discardAndLeave(): void {
    this.cancelEdit();
    this.back.emit();
  }

  async remove(): Promise<void> {
    const ok = await this.notes.remove(this.note().id);
    if (ok) {
      this.saved.set({ title: this.title(), tags: this.tagsText(), body: this.body() });
      this.editing.set(false);
      this.deleted.emit();
    } else this.error.set(this.i18n.t('notes.deleteFailed'));
  }

  /** Copilot edits go into the draft while editing; while reading they are saved at once. */
  private edit(fn: (text: string, start: number, end: number) => { text: string; cursor: number }): void {
    const el = this.area()?.nativeElement;
    const text = this.body();
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const result = fn(text, start, end);
    this.applyBody(result.text);
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(result.cursor, result.cursor);
      });
    }
  }

  /** Writes title, tags and body. Only a changed body makes a new version. */
  private async persist(): Promise<boolean> {
    const id = this.note().id;
    const before = this.saved();
    const next = { title: this.title(), tags: this.tagsText(), body: this.body() };
    this.saveState.set('saving');
    this.error.set(null);
    try {
      if (next.title !== before.title) this.notes.updateMeta(id, { title: next.title });
      if (next.tags !== before.tags) this.notes.updateMeta(id, { tags: next.tags.split(',') });
      if (next.body !== before.body) await this.notes.saveBody(id, next.body);
      this.saved.set(next);
      this.saveState.set('saved');
      return true;
    } catch (err) {
      this.saveState.set('error');
      this.error.set(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  private headingElements(): HTMLElement[] {
    const root = this.reader()?.nativeElement;
    return root ? Array.from(root.querySelectorAll<HTMLElement>('[data-level]')) : [];
  }

  /** The last heading whose top has passed the sticky header is the current section. */
  private trackActiveHeading(): void {
    if (this.editing() || !this.outlineOpen()) return;
    const headings = this.headingElements();
    if (headings.length === 0) return;
    const line = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 56) + 80;
    let active: number | null = null;
    headings.forEach((h, i) => {
      if (h.getBoundingClientRect().top <= line) active = i;
    });
    this.activeHeading.set(active ?? 0);
  }
}
