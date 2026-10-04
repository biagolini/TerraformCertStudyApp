import { IconComponent } from '../../shared/components/icon.component';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Question } from '../../core/models/question.model';
import { TutorMessage } from '../../core/models/quiz-attempt.model';
import { BedrockService } from '../../core/services/bedrock.service';
import { PacksService } from '../../core/services/packs.service';
import { QuizService } from '../../core/services/quiz.service';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';

/**
 * Ask-the-tutor modal for one mock-exam question. The conversation is
 * stored on the attempt's answer (QuizService.appendTutorMessage), so it is
 * there again when the attempt is resumed or reopened from history.
 */
@Component({
  selector: 'app-tutor-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FormsModule, MarkdownRendererComponent, AiDisclaimerComponent],
  template: `
    <div class="ui-modal-backdrop" (click)="close()">
      <section class="ui-modal ui-modal-wide" role="dialog" aria-modal="true" aria-labelledby="tutor-title" (click)="$event.stopPropagation()">
        <header class="ui-modal-head">
          <div>
            <h2 id="tutor-title"><app-icon name="sparkles" /> {{ i18n.t('tutor.title') }}</h2>
            <p>{{ question().title }}</p>
          </div>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="close()" [attr.aria-label]="i18n.t('common.close')"><app-icon name="x" /></button>
        </header>
        <div class="ui-modal-body" #scroller>
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
        <form class="ui-modal-foot composer" (ngSubmit)="send(input)">
          <label class="ui-sr-only" for="tutor-input">{{ i18n.t('tutor.placeholder') }}</label>
          <input id="tutor-input" class="ui-input" name="q" [(ngModel)]="input" [placeholder]="i18n.t('tutor.placeholder')" [disabled]="streaming()" autocomplete="off" />
          @if (streaming()) {
            <button type="button" class="ui-btn" (click)="stop()">{{ i18n.t('tutor.stop') }}</button>
          } @else {
            <button type="submit" class="ui-btn ui-btn-accent" [disabled]="!input.trim()">{{ i18n.t('tutor.send') }}</button>
          }
        </form>
      </section>
    </div>
  `,
  styles: [
    `
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
      }
      .msg.user {
        align-self: flex-end;
        background: rgba(108, 92, 231, 0.12);
      }
      .composer {
        gap: var(--space-sm);
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
  protected readonly i18n = inject(I18nService);

  readonly question = input.required<Question>();
  readonly selected = input<readonly string[]>([]);
  readonly closed = output<void>();

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
        { name: pack.name, description: pack.description, domains: pack.domains },
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

  private scrollToEnd(): void {
    requestAnimationFrame(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
