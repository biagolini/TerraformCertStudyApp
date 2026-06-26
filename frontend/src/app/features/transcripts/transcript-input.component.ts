import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Script, fullScriptTitle } from '../../core/models/script.model';
import { BedrockService } from '../../core/services/bedrock.service';
import { ModelsService } from '../../core/services/models.service';
import { ScriptsService } from '../../core/services/scripts.service';
import { SettingsService } from '../../core/services/settings.service';
import {
  parseTitleFromResponse,
  stripInferredMetadata,
} from '../../core/utils/domain-inference.util';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';

@Component({
  selector: 'app-transcript-input',
  standalone: true,
  imports: [FormsModule, AiDisclaimerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="input-card">
      <header class="card-header">
        <h2>New transcript script</h2>
        <p class="subtitle">Paste one or more lesson transcripts. The AI produces a single layered technical summary covering all of them, from foundational to advanced.</p>
      </header>

      <div class="transcripts">
        @for (transcript of transcripts(); track $index; let i = $index) {
          <div class="transcript-block">
            <div class="transcript-head">
              <label class="transcript-label">Aula {{ i + 1 }}</label>
              @if (transcripts().length > 1) {
                <button
                  type="button"
                  class="remove-btn"
                  (click)="onRemove(i)"
                  [attr.aria-label]="'Remove transcript ' + (i + 1)"
                  [disabled]="streaming()"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5 5l14 14M19 5L5 19"/>
                  </svg>
                </button>
              }
            </div>
            <textarea
              class="textarea"
              rows="6"
              [ngModel]="transcript"
              (ngModelChange)="onChange(i, $event)"
              [disabled]="streaming()"
              placeholder="Paste the transcript of this lesson..."
              [attr.aria-label]="'Transcript ' + (i + 1)"
            ></textarea>
          </div>
        }
      </div>

      <button
        type="button"
        class="add-btn"
        (click)="onAddTranscript()"
        [disabled]="streaming()"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/>
        </svg>
        <span>Add another transcript</span>
      </button>

      <div class="options-row">
        <label class="model-row">
          <span class="model-label">Model</span>
          <select
            class="model-select"
            [ngModel]="selectedModel()"
            (ngModelChange)="onSelectModel($event)"
            [disabled]="streaming()"
            aria-label="Model for this generation"
          >
            @for (model of availableModels(); track model.id) {
              <option [value]="model.id">{{ model.displayName }}{{ model.reasoning ? ' (reasoning)' : '' }} — {{ model.tier }}</option>
            }
          </select>
        </label>
      </div>

      @if (streaming()) {
        <button type="button" class="stop-btn" (click)="onStop()">
          <span class="stop-icon" aria-hidden="true"></span>
          <span>Stop</span>
        </button>
      } @else {
        <button
          type="button"
          class="generate-btn"
          (click)="onGenerate()"
          [disabled]="!canGenerate()"
        >
          Generate technical summary
        </button>
      }

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      <app-ai-disclaimer
        message="Generated summaries are produced by AI from the transcripts you provide and can contain mistakes. Review the content before treating it as authoritative."
      />
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .input-card {
        display: flex; flex-direction: column; gap: var(--space-md);
        padding: var(--space-lg);
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
      }
      .card-header h2 { font-size: var(--font-size-xl); margin-bottom: var(--space-xs); }
      .subtitle { color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; }
      .warning {
        background: var(--bg-elevated);
        color: var(--color-amber);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-amber);
        font-size: var(--font-size-sm);
      }
      .transcripts { display: flex; flex-direction: column; gap: var(--space-md); }
      .transcript-block { display: flex; flex-direction: column; gap: var(--space-xs); }
      .transcript-head { display: flex; align-items: center; justify-content: space-between; }
      .transcript-label { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); }
      .remove-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px;
        border-radius: var(--radius-md);
        color: var(--text-muted);
      }
      .remove-btn:hover:not(:disabled) { background: var(--bg-subtle); color: var(--color-red); }
      .remove-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .textarea {
        width: 100%; min-height: 140px;
        padding: var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-family: var(--font-family);
        font-size: var(--font-size-base);
        line-height: 1.55;
        resize: vertical;
      }
      .textarea:focus-visible { outline: none; border-color: var(--color-purple); }
      .textarea:disabled { opacity: 0.6; cursor: not-allowed; }
      .add-btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: var(--space-xs);
        min-height: var(--touch-min);
        border-radius: var(--radius-md);
        border: 1px dashed var(--bg-border);
        color: var(--text-secondary);
        background: transparent;
      }
      .add-btn:hover:not(:disabled) {
        border-color: var(--color-purple);
        color: var(--color-purple);
        background: var(--bg-subtle);
      }
      .add-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .options-row { display: flex; flex-direction: column; gap: var(--space-sm); }
      .model-row { display: flex; align-items: center; gap: var(--space-sm); }
      .model-label { font-size: var(--font-size-sm); color: var(--text-muted); }
      .model-select {
        flex: 1; min-height: 36px;
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
      }
      .model-select:focus-visible { outline: none; border-color: var(--color-purple); }
      .search-toggle {
        display: inline-flex; align-items: center; gap: var(--space-xs);
        font-size: var(--font-size-sm); color: var(--text-secondary); cursor: pointer;
      }
      .search-toggle input[type='checkbox'] { accent-color: var(--color-purple); }
      .generate-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: var(--space-sm);
        width: 100%; min-height: 48px;
        padding: 0 var(--space-lg);
        border-radius: var(--radius-md);
        background: linear-gradient(135deg, var(--color-purple), var(--color-blue));
        color: #ffffff; font-weight: 600; font-size: var(--font-size-lg);
        transition: filter var(--transition-fast);
      }
      .generate-btn:hover:not(:disabled) { filter: brightness(1.08); }
      .generate-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .stop-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: var(--space-sm);
        width: 100%; min-height: 48px;
        padding: 0 var(--space-lg);
        border-radius: var(--radius-md);
        background: var(--color-red);
        color: #ffffff; font-weight: 600; font-size: var(--font-size-lg);
      }
      .stop-btn:hover { filter: brightness(1.1); }
      .stop-icon { width: 14px; height: 14px; background: #ffffff; border-radius: 3px; }
      .error { color: var(--color-red); font-size: var(--font-size-sm); }
    `,
  ],
})
export class TranscriptInputComponent {
  private readonly bedrock = inject(BedrockService);
  private readonly settings = inject(SettingsService);
  private readonly modelsService = inject(ModelsService);
  private readonly scripts = inject(ScriptsService);

  protected readonly transcripts = signal<string[]>(['']);
  protected readonly streaming = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly modelOverride = signal<string | null>(null);
  private streamController: AbortController | null = null;

  readonly availableModels = this.modelsService.models;
  readonly selectedModel = computed(
    () => this.modelOverride() ?? this.modelsService.resolveModel(this.settings.defaultModel()),
  );
  readonly canGenerate = computed(
    () => !this.streaming() && this.hasAtLeastOneTranscript(),
  );

  readonly generated = output<Script>();

  private hasAtLeastOneTranscript(): boolean {
    return this.transcripts().some((t) => t.trim().length > 0);
  }

  onChange(index: number, value: string): void {
    const next = [...this.transcripts()];
    next[index] = value;
    this.transcripts.set(next);
  }

  onAddTranscript(): void {
    this.transcripts.set([...this.transcripts(), '']);
  }

  onRemove(index: number): void {
    const next = this.transcripts().filter((_, i) => i !== index);
    this.transcripts.set(next.length === 0 ? [''] : next);
  }

  onSelectModel(value: string): void {
    this.modelOverride.set(value);
  }

  onStop(): void {
    this.streamController?.abort();
  }

  async onGenerate(): Promise<void> {
    const sources = this.transcripts()
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (sources.length === 0) {
      this.error.set('Add at least one transcript.');
      return;
    }

    const controller = new AbortController();
    this.streamController = controller;
    this.streaming.set(true);
    this.error.set(null);

    let script: Script | null = null;
    let accumulated = '';
    try {
      for await (const chunk of this.bedrock.streamTranscriptScript(
        sources,
        this.selectedModel(),
        controller.signal,
        this.settings.outputLanguage(),
      )) {
        accumulated += chunk;
        if (!script) {
          script = {
            id: crypto.randomUUID(),
            title: 'Resumo técnico',
            content: chunk,
            sources: [...sources],
            createdAt: Date.now(),
          };
          this.scripts.add(script);
          this.transcripts.set(['']);
          this.generated.emit(script);
        } else {
          this.scripts.appendToContent(script.id, chunk);
        }
      }

      if (script) {
        const inferred = parseTitleFromResponse(accumulated, '');
        const finalTitle = fullScriptTitle(inferred);
        const finalContent = stripInferredMetadata(accumulated);
        this.scripts.updatePartial(script.id, { title: finalTitle, content: finalContent });
      }
      this.modelOverride.set(null);
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError' || controller.signal.aborted;
      if (script) {
        const inferred = parseTitleFromResponse(accumulated, '');
        const finalTitle = fullScriptTitle(inferred);
        const finalContent = stripInferredMetadata(accumulated);
        this.scripts.updatePartial(script.id, { title: finalTitle, content: finalContent });
        if (!aborted) {
          this.error.set(err instanceof Error ? err.message : 'Failed to generate summary.');
        }
      } else if (!aborted) {
        this.error.set(err instanceof Error ? err.message : 'Failed to generate summary.');
      }
    } finally {
      this.streaming.set(false);
      this.streamController = null;
    }
  }
}
