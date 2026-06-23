import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const PALETTE = [
  '--color-purple',
  '--color-blue',
  '--color-green',
  '--color-amber',
  '--color-red',
];

function hash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

@Component({
  selector: 'app-domain-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [style.background]="background()" [style.color]="textColor">
      {{ label() }}
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px var(--space-sm);
        border-radius: var(--radius-pill);
        font-size: var(--font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        line-height: 1.4;
        max-width: 100%;
        word-break: break-word;
        text-align: left;
      }
    `,
  ],
})
export class DomainBadgeComponent {
  readonly domain = input.required<string>();

  readonly label = computed(() => this.domain());
  readonly background = computed(() => {
    const token = PALETTE[hash(this.domain().toLowerCase()) % PALETTE.length];
    return `var(${token})`;
  });

  readonly textColor = '#ffffff';
}
