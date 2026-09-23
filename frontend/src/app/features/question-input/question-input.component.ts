import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BedrockService } from '../../core/services/bedrock.service';
import { ModelsService } from '../../core/services/models.service';
import { PacksService } from '../../core/services/packs.service';
import { QuestionEnrichmentService } from '../../core/services/question-enrichment.service';
import { QuestionsService } from '../../core/services/questions.service';
import { SettingsService } from '../../core/services/settings.service';
import { DEFAULT_DOMAIN, ReviewMode, outputLanguageLabel } from '../../core/models/settings.model';
import { Question } from '../../core/models/question.model';
import {
  parseDomainFromResponse,
  parseTitleFromResponse,
  stripInferredMetadata,
} from '../../core/utils/domain-inference.util';
import { parseQuestionReview } from '../../core/utils/question-parse.util';
import { parseReadyMadePaste } from '../../core/utils/ready-made-parse.util';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { ImageUploadHelperComponent } from '../../shared/components/image-upload-helper.component';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-question-input',
  standalone: true,
  imports: [FormsModule, AiDisclaimerComponent, ImageUploadHelperComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="input-card">
      <header class="card-header">
        <h2>{{ i18n.t('questionInput.newQuestion') }}</h2>
        <p class="subtitle">
          @if (activeView() === 'generate') {
            {{ i18n.t('questionInput.subtitleGenerate') }}
          } @else {
            {{ i18n.t('questionInput.subtitleManual') }}
          }
        </p>
      </header>

      <div class="mode-toggle" role="tablist" [attr.aria-label]="i18n.t('questionInput.reviewMode')">
        <button
          type="button"
          class="mode-btn"
          [class.active]="activeView() === 'generate'"
          (click)="onSetMode('generate')"
          [disabled]="streaming() || savingManual()"
          role="tab"
          [attr.aria-selected]="activeView() === 'generate'"
        >{{ i18n.t('settings.generateWithAi') }}</button>
        <button
          type="button"
          class="mode-btn"
          [class.active]="activeView() === 'manual'"
          (click)="onSetMode('manual')"
          [disabled]="streaming() || savingManual()"
          role="tab"
          [attr.aria-selected]="activeView() === 'manual'"
        >{{ i18n.t('questionInput.addReadyMade') }}</button>
      </div>

      @if (activeView() === 'generate') {
        <label class="textarea-wrap">
          <span class="visually-hidden">{{ i18n.t('questionInput.questionText') }}</span>
          <textarea
            [(ngModel)]="draft"
            [disabled]="streaming() || finalizing()"
            rows="8"
            [placeholder]="i18n.t('questionInput.draftPlaceholder')"
            class="textarea"
          ></textarea>
        </label>
        @if (streaming() || finalizing()) {
          <div class="live-preview" aria-live="polite">
            <p class="live-preview-label">
              {{ finalizing() ? i18n.t('questionInput.structuring') : i18n.t('questionInput.generating') }}
            </p>
            <pre class="live-preview-body">{{ streamingPreview() }}</pre>
          </div>
        }
      }

      <div class="options-row">
        <label class="model-row">
          <span class="model-label">{{ i18n.t('questionInput.model') }}</span>
          <select
            class="model-select"
            [ngModel]="selectedModel()"
            (ngModelChange)="onSelectModel($event)"
            [disabled]="streaming() || finalizing() || savingManual() || generatingTitle()"
            [attr.aria-label]="i18n.t('questionInput.modelForGeneration')"
          >
            @for (model of availableModels(); track model.id) {
              <option [value]="model.id">{{ model.displayName }}{{ model.reasoning ? ' (' + i18n.t('settings.reasoning') + ')' : '' }} — {{ model.tier }}</option>
            }
          </select>
        </label>
      </div>

      @if (activeView() === 'generate') {
        @if (streaming()) {
          <button type="button" class="stop-btn" (click)="onStop()">
            <span class="stop-icon" aria-hidden="true"></span>
            <span>{{ i18n.t('questionInput.stop') }}</span>
          </button>
        } @else {
          <button
            type="button"
            class="generate-btn"
            (click)="onGenerate()"
            [disabled]="!canGenerate() || finalizing()"
          >
            <span>{{ finalizing() ? i18n.t('questionInput.processing') : i18n.t('questionInput.generateReview') }}</span>
          </button>
        }
      } @else {
        <label class="field">
          <span class="field-label">{{ i18n.t('questionInput.domain') }}</span>
          <select
            class="model-select"
            [ngModel]="selectedDomain()"
            (ngModelChange)="onSelectDomain($event)"
            [disabled]="savingManual()"
            [attr.aria-label]="i18n.t('questionInput.domainForReview')"
          >
            @for (d of domainOptions(); track d) {
              <option [value]="d">{{ d }}</option>
            }
          </select>
        </label>

        <label class="field">
          <span class="field-label">{{ i18n.t('questionInput.titleOptional') }}</span>
          <div class="title-row">
            <input
              type="text"
              class="title-input"
              [(ngModel)]="manualTitle"
              [disabled]="savingManual()"
              [placeholder]="i18n.t('questionInput.titlePlaceholder')"
              [attr.aria-label]="i18n.t('questionInput.reviewTitle')"
            />
            <button
              type="button"
              class="btn-ghost-sm"
              (click)="onGenerateTitle()"
              [disabled]="generatingTitle() || savingManual() || !manualReview.trim() || !!manualTitle.trim()"
            >
              {{ generatingTitle() ? i18n.t('questionInput.generating') : i18n.t('questionInput.generateTitle') }}
            </button>
          </div>
        </label>

        <label class="textarea-wrap">
          <div class="field-label-row">
            <span class="field-label">{{ i18n.t('questionInput.readyMadeReviewLabel') }}</span>
            <button
              type="button"
              class="btn-ghost-sm"
              (click)="onAutofillFromPaste()"
              [disabled]="savingManual() || !manualReview.trim()"
            >{{ i18n.t('questionInput.autofillTitleDomain') }}</button>
          </div>
          <textarea
            [(ngModel)]="manualReview"
            [disabled]="savingManual()"
            rows="10"
            [placeholder]="i18n.t('questionInput.manualReviewPlaceholder')"
            class="textarea"
          ></textarea>
        </label>

        <app-image-upload-helper />

        <button
          type="button"
          class="generate-btn"
          (click)="onSaveManual()"
          [disabled]="!manualReview.trim() || savingManual()"
        >
          <span>{{ savingManual() ? i18n.t('questionInput.saving') : i18n.t('questionInput.saveReview') }}</span>
        </button>
      }

      @if (activeView() === 'generate' && outputLanguage()) {
        <p class="lang-hint">{{ i18n.t('questionInput.outputLanguage', { name: outputLanguageName() }) }}</p>
      }

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      <app-ai-disclaimer
        [message]="i18n.t('questionInput.disclaimer')"
      />
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .input-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        padding: var(--space-lg);
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
      }
      .card-header h2 {
        font-size: var(--font-size-xl);
        margin-bottom: var(--space-xs);
      }
      .subtitle {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
      }
      .warning {
        background: var(--bg-elevated);
        color: var(--color-amber);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-amber);
        font-size: var(--font-size-sm);
      }
      .options-row {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .model-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .model-label {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .model-select {
        flex: 1;
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
      .search-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        cursor: pointer;
      }
      .search-toggle input[type='checkbox'] {
        accent-color: var(--color-purple);
      }
      .textarea-wrap {
        display: block;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
      }
      .textarea {
        width: 100%;
        min-height: 180px;
        padding: var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-family: var(--font-family);
        font-size: var(--font-size-base);
        line-height: 1.55;
        resize: vertical;
        transition: border-color var(--transition-fast);
      }
      .textarea:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .textarea:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .live-preview {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
        padding: var(--space-md);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
      }
      .live-preview-label {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        margin: 0;
      }
      .live-preview-body {
        max-height: 220px;
        overflow-y: auto;
        margin: 0;
        white-space: pre-wrap;
        font-family: var(--font-family);
        font-size: var(--font-size-sm);
        line-height: 1.55;
        color: var(--text-secondary);
      }
      .generate-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-sm);
        width: 100%;
        min-height: 48px;
        padding: 0 var(--space-lg);
        border-radius: var(--radius-md);
        background: linear-gradient(135deg, var(--color-purple), var(--color-blue));
        color: #ffffff;
        font-weight: 600;
        font-size: var(--font-size-lg);
        transition: filter var(--transition-fast);
      }
      .generate-btn:hover:not(:disabled) {
        filter: brightness(1.08);
      }
      .generate-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .stop-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-sm);
        width: 100%;
        min-height: 48px;
        padding: 0 var(--space-lg);
        border-radius: var(--radius-md);
        background: var(--color-red);
        color: #ffffff;
        font-weight: 600;
        font-size: var(--font-size-lg);
        transition: filter var(--transition-fast);
      }
      .stop-btn:hover {
        filter: brightness(1.1);
      }
      .stop-icon {
        width: 14px;
        height: 14px;
        background: #ffffff;
        border-radius: 3px;
      }
      .lang-hint {
        font-size: var(--font-size-sm);
        color: var(--text-faint);
      }
      .error {
        color: var(--color-red);
        font-size: var(--font-size-sm);
      }
      .mode-toggle {
        display: flex;
        gap: 2px;
        padding: 3px;
        background: var(--bg-elevated);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
      }
      .mode-btn {
        flex: 1;
        min-height: 34px;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        font-weight: 600;
      }
      .mode-btn.active {
        background: var(--bg-surface);
        color: var(--color-purple);
        box-shadow: var(--shadow-sm);
      }
      .mode-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .field-label {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .field-label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
        margin-bottom: var(--space-xs);
      }
      .title-row {
        display: flex;
        gap: var(--space-sm);
        align-items: stretch;
      }
      .title-input {
        flex: 1;
        min-width: 0;
        min-height: 36px;
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-base);
      }
      .title-input:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .title-input:disabled {
        opacity: 0.6;
      }
      .btn-ghost-sm {
        flex-shrink: 0;
        padding: 0 var(--space-md);
        min-height: 36px;
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        font-weight: 500;
      }
      .btn-ghost-sm:hover:not(:disabled) {
        border-color: var(--color-purple);
        color: var(--text-primary);
      }
      .btn-ghost-sm:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
})
export class QuestionInputComponent {
  private readonly bedrock = inject(BedrockService);
  private readonly settings = inject(SettingsService);
  private readonly questionsService = inject(QuestionsService);
  private readonly modelsService = inject(ModelsService);
  private readonly packs = inject(PacksService);
  private readonly enrichment = inject(QuestionEnrichmentService);
  protected readonly i18n = inject(I18nService);

