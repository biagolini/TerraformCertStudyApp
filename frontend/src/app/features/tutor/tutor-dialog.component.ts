import { IconComponent } from '../../shared/components/icon.component';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Question } from '../../core/models/question.model';
import { TutorMessage } from '../../core/models/quiz-attempt.model';
import { BedrockService } from '../../core/services/bedrock.service';
import { PacksService } from '../../core/services/packs.service';
import { toPackContext } from '../../core/models/pack.model';
import { QuizService } from '../../core/services/quiz.service';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { SummaryNotePickerComponent } from '../notes/summary-note-picker.component';
import { NoteIntegrationService } from '../../core/services/note-integration.service';
import { examPath } from '../../core/utils/routes.util';
import { Router } from '@angular/router';

/**
 * Ask-the-tutor side panel for one mock-exam question. The conversation is
 * stored on the attempt's answer (QuizService.appendTutorMessage), so it is
 * there again when the attempt is resumed or reopened from history.
 */
@Component({
  selector: 'app-tutor-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FormsModule, MarkdownRendererComponent, AiDisclaimerComponent, SummaryNotePickerComponent],
  template: `
    <aside class="tutor-panel" role="complementary" aria-labelledby="tutor-title" (keydown.escape)="close()">
      <header class="panel-head">
        <span class="badge" aria-hidden="true"><app-icon name="sparkles" size="16" /></span>
        <div class="head-text">
          <h2 id="tutor-title">{{ i18n.t('tutor.title') }}</h2>
          <p class="ui-faint">{{ question().title }}</p>
        </div>
        <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="close()" [attr.aria-label]="i18n.t('common.close')"><app-icon name="x" /></button>
      </header>
      @if (locked()) {
        <div class="panel-body">
          <p class="ui-muted">{{ i18n.t('tutor.locked') }}</p>
        </div>
      } @else {
        <div class="panel-body" #scroller>
          <div class="summary">
            <span class="ui-chip">{{ i18n.t('tutor.yourAnswer') }}: {{ selected().length ? selected().join(', ') : i18n.t('tutor.blank') }}</span>
            <span class="ui-chip ui-chip-good">{{ i18n.t('tutor.correctAnswer') }}: {{ correct() }}</span>
          </div>
          @if (messages().length === 0 && !streaming()) {
            <p class="ui-muted">{{ i18n.t('tutor.intro') }}</p>
            <div class="ui-chip-row">
              @for (s of suggestions(); track s) {
                <button type="button" class="ui-chip" (click)="send(s)">{{ s }}</button>
              }
            </div>
          }
          @for (m of messages(); track $index) {
            <div class="msg" [class.user]="m.role === 'user'">
              @if (m.role === 'user') {
                <p>{{ m.content }}</p>
              } @else {
                <app-markdown-renderer [source]="m.content" />
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
          <app-ai-disclaimer />
        </div>
        <div class="panel-tools">
          <button type="button" class="ui-btn ui-btn-sm" [disabled]="streaming()" (click)="pickerOpen.set(true)" [title]="i18n.t('tutor.toSummaryHint')">
            <app-icon name="file-text" size="14" /> {{ i18n.t('tutor.toSummary') }}
          </button>
        </div>
        <form class="composer" (ngSubmit)="send(input)">
          <label class="ui-sr-only" for="tutor-input">{{ i18n.t('tutor.placeholder') }}</label>
          <input id="tutor-input" class="ui-input" name="q" [(ngModel)]="input" [placeholder]="i18n.t('tutor.placeholder')" [disabled]="streaming()" autocomplete="off" />
          @if (streaming()) {
            <button type="button" class="ui-btn" (click)="stop()">{{ i18n.t('tutor.stop') }}</button>
          } @else {
            <button type="submit" class="ui-btn ui-btn-accent" [disabled]="!input.trim()">{{ i18n.t('tutor.send') }}</button>
          }
        </form>
      }
    </aside>
    @if (pickerOpen()) {
      <app-summary-note-picker (picked)="toSummary($event)" (closed)="pickerOpen.set(false)" />
    }
  `,
  styles: [
    `
      // Docked beside the question (not a modal), so the student can read the
      // scenario while discussing it. Full width on a phone.
      .tutor-panel {
        position: fixed;
        top: var(--header-height);
        right: 0;
        bottom: 0;
        z-index: 45;
        width: min(440px, 100vw);
        display: flex;
        flex-direction: column;
        background: var(--bg-surface);
        border-left: 1px solid var(--bg-border);
        box-shadow: var(--shadow-lg);
      }
      .panel-head {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-md);
        border-bottom: 1px solid var(--bg-border);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        flex-shrink: 0;
        border-radius: var(--radius-md);
        background: var(--color-purple);
        color: var(--inverse-fg);
      }
      .head-text {
        flex: 1;
        min-width: 0;
      }
      .head-text h2 {
        font-size: var(--font-size-base);
        font-weight: 700;
      }
      .head-text p {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .panel-body {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: var(--space-md);
      }
      .panel-tools {
        display: flex;
        justify-content: flex-end;
        padding: var(--space-xs) var(--space-md);
        border-top: 1px solid var(--bg-border);
      }
      .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .msg {
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        max-width: 92%;
        font-size: var(--font-size-sm);
      }
      .msg.user {
        align-self: flex-end;
        background: rgba(108, 92, 231, 0.12);
      }
      .composer {
        display: flex;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md) var(--space-md);
      }
      .composer .ui-input {
        flex: 1;
      }
      .error {
        color: var(--color-red);
      }
    `,
  ],
})
export class TutorDialogComponent {
  private readonly bedrock = inject(BedrockService);
  private readonly packs = inject(PacksService);
  private readonly quiz = inject(QuizService);
  private readonly settings = inject(SettingsService);
  private readonly integration = inject(NoteIntegrationService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  readonly question = input.required<Question>();
  readonly selected = input<readonly string[]>([]);
  /** The question is not answered yet: the panel stays open but cannot discuss it. */
  readonly locked = input(false);
  readonly closed = output<void>();
  readonly pickerOpen = signal(false);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected input = '';
  readonly streaming = signal(false);
  readonly draft = signal('');
  readonly error = signal<string | null>(null);
  private controller: AbortController | null = null;

  readonly messages = computed<TutorMessage[]>(() => this.quiz.tutorById()[this.question().id] ?? []);
  readonly correct = computed(() =>
    this.question()
      .alternatives.filter((a) => a.isCorrect)
      .map((a) => a.letter)
      .join(', '),
  );
  readonly suggestions = computed(() => {
    const right = this.selected().length > 0 && [...this.selected()].sort().join() === this.correct().split(', ').sort().join();
    return [
      right ? this.i18n.t('tutor.suggestWhyRight') : this.i18n.t('tutor.suggestWhyWrong'),
      this.i18n.t('tutor.suggestDistractors'),
      this.i18n.t('tutor.suggestSimilar'),
    ];
  });

  async send(text: string): Promise<void> {
    const content = text.trim();
    if (!content || this.streaming()) return;
    this.input = '';
    this.error.set(null);
    const q = this.question();
    this.quiz.appendTutorMessage(q.id, { role: 'user', content, at: Date.now() });
    const history = this.messages().map((m) => ({ role: m.role, content: m.content }));
    const pack = this.packs.activePack();
    this.controller = new AbortController();
    this.streaming.set(true);
    this.draft.set('');
    let reply = '';
    try {
      for await (const chunk of this.bedrock.streamTutor(
        q,
        this.selected(),
        history,
        toPackContext(pack),
        this.settings.defaultModel(),
        this.controller.signal,
        this.settings.outputLanguage(),
      )) {
        reply += chunk;
        this.draft.set(reply);
        this.scrollToEnd();
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        this.error.set(err instanceof Error ? err.message : String(err));
      }
    } finally {
      this.streaming.set(false);
      this.draft.set('');
      this.controller = null;
      if (reply.trim()) this.quiz.appendTutorMessage(q.id, { role: 'assistant', content: reply, at: Date.now() });
      this.scrollToEnd();
    }
  }

  stop(): void {
    this.controller?.abort();
  }

  close(): void {
    this.stop();
    this.closed.emit();
  }

  /** Hands the question (and what was discussed) to the chosen note's copilot, pausing a running exam on the way. */
  toSummary(noteId: string): void {
    this.pickerOpen.set(false);
    const q = this.question();
    const packId = this.packs.activePack().id;
    const fromQuiz = this.quiz.phase() === 'running' || this.quiz.phase() === 'results';
    this.integration.request({ noteId, packId, question: q, selected: this.selected(), tutor: this.messages(), fromQuiz });
    if (fromQuiz && !this.quiz.paused()) this.quiz.pause();
    this.close();
    void this.router.navigate(examPath(packId, 'notes', noteId));
  }

  private scrollToEnd(): void {
    requestAnimationFrame(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
