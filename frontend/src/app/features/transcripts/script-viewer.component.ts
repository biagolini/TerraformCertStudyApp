import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Script } from '../../core/models/script.model';
import { ScriptsService } from '../../core/services/scripts.service';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';

@Component({
  selector: 'app-script-viewer',
  standalone: true,
  imports: [FormsModule, AiDisclaimerComponent, MarkdownRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="viewer">
      @if (script(); as s) {
        <header class="viewer-header">
          @if (showBackButton()) {
            <button type="button" class="back-btn" (click)="back.emit()" aria-label="Back to script list">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/>
              </svg>
              <span>Back</span>
            </button>
          }
          <h2 class="title">{{ s.title }}</h2>
          <div class="header-actions">
            <button
              type="button"
              class="icon-btn"
              (click)="onToggleEdit(s)"
              [class.active]="editing()"
              [attr.aria-label]="editing() ? 'Exit edit mode' : 'Edit script manually'"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"/>
              </svg>
            </button>
            <button
              type="button"
              class="icon-btn delete-btn"
              (click)="onDelete(s.id)"
              aria-label="Delete this script"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>
              </svg>
            </button>
          </div>
        </header>

        <div class="viewer-body">
          @if (editing()) {
            <div class="edit-mode">
              <p class="edit-hint">Editing script (Markdown). Save to keep your changes; Cancel to discard.</p>
              <textarea class="edit-textarea" [(ngModel)]="editDraft" aria-label="Edit script markdown"></textarea>
              <div class="edit-actions">
                <button type="button" class="btn btn-ghost" (click)="onCancelEdit()">Cancel</button>
                <button
                  type="button"
                  class="btn btn-primary"
                  (click)="onSaveEdit(s.id)"
                  [disabled]="!editDraft.trim()"
                >Save</button>
              </div>
            </div>
          } @else {
            <app-ai-disclaimer
              message="This summary was assembled by AI from the transcripts you supplied. Re-read it against the original sources before publishing."
            />
            <app-markdown-renderer [source]="s.content" />
            <details class="sources">
              <summary>Source transcripts ({{ s.sources.length }})</summary>
              <ol class="sources-list">
                @for (src of s.sources; track $index) {
                  <li>
                    <details>
                      <summary>Aula {{ $index + 1 }} ({{ src.length }} chars)</summary>
                      <pre class="source-text">{{ src }}</pre>
                    </details>
                  </li>
                }
              </ol>
            </details>
          }
        </div>
      } @else {
        <div class="viewer-empty">
          <p class="empty-title">No script selected.</p>
          <p class="empty-body">Generate a new summary or pick one from the list to view it here.</p>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; height: 100%; }
      .viewer {
        display: flex; flex-direction: column; height: 100%;
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
        overflow: hidden;
      }
      .viewer-header {
        display: flex; align-items: center; gap: var(--space-sm);
        padding: var(--space-md) var(--space-lg);
        border-bottom: 1px solid var(--bg-border);
      }
      .back-btn {
        display: inline-flex; align-items: center; gap: var(--space-xs);
        min-height: var(--touch-min);
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .back-btn:hover { background: var(--bg-subtle); color: var(--text-primary); }
      .title {
        flex: 1; min-width: 0;
        font-size: var(--font-size-lg);
        color: var(--text-primary);
        line-height: 1.3;
        overflow-wrap: anywhere;
      }
      .header-actions { display: inline-flex; align-items: center; gap: var(--space-xs); }
      .icon-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: var(--touch-min); height: var(--touch-min);
        border-radius: var(--radius-md);
        color: var(--text-muted);
      }
      .icon-btn:hover { background: var(--bg-subtle); color: var(--text-primary); }
      .icon-btn.active { background: var(--bg-elevated); color: var(--color-purple); }
      .delete-btn:hover { color: var(--color-red); }
      .viewer-body {
        flex: 1; overflow-y: auto;
        padding: var(--space-lg);
        display: flex; flex-direction: column; gap: var(--space-md);
      }
      .edit-mode { display: flex; flex-direction: column; gap: var(--space-sm); flex: 1; }
      .edit-hint { color: var(--text-muted); font-size: var(--font-size-sm); }
      .edit-textarea {
        flex: 1; min-height: 360px;
        padding: var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: var(--font-size-base);
        line-height: 1.5;
        resize: vertical;
      }
      .edit-textarea:focus-visible { outline: none; border-color: var(--color-purple); }
      .edit-actions { display: flex; justify-content: flex-end; gap: var(--space-sm); }
      .btn {
        min-height: var(--touch-min);
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        font-weight: 600;
        font-size: var(--font-size-base);
      }
      .btn-primary { background: var(--color-purple); color: #ffffff; }
      .btn-primary:hover:not(:disabled) { background: var(--color-blue); }
      .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--bg-border); }
      .btn-ghost:hover { background: var(--bg-subtle); }
      .btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .viewer-empty {
        flex: 1; display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: var(--space-xs); padding: var(--space-xl);
        color: var(--text-muted); text-align: center;
      }
      .empty-title { font-size: var(--font-size-lg); color: var(--text-secondary); }
      .empty-body { font-size: var(--font-size-sm); }
      .sources {
        margin-top: var(--space-md);
        border-top: 1px solid var(--bg-border);
        padding-top: var(--space-md);
      }
      .sources > summary {
        cursor: pointer;
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        font-weight: 600;
      }
      .sources-list { padding-left: var(--space-md); margin-top: var(--space-sm); }
      .sources-list li { margin-bottom: var(--space-xs); }
      .sources-list summary {
        cursor: pointer;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .source-text {
        margin-top: var(--space-xs);
        padding: var(--space-sm);
        background: var(--bg-elevated);
        border-radius: var(--radius-sm);
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-secondary);
      }
    `,
  ],
})
export class ScriptViewerComponent {
  private readonly scriptsService = inject(ScriptsService);

  readonly script = input<Script | null>(null);
  readonly showBackButton = input<boolean>(false);
  readonly back = output<void>();
  readonly deleted = output<string>();

  protected readonly editing = signal(false);
  protected editDraft = '';

  constructor() {
    effect(() => {
      const s = this.script();
      this.editing.set(false);
      this.editDraft = s?.content ?? '';
    });
  }

  onToggleEdit(script: Script): void {
    if (this.editing()) {
      this.onCancelEdit();
    } else {
      this.editDraft = script.content;
      this.editing.set(true);
    }
  }

  onCancelEdit(): void {
    this.editing.set(false);
    this.editDraft = this.script()?.content ?? '';
  }

  onSaveEdit(id: string): void {
    const value = this.editDraft.trim();
    if (!value) return;
    this.scriptsService.setContent(id, value);
    this.editing.set(false);
  }

  onDelete(id: string): void {
    this.scriptsService.remove(id);
    this.deleted.emit(id);
  }
}