  protected readonly outputLanguage = this.settings.outputLanguage;
  protected readonly outputLanguageName = computed(() => outputLanguageLabel(this.outputLanguage()));
  protected readonly streaming = signal(false);
  protected readonly finalizing = signal(false);
  protected readonly streamingPreview = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly modelOverride = signal<string | null>(null);
  protected draft = '';
  private streamController: AbortController | null = null;

  private readonly modeOverride = signal<ReviewMode | null>(null);
  readonly mode = computed(() => this.modeOverride() ?? this.settings.defaultReviewMode());
  readonly activeView = this.mode;

  protected readonly generatingTitle = signal(false);
  protected readonly savingManual = signal(false);
  protected manualReview = '';
  protected manualTitle = '';
  private readonly domainOverride = signal<string | null>(null);

  readonly domainOptions = computed(() => {
    const defined = this.packs.activeDomains().map((d) => d.name);
    return defined.length > 0 ? defined : [DEFAULT_DOMAIN];
  });
  readonly selectedDomain = computed(
    () => this.domainOverride() ?? this.domainOptions()[0] ?? DEFAULT_DOMAIN,
  );

  readonly canGenerate = computed(() => !this.streaming());
  readonly availableModels = this.modelsService.models;
  readonly selectedModel = computed(
    () => this.modelOverride() ?? this.modelsService.resolveModel(this.settings.defaultModel()),
  );

