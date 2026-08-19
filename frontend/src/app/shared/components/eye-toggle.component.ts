import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-eye-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="eye"
      (click)="toggle.emit()"
      [attr.aria-label]="visible() ? 'Hide value' : 'Show value'"
      [attr.aria-pressed]="visible()"
    >
      @if (visible()) {
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12z"
          />
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
      } @else {
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 3l18 18M10.6 6.2A9.6 9.6 0 0112 6c6 0 9.5 7 9.5 7a16.4 16.4 0 01-3.2 4M6.3 7.8A16.6 16.6 0 002.5 13s3.5 7 9.5 7a9.8 9.8 0 004.4-1.1M9.9 9.9a3 3 0 104.2 4.2"
          />
        </svg>
      }
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .eye {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        border-radius: var(--radius-md);
        color: var(--text-muted);
        transition: color var(--transition-fast), background var(--transition-fast);
      }
      .eye:hover {
        color: var(--text-primary);
        background: var(--bg-subtle);
      }
    `,
  ],
})
export class EyeToggleComponent {
  readonly visible = input.required<boolean>();
  readonly toggle = output<void>();
}
