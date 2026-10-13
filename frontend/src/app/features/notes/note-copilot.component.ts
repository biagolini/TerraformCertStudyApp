import { IconComponent } from '../../shared/components/icon.component';
import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BedrockService } from '../../core/services/bedrock.service';
import { PacksService } from '../../core/services/packs.service';
import { toPackContext } from '../../core/models/pack.model';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { COPILOT_ACTIONS, COPILOT_ACTION_INSTRUCTIONS, CONCEPT_APPLY_REQUEST, CopilotAction, buildConceptProposalRequest, extractUpdatedNote } from '../../core/utils/assistant-prompt.util';
import { ConceptRequest } from '../../core/services/note-integration.service';
import { examPath } from '../../core/utils/routes.util';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';

interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Short label shown instead of the long instruction (one-click actions) or the full updated note (applied concept). */
  label?: string;
  /** The reply that rewrote the note after "Apply to note". */
  applied?: boolean;
}

/**
 * Side panel that reads the note being edited and answers through Bedrock
 * (/converse streaming). Replies are Markdown the user can insert at the
 * cursor, append, or use to replace the note; nothing is applied without a click.
 * The conversation lives only for the editing session (per note id).
 */
@Component({
  selector: 'app-note-copilot',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FormsModule, MarkdownRendererComponent, AiDisclaimerComponent],
  template: `
    <aside class="copilot ui-card" [attr.aria-label]="i18n.t('notes.copilot')">
      <header class="head">
        <span class="badge" aria-hidden="true"><app-icon name="sparkles" size="18" /></span>
        <div class="head-text">
          <strong>{{ i18n.t('notes.copilotTitle') }}</strong>
          <span class="ui-faint">{{ i18n.t('notes.copilotSubtitle') }}</span>
        </div>
        <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="closed.emit()" [attr.aria-label]="i18n.t('common.close')"><app-icon name="x" /></button>
      </header>
      @if (concept(); as c) {
        <div class="concept">
          <span class="ui-label">{{ i18n.t('notes.conceptFrom') }}</span>
          <strong class="concept-title">{{ c.question.title }}</strong>
          @if (c.fromQuiz) {
            <button type="button" class="ui-link" (click)="backToQuiz(c.packId)"><app-icon name="arrow-left" size="12" /> {{ i18n.t('notes.backToQuiz') }}</button>
          }
        </div>
      }
      <div class="ui-chip-row actions">
        @for (a of actions; track a) {
          <button type="button" class="ui-chip" [disabled]="streaming()" (click)="runAction(a)">{{ i18n.t('copilot.' + a) }}</button>
        }
      </div>
      <div class="thread" #thread>
        @if (messages().length === 0 && !streaming()) {
          <p class="ui-muted hint">{{ i18n.t('notes.copilotHint') }}</p>
        }
        @for (m of messages(); track $index) {
          <div class="msg" [class.user]="m.role === 'user'">
            @if (m.role === 'user') {
              <p>{{ m.label ?? m.content }}</p>
            } @else if (m.applied) {
              <p class="applied"><app-icon name="check" size="14" /> {{ m.label }}</p>
              @if (undoMarkdown() !== null && $last) {
                <div class="msg-actions">
                  <button type="button" class="ui-btn ui-btn-sm" (click)="undo()"><app-icon name="rotate-ccw" size="14" /> {{ i18n.t('notes.undoConcept') }}</button>
                </div>
              }
            } @else {
              <app-markdown-renderer [source]="m.content" />
              @if (concept() && $last && !streaming()) {
                <div class="msg-actions">
                  <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" (click)="applyConcept()"><app-icon name="check" size="14" /> {{ i18n.t('notes.applyConcept') }}</button>
                </div>
              }
              <div class="msg-actions">
                <button type="button" class="ui-btn ui-btn-sm" (click)="insert.emit(m.content)">{{ i18n.t('notes.insertAtCursor') }}</button>
                <button type="button" class="ui-btn ui-btn-sm" (click)="append.emit(m.content)">{{ i18n.t('notes.appendToNote') }}</button>
                <button type="button" class="ui-btn ui-btn-sm" (click)="confirmReplace.set($index)">{{ i18n.t('notes.replaceNote') }}</button>
                <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" (click)="copy(m.content)">{{ copied() === $index ? i18n.t('notes.copied') : i18n.t('notes.copy') }}</button>
              </div>
              @if (confirmReplace() === $index) {
                <div class="confirm">
                  <span>{{ i18n.t('notes.replaceConfirm') }}</span>
                  <button type="button" class="ui-btn ui-btn-sm" (click)="confirmReplace.set(null)">{{ i18n.t('common.cancel') }}</button>
                  <button type="button" class="ui-btn ui-btn-sm ui-btn-danger" (click)="doReplace(m.content)">{{ i18n.t('notes.replaceNote') }}</button>
                </div>
              }
            }
          </div>
        }
        @if (streaming()) {
          <div class="msg">
            @if (draft()) {
              <app-markdown-renderer [source]="draft()" />
            } @else {
              <p class="ui-muted">{{ i18n.t('tutor.thinking') }}</p>
            }
          </div>
        }
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </div>
      <form class="composer" (ngSubmit)="ask(question)">
        <label class="ui-sr-only" for="copilot-input">{{ i18n.t('notes.copilotPlaceholder') }}</label>
        <textarea id="copilot-input" class="ui-input" name="q" rows="2" [(ngModel)]="question" [placeholder]="i18n.t('notes.copilotPlaceholder')" (keydown.enter)="onEnter($event)"></textarea>
        @if (streaming()) {
          <button type="button" class="ui-btn" (click)="stop()">{{ i18n.t('tutor.stop') }}</button>
        } @else {
          <button type="submit" class="ui-btn ui-btn-accent" [disabled]="!question.trim()">{{ i18n.t('tutor.send') }}</button>
        }
      </form>
      <app-ai-disclaimer />
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .copilot {
        position: sticky;
        top: calc(var(--header-height) + 56px);
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        max-height: calc(100vh - var(--header-height) - 80px);
      }
      .head {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: var(--radius-md);
        background: linear-gradient(135deg, var(--color-purple), var(--color-blue));
        color: #fff;
      }
      .head-text {
        display: flex;
        flex-direction: column;
        flex: 1;
        line-height: 1.2;
      }
      .actions {
        padding-bottom: var(--space-sm);
        border-bottom: 1px solid var(--bg-border);
      }
      .thread {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        min-height: 160px;
      }
      .hint {
        font-size: var(--font-size-sm);
      }
      .msg {
        padding: var(--space-sm);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        font-size: var(--font-size-sm);
      }
      .msg.user {
        background: rgba(108, 92, 231, 0.12);
        align-self: flex-end;
        max-width: 90%;
      }
      .msg-actions,
      .confirm {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: var(--space-sm);
        align-items: center;
      }
      .composer {
        display: flex;
        gap: var(--space-sm);
        align-items: flex-end;
      }
      .composer textarea {
        flex: 1;
      }
      .error {
        color: var(--color-red);
        font-size: var(--font-size-sm);
      }
      .concept {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--space-sm);
        border-radius: var(--radius-md);
        background: rgba(108, 92, 231, 0.08);
      }
      .concept-title {
        font-size: var(--font-size-sm);
      }
      .applied {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--color-green);
        font-weight: 600;
      }
    `,
  ],
})
export class NoteCopilotComponent {
  private readonly bedrock = inject(BedrockService);
  private readonly packs = inject(PacksService);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  readonly noteId = input.required<string>();
  readonly title = input.required<string>();
  readonly markdown = input.required<string>();
  /** A mock-exam question whose concept should go into this note: starts with a proposal, edits only on "Apply to note". */
  readonly concept = input<ConceptRequest | null>(null);
  readonly insert = output<string>();
  readonly append = output<string>();
  readonly replace = output<string>();
  /** Puts back the exact previous text (Undo). */
  readonly restore = output<string>();
  readonly closed = output<void>();

  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');

