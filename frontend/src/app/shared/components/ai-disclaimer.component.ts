import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const DEFAULT_MESSAGE =
  'AI can produce inaccurate or fabricated information. Always verify against official sources before relying on it.';

@Component({
  selector: 'app-ai-disclaimer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="disclaimer" [class.tight]="tight()">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M12 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        <circle cx="12" cy="8" r="1" fill="currentColor" />
      </svg>
      <span>{{ text() }}</span>
    </p>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .disclaimer {
        display: flex;
        align-items: flex-start;
        gap: var(--space-xs);
        font-size: var(--font-size-xs);
        color: var(--text-faint);
        line-height: 1.5;
      }
      .disclaimer.tight {
        font-size: 10px;
        gap: 4px;
      }
      .disclaimer svg {
        flex-shrink: 0;
        margin-top: 2px;
        opacity: 0.8;
      }
    `,
  ],
})
export class AiDisclaimerComponent {
  readonly message = input<string | null>(null);
  readonly tight = input<boolean>(false);

  readonly text = computed(() => this.message() ?? DEFAULT_MESSAGE);
}
