import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ChatSession, DEFAULT_CHAT_TITLE } from '../../core/models/chat.model';
import { BedrockService } from '../../core/services/bedrock.service';
import { ChatService } from '../../core/services/chat.service';
import { ExportService } from '../../core/services/export.service';
import { ModelsService } from '../../core/services/models.service';
import { PacksService } from '../../core/services/packs.service';
import { SettingsService } from '../../core/services/settings.service';
import { parseTitleFromResponse, stripInferredMetadata } from '../../core/utils/domain-inference.util';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { ConfirmDeleteDialogComponent } from '../../shared/components/confirm-delete-dialog.component';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';

@Component({
  selector: 'app-chat-conversation',
  standalone: true,
  imports: [FormsModule, MatProgressSpinnerModule, DatePipe, AiDisclaimerComponent, MarkdownRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="viewer">
      @if (session(); as s) {
        <header class="viewer-header">
          @if (showBackButton()) {
            <button type="button" class="back-btn" (click)="back.emit()" aria-label="Back to conversation list">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/>
              </svg>
              <span>Back</span>
            </button>
          }
          @if (editingTitle()) {
            <input
              type="text"
              class="title-input"
              [(ngModel)]="titleDraft"
              (blur)="onSaveTitle(s)"
              (keydown.enter)="onSaveTitle(s)"
              aria-label="Conversation title"
            />
          } @else {
            <button type="button" class="title-btn" (click)="onEditTitle(s)" aria-label="Edit conversation title">
              <h2 class="title">{{ s.title }}</h2>
            </button>
          }
          <div class="header-actions">
            <button
              type="button"
              class="icon-btn delete-btn"
              (click)="onDelete(s)"
              aria-label="Delete this conversation"
              [disabled]="deleting()"
            >
              @if (deleting()) {
                <mat-spinner diameter="18"></mat-spinner>
              } @else {
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>
                </svg>
              }
            </button>
          </div>
        </header>

        <div class="viewer-body">
          @if (s.messages.length === 0) {
            <div class="empty-chat">
              <p class="empty-title">Start the conversation.</p>
              <p class="empty-body">Ask anything related to this certification's topics.</p>
            </div>
          } @else {
            <div class="messages">
              @for (message of s.messages; track $index) {
                @if (message.role === 'user') {
                  <div class="bubble bubble-user">
                    <p>{{ message.content }}</p>
                  </div>
                } @else {
                  <div class="bubble bubble-assistant">
                    <app-markdown-renderer [source]="message.content" />
                  </div>
                }
              }
            </div>
            <app-ai-disclaimer
              [tight]="true"
              message="Responses are AI-generated and may contain errors. Verify important facts before relying on them."
            />
          }

          @if (chatError()) {
            <p class="chat-error" role="alert">{{ chatError() }}</p>
          }

          <div class="composer">
            <textarea
              class="composer-textarea"
              [(ngModel)]="draft"
              rows="3"
              placeholder="Ask a question or continue the conversation..."
              [disabled]="sending()"
              (keydown.enter)="onComposerEnter($event)"
              aria-label="Message"
            ></textarea>
            <div class="composer-row">
              <label class="model-row">
                <span class="model-label">Model</span>
                <select
                  class="model-select"
                  [ngModel]="selectedModel()"
                  (ngModelChange)="onSelectModel($event)"
                  [disabled]="sending()"
                  aria-label="Model for chat"
                >
                  @for (model of availableModels(); track model.id) {
                    <option [value]="model.id">{{ model.displayName }}{{ model.reasoning ? ' (reasoning)' : '' }} — {{ model.tier }}</option>
                  }
                </select>
              </label>
              @if (sending()) {
                <button type="button" class="btn btn-stop" (click)="onStopSend()">
                  <span class="stop-icon" aria-hidden="true"></span>
                  <span>Stop</span>
                </button>
              } @else {
                <button type="button" class="btn btn-primary" (click)="onSend(s)" [disabled]="!draft.trim()">
                  Send
                </button>
              }
            </div>
          </div>

          <section class="summary-panel">
            <header class="summary-header">
              <div class="summary-header-row">
                <h3>NotebookLM summary</h3>
                @if (s.summary && !summarizing()) {
                  <button
                    type="button"
                    class="icon-btn"
                    (click)="onToggleEditSummary(s)"
                    [class.active]="editingSummary()"
                    [attr.aria-label]="editingSummary() ? 'Exit edit mode' : 'Edit summary'"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"/>
                    </svg>
                  </button>
                }
              </div>
              <p class="summary-hint">
                Generate a structured technical summary of this conversation, ready to feed into NotebookLM as a podcast source.
              </p>
            </header>

            @if (s.summary) {
              @if (editingSummary()) {
                <textarea
                  class="edit-summary-textarea"
                  [(ngModel)]="summaryDraft"
                  aria-label="Edit summary markdown"
                ></textarea>
                <div class="summary-edit-actions">
                  <button type="button" class="btn btn-ghost" (click)="onCancelEditSummary(s)">Cancel</button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    (click)="onSaveEditSummary(s)"
                    [disabled]="!summaryDraft.trim()"
                  >Save</button>
                </div>
              } @else {
                <app-markdown-renderer [source]="s.summary" />
                @if (s.summaryUpdatedAt) {
                  <p class="summary-meta">Last updated: {{ s.summaryUpdatedAt | date: 'medium' }}</p>
                }
                <app-ai-disclaimer
                  [tight]="true"
                  message="This summary is AI-generated from the conversation above. Review it before sharing or narrating it."
                />
              }
            }

            @if (summaryError()) {
              <p class="chat-error" role="alert">{{ summaryError() }}</p>
            }

            <div class="summary-actions">
              @if (summarizing()) {
                <button type="button" class="btn btn-stop" (click)="onStopSummary()">
                  <span class="stop-icon" aria-hidden="true"></span>
                  <span>Stop</span>
                </button>
              } @else {
                <button
                  type="button"
                  class="btn btn-primary"
                  (click)="onGenerateSummary(s)"
                  [disabled]="s.messages.length === 0"
                >
                  {{ s.summary ? 'Update summary' : 'Generate summary' }}
                </button>
              }
              @if (s.summary && !summarizing()) {
                <button type="button" class="btn btn-ghost" (click)="onDownloadSummary(s)">
                  Download
                </button>
              }
            </div>
          </section>
        </div>
      } @else {
        <div class="viewer-empty">
          <p class="empty-title">No conversation selected.</p>
          <p class="empty-body">Start a new conversation or pick one from the list to view it here.</p>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .viewer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
        overflow: hidden;
      }
      .viewer-header {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-md) var(--space-lg);
        border-bottom: 1px solid var(--bg-border);
        background: var(--bg-surface);
      }
      .back-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        min-height: var(--touch-min);
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .back-btn:hover {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .title-btn {
        flex: 1;
        min-width: 0;
        text-align: left;
        background: none;
        padding: 0;
      }
      .title {
        font-size: var(--font-size-lg);
        color: var(--text-primary);
        line-height: 1.3;
        overflow-wrap: anywhere;
      }
      .title-input {
        flex: 1;
        min-width: 0;
        font-size: var(--font-size-lg);
        padding: var(--space-xs) var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-purple);
        background: var(--bg-input);
        color: var(--text-primary);
      }
      .header-actions {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
      }
      .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        border-radius: var(--radius-md);
        color: var(--text-muted);
      }
      .icon-btn:hover:not(:disabled) {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .icon-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .delete-btn:hover:not(:disabled) {
        color: var(--color-red);
      }
      .viewer-body {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .empty-chat {
        padding: var(--space-xl);
        text-align: center;
        color: var(--text-muted);
        background: var(--bg-elevated);
        border-radius: var(--radius-md);
        border: 1px dashed var(--bg-border);
      }
      .messages {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .bubble {
        max-width: 85%;
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        line-height: 1.5;
      }
      .bubble-user {
        align-self: flex-end;
        background: var(--color-purple);
        color: #ffffff;
      }
      .bubble-user p {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .bubble-assistant {
        align-self: flex-start;
        background: var(--bg-elevated);
        color: var(--text-primary);
      }
      .chat-error {
        color: var(--color-red);
        font-size: var(--font-size-sm);
      }
      .composer {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: var(--space-md);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
      }
      .composer-textarea {
        width: 100%;
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-family: var(--font-family);
        font-size: var(--font-size-base);
        line-height: 1.5;
        resize: vertical;
      }
      .composer-textarea:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .composer-textarea:disabled {
        opacity: 0.6;
      }
      .composer-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .model-row {
        flex: 1;
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-width: 0;
      }
      .model-label {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        flex-shrink: 0;
      }
      .model-select {
        flex: 1;
        min-width: 0;
        max-width: 100%;
        min-height: 36px;
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
      }
      .model-select:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .model-select:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .summary-panel {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: var(--space-md);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
      }
      .summary-header h3 {
        font-size: var(--font-size-base);
        color: var(--text-primary);
        margin-bottom: var(--space-xs);
      }
      .summary-header-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .summary-hint {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
      }
      .summary-meta {
        color: var(--text-faint);
        font-size: var(--font-size-xs);
      }
      .edit-summary-textarea {
        width: 100%;
        min-height: 240px;
        padding: var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        resize: vertical;
      }
      .edit-summary-textarea:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .summary-edit-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-sm);
      }
      .summary-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-sm);
      }
      .btn {
        min-height: var(--touch-min);
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        font-weight: 600;
        font-size: var(--font-size-base);
        display: inline-flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .btn-primary {
        background: var(--color-purple);
        color: #ffffff;
      }
      .btn-primary:hover:not(:disabled) {
        background: var(--color-blue);
      }
      .btn-ghost {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--bg-border);
      }
      .btn-ghost:hover:not(:disabled) {
        background: var(--bg-subtle);
      }
      .btn-stop {
        background: var(--color-red);
        color: #ffffff;
      }
      .btn-stop:hover {
        filter: brightness(1.1);
      }
      .stop-icon {
        width: 12px;
        height: 12px;
        background: #ffffff;
        border-radius: 2px;
      }
      .btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .viewer-empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-xs);
        padding: var(--space-xl);
        color: var(--text-muted);
        text-align: center;
      }
      .empty-title {
        font-size: var(--font-size-lg);
        color: var(--text-secondary);
      }
      .empty-body {
        font-size: var(--font-size-sm);
      }
    `,
  ],
})
export class ChatConversationComponent {
  private readonly chatService = inject(ChatService);
  private readonly bedrock = inject(BedrockService);
  private readonly settings = inject(SettingsService);
  private readonly modelsService = inject(ModelsService);
  private readonly packs = inject(PacksService);
  private readonly exportService = inject(ExportService);
  private readonly dialog = inject(MatDialog);

  readonly session = input<ChatSession | null>(null);
  readonly showBackButton = input<boolean>(false);
  readonly back = output<void>();
  readonly deleted = output<string>();

  protected readonly deleting = signal(false);
  protected readonly sending = signal(false);
  protected readonly summarizing = signal(false);
  protected readonly editingSummary = signal(false);
  protected readonly chatError = signal<string | null>(null);
  protected readonly summaryError = signal<string | null>(null);
  protected readonly editingTitle = signal(false);
  protected readonly modelOverride = signal<string | null>(null);
  protected draft = '';
  protected titleDraft = '';
  protected summaryDraft = '';
  private sendController: AbortController | null = null;
  private summaryController: AbortController | null = null;

  readonly availableModels = this.modelsService.models;
  readonly selectedModel = computed(
    () => this.modelOverride() ?? this.modelsService.resolveModel(this.settings.defaultModel()),
  );

  constructor() {
    effect(() => {
      // Reset transient UI state whenever the displayed session changes.
      this.session();
      this.draft = '';
      this.chatError.set(null);
      this.summaryError.set(null);
      this.editingTitle.set(false);
      this.editingSummary.set(false);
    });
  }

  onEditTitle(session: ChatSession): void {
    this.titleDraft = session.title;
    this.editingTitle.set(true);
  }

  onSaveTitle(session: ChatSession): void {
    const value = this.titleDraft.trim();
    if (value) {
      this.chatService.updatePartial(session.id, { title: value });
    }
    this.editingTitle.set(false);
  }

  onSelectModel(value: string): void {
    this.modelOverride.set(value);
  }

  onComposerEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.shiftKey) return;
    keyboardEvent.preventDefault();
    const session = this.session();
    if (session && this.draft.trim() && !this.sending()) {
      this.onSend(session);
    }
  }

  async onSend(session: ChatSession): Promise<void> {
    const text = this.draft.trim();
    if (!text) return;

    this.chatService.appendMessage(session.id, { role: 'user', content: text });
    this.draft = '';

    const controller = new AbortController();
    this.sendController = controller;
    this.sending.set(true);
    this.chatError.set(null);

    this.chatService.appendMessage(session.id, { role: 'assistant', content: '' });

    try {
      const activePack = this.packs.activePack();
      const history = (this.chatService.getById(session.id)?.messages ?? [])
        .slice(0, -1)
        .map((m) => ({ role: m.role, content: m.content }));

      for await (const chunk of this.bedrock.streamChat(
        history,
        { name: activePack.name, description: activePack.description, domains: activePack.domains },
        this.selectedModel(),
        controller.signal,
        this.settings.outputLanguage(),
      )) {
        this.chatService.appendToLastMessage(session.id, chunk);
      }
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError' || controller.signal.aborted;
      if (!aborted) {
        this.chatError.set(err instanceof Error ? err.message : 'Failed to get a response.');
      }
    } finally {
      this.sending.set(false);
      this.sendController = null;
    }
  }

  onStopSend(): void {
    this.sendController?.abort();
  }

  async onGenerateSummary(session: ChatSession): Promise<void> {
    if (session.messages.length === 0) return;

    const controller = new AbortController();
    this.summaryController = controller;
    this.summarizing.set(true);
    this.summaryError.set(null);

    let started = false;
    let accumulated = '';
    const existingSummary = session.summary;

    try {
      const activePack = this.packs.activePack();
      const history = session.messages.map((m) => ({ role: m.role, content: m.content }));

      for await (const chunk of this.bedrock.streamChatSummary(
        history,
        existingSummary,
        { name: activePack.name, description: activePack.description, domains: activePack.domains },
        this.selectedModel(),
        controller.signal,
        this.settings.outputLanguage(),
      )) {
        accumulated += chunk;
        if (!started) {
          this.chatService.setSummary(session.id, chunk);
          started = true;
        } else {
          this.chatService.appendToSummary(session.id, chunk);
        }
      }

      this.chatService.setSummary(session.id, stripInferredMetadata(accumulated));
      if (session.title === DEFAULT_CHAT_TITLE) {
        const inferred = parseTitleFromResponse(accumulated, '');
        if (inferred) {
          this.chatService.updatePartial(session.id, { title: inferred });
        }
      }
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError' || controller.signal.aborted;
      if (started) {
        if (aborted) {
          this.chatService.setSummary(session.id, stripInferredMetadata(accumulated));
        } else {
          this.chatService.setSummary(session.id, existingSummary);
          this.summaryError.set(err instanceof Error ? err.message : 'Summary generation failed.');
        }
      } else if (!aborted) {
        this.summaryError.set(err instanceof Error ? err.message : 'Summary generation failed.');
      }
    } finally {
      this.summarizing.set(false);
      this.summaryController = null;
    }
  }

  onStopSummary(): void {
    this.summaryController?.abort();
  }

  onDownloadSummary(session: ChatSession): void {
    if (!session.summary.trim()) return;
    const pack = this.packs.activePack();
    const filename = this.exportService.buildFilename(pack.name, 'chat-summary', pack.version);
    this.exportService.downloadFile(session.summary, filename);
  }

  onToggleEditSummary(session: ChatSession): void {
    if (this.editingSummary()) {
      this.onSaveEditSummary(session);
    } else {
      this.summaryDraft = session.summary;
      this.editingSummary.set(true);
    }
  }

  onCancelEditSummary(session: ChatSession): void {
    this.editingSummary.set(false);
    this.summaryDraft = session.summary;
  }

  onSaveEditSummary(session: ChatSession): void {
    const value = this.summaryDraft.trim();
    if (!value) return;
    this.chatService.setSummary(session.id, value);
    this.editingSummary.set(false);
  }

  onDelete(session: ChatSession): void {
    const dialogRef = this.dialog.open(ConfirmDeleteDialogComponent, {
      data: { title: session.title },
      width: '400px',
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result !== 'confirm') return;
      this.deleting.set(true);
      this.chatService.remove(session.id);
      this.deleting.set(false);
      this.deleted.emit(session.id);
    });
  }
}