  protected readonly actions = COPILOT_ACTIONS;
  protected question = '';
  readonly messages = signal<CopilotMessage[]>([]);
  readonly streaming = signal(false);
  readonly draft = signal('');
  readonly error = signal<string | null>(null);
  readonly confirmReplace = signal<number | null>(null);
  readonly copied = signal<number | null>(null);
  private controller: AbortController | null = null;
  /** The note before the last applied concept, for Undo. */
  readonly undoMarkdown = signal<string | null>(null);
  private conceptStarted: string | null = null;

  constructor() {
    // A concept request starts the conversation with the proposal (once per question).
    effect(() => {
      const c = this.concept();
      if (!c || this.conceptStarted === c.question.id) return;
      this.conceptStarted = c.question.id;
      untracked(() =>
        void this.send(
          buildConceptProposalRequest(c.question, c.selected, c.tutor),
          this.i18n.t('notes.conceptAsk', { title: c.question.title }),
        ),
      );
    });
  }

  /** The student authorized the proposal: get the full updated note and put it in the editor. */
  applyConcept(): void {
    void this.send(CONCEPT_APPLY_REQUEST, this.i18n.t('notes.applyConcept'), true);
  }

  undo(): void {
    const previous = this.undoMarkdown();
    if (previous === null) return;
    this.undoMarkdown.set(null);
    this.restore.emit(previous);
  }

