import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { PacksService } from '../../core/services/packs.service';

/**
 * 10 highly distinct colors for domain badges, ordered so that the first 5
 * are maximally distinguishable from each other (for the common 4-5 domain case).
 */
const POSITIONAL_COLORS = [
  '#2563eb', // blue
  '#dc2626', // red
  '#059669', // emerald
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#be185d', // pink
  '#4d7c0f', // lime-dark
  '#9333ea', // purple
  '#ea580c', // orange
];

/** Fallback palette for domains beyond position 10 (hash-based). */
const HASH_PALETTE = [
  '#6366f1', '#14b8a6', '#f43f5e', '#8b5cf6', '#f59e0b',
  '#06b6d4', '#ec4899', '#10b981', '#ef4444', '#a855f7',
];

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
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
        padding: 3px var(--space-md);
        border-radius: var(--radius-lg);
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
  private readonly packs = inject(PacksService);

  readonly domain = input.required<string>();

  readonly label = computed(() => this.domain());
  readonly background = computed(() => {
    const domainName = this.domain();
    const domains = this.packs.activeDomains();
    const idx = domains.findIndex((d) => d.name === domainName);
    if (idx >= 0 && idx < POSITIONAL_COLORS.length) {
      return POSITIONAL_COLORS[idx];
    }
    // Fallback: hash-based color for domains beyond position 10 or not in pack list
    return HASH_PALETTE[hash(domainName.toLowerCase()) % HASH_PALETTE.length];
  });

  readonly textColor = '#ffffff';
}