  readonly generated = output<Question>();

  onSelectModel(value: string): void {
    this.modelOverride.set(value);
  }

  onSetMode(mode: ReviewMode): void {
    this.modeOverride.set(mode);
    this.error.set(null);
  }

  onSelectDomain(value: string): void {
    this.domainOverride.set(value);
  }

  onAutofillFromPaste(): void {
    const source = this.manualReview;
    if (!source.trim()) return;

    const { title, domain, remainder } = parseReadyMadePaste(source, this.domainOptions());
    if (!title && !domain) {
      this.error.set(this.i18n.t('questionInput.couldNotDetectTitleOrDomain'));
      return;
    }

    if (title) this.manualTitle = title;
    if (domain) this.domainOverride.set(domain);
    this.manualReview = remainder;
    this.error.set(null);
  }

  async onGenerateTitle(): Promise<void> {
    const source = this.manualReview.trim();
    if (!source) {
      this.error.set(this.i18n.t('questionInput.pasteReviewFirst'));
      return;
    }
    const controller = new AbortController();
    this.generatingTitle.set(true);
    this.error.set(null);
    try {
      const title = await this.bedrock.generateTitle(
        source,
        this.selectedModel(),
        controller.signal,
        this.settings.outputLanguage(),
      );
      if (title) this.manualTitle = title;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : this.i18n.t('questionInput.failedToGenerateTitle'));
    } finally {
      this.generatingTitle.set(false);
    }
  }

  /** Parses raw review Markdown into a saveable Question, enriching it with related services. */
  private async buildQuestion(
    review: string,
    title: string,
    domain: string,
    packId: string,
  ): Promise<Question | null> {
    const parsed = parseQuestionReview(review);
    if (!parsed) return null;

    const relatedServices = await this.enrichment.extractRelatedServices(parsed.stem, parsed.alternatives);
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      packId,
      title,
      domain,
      stem: parsed.stem,
      alternatives: parsed.alternatives,
      metadata: { topics: parsed.topics, relatedServices },
      createdAt: now,
      updatedAt: now,
      generalComment: parsed.generalComment ?? undefined,
    };
  }

  async onSaveManual(): Promise<void> {
    const review = this.manualReview.trim();
    if (!review) {
      this.error.set(this.i18n.t('questionInput.reviewTextEmpty'));
      return;
    }
    this.savingManual.set(true);
    this.error.set(null);

    const activePack = this.packs.activePack();
    const fallbackTitle = review.slice(0, 80).replace(/\s+/g, ' ').trim();
    let title = this.manualTitle.trim();

    try {
      if (!title) {
        const controller = new AbortController();
        try {
          title = await this.bedrock.generateTitle(
            review,
            this.selectedModel(),
            controller.signal,
            this.settings.outputLanguage(),
          );
        } catch {
          title = '';
        }
      }

      const question = await this.buildQuestion(review, title || fallbackTitle, this.selectedDomain(), activePack.id);
      if (!question) {
        this.error.set(this.i18n.t('questionInput.couldNotParseManual'));
        return;
      }

      this.questionsService.add(question);
      this.generated.emit(question);
      this.settings.setDefaultReviewMode('manual');

      // Reset manual fields
      this.manualReview = '';
      this.manualTitle = '';
      this.domainOverride.set(null);
      this.modelOverride.set(null);
    } finally {
      this.savingManual.set(false);
    }
  }

  async onGenerate(): Promise<void> {
    const text = this.draft.trim();
    if (!text) {
      this.error.set(this.i18n.t('questionInput.questionTextEmpty'));
      return;
    }

    const activePack = this.packs.activePack();
    const packContext = { name: activePack.name, description: activePack.description, domains: activePack.domains };
    const domains = activePack.domains.map((d) => d.name);
    const fallbackTitle = text.slice(0, 80).replace(/\s+/g, ' ').trim();

    const controller = new AbortController();
    this.streamController = controller;
    this.streaming.set(true);
    this.streamingPreview.set('');
    this.error.set(null);

    let accumulated = '';
    try {
      for await (const chunk of this.bedrock.streamReview(
        text,
        packContext,
        this.selectedModel(),
        controller.signal,
        this.settings.outputLanguage(),
      )) {
        accumulated += chunk;
        this.streamingPreview.set(accumulated);
      }

      this.streaming.set(false);
      this.finalizing.set(true);

      const domain = parseDomainFromResponse(accumulated, domains);
      const title = parseTitleFromResponse(accumulated, fallbackTitle);
      const review = stripInferredMetadata(accumulated);
      const question = await this.buildQuestion(review, title, domain, activePack.id);
      if (!question) {
        this.error.set(this.i18n.t('questionInput.couldNotParseGenerated'));
        return;
      }

      this.questionsService.add(question);
      this.draft = '';
      this.generated.emit(question);
      this.settings.setDefaultReviewMode('generate');
      this.modelOverride.set(null);
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError' || controller.signal.aborted;
      if (!aborted) {
        this.error.set(err instanceof Error ? err.message : this.i18n.t('questionInput.failedToGenerateReview'));
      }
    } finally {
      this.streaming.set(false);
      this.finalizing.set(false);
      this.streamingPreview.set('');
      this.streamController = null;
    }
  }

  onStop(): void {
    this.streamController?.abort();
  }
}