  backToQuiz(packId: string): void {
    void this.router.navigate(examPath(packId, 'quiz'));
  }

  runAction(action: CopilotAction): void {
    void this.send(COPILOT_ACTION_INSTRUCTIONS[action], this.i18n.t('copilot.' + action));
  }

  ask(text: string): void {
    const content = text.trim();
    if (!content) return;
    this.question = '';
    void this.send(content);
  }

  onEnter(event: Event): void {
    const e = event as KeyboardEvent;
    if (e.shiftKey) return;
    e.preventDefault();
    this.ask(this.question);
  }

  stop(): void {
    this.controller?.abort();
  }

  doReplace(content: string): void {
    this.confirmReplace.set(null);
    this.replace.emit(content);
  }

  async copy(content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      const idx = this.messages().findIndex((m) => m.content === content);
      this.copied.set(idx);
      setTimeout(() => this.copied.set(null), 1500);
    } catch {
      /* clipboard unavailable (permissions); nothing else to do */
    }
  }

  private async send(content: string, label?: string, apply = false): Promise<void> {
    if (this.streaming()) return;
    const before = this.markdown();
    this.error.set(null);
    this.messages.update((list) => [...list, { role: 'user', content, label }]);
    const pack = this.packs.activePack();
    this.controller = new AbortController();
    this.streaming.set(true);
    this.draft.set('');
    let reply = '';
    try {
      for await (const chunk of this.bedrock.streamNoteCopilot(
        this.title(),
        this.markdown(),
        this.messages().map((m) => ({ role: m.role, content: m.content })),
        toPackContext(pack),
        this.settings.defaultModel(),
        this.controller.signal,
        this.settings.outputLanguage(),
      )) {
        reply += chunk;
        this.draft.set(reply);
        this.scroll();
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        this.error.set(err instanceof Error ? err.message : String(err));
      }
    } finally {
      this.streaming.set(false);
      this.draft.set('');
      this.controller = null;
      if (reply.trim() && apply) {
        // Only now does the note change, and Undo brings the previous text back.
        this.undoMarkdown.set(before);
        this.replace.emit(extractUpdatedNote(reply));
        this.messages.update((list) => [...list, { role: 'assistant', content: reply.trim(), label: this.i18n.t('notes.conceptApplied'), applied: true }]);
      } else if (reply.trim()) this.messages.update((list) => [...list, { role: 'assistant', content: reply.trim() }]);
      else this.messages.update((list) => list.slice(0, -1));
      this.scroll();
    }
  }

  private scroll(): void {
    requestAnimationFrame(() => {
      const el = this.thread()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
