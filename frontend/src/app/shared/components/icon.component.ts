import { ChangeDetectionStrategy, Component, computed, input, numberAttribute } from '@angular/core';

/**
 * The only way the app draws icons: outline SVGs on a 24x24 grid, 2px
 * stroke, `currentColor`, in the style of the Lucide icon set (paths drawn
 * for this project, no icon font or extra dependency). Emojis and Unicode
 * pictographs (✦ ✓ ✕ ★ ⏱ …) are never used as icons; see
 * .kiro/steering/ui-icons.md. Add a new icon to ICONS, then use it as
 * `<app-icon name="…" />`.
 */
export const ICONS = {
  'arrow-down': ['M12 5v14', 'm19 12-7 7-7-7'],
  'arrow-left': ['M19 12H5', 'm12 19-7-7 7-7'],
  'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
  'arrow-up': ['M12 19V5', 'm5 12 7-7 7 7'],
  award: ['M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M8.21 13.89 7 23l5-3 5 3-1.21-9.12'],
  'book-open': ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
  braces: [
    'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1',
    'M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1',
  ],
  check: ['M20 6 9 17l-5-5'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  copy: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2'],
  'circle-dollar': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8', 'M12 18V6'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  'external-link': ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  'file-text': [
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z',
    'M14 2v4a2 2 0 0 0 2 2h4',
    'M16 13H8',
    'M16 17H8',
    'M10 9H8',
  ],
  flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5'],
  image: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'm21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21',
  ],
  layers: ['m12 2 10 5-10 5L2 7z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'],
  link: [
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  'list-checks': ['m3 17 2 2 4-4', 'm3 7 2 2 4-4', 'M13 6h8', 'M13 12h8', 'M13 18h8'],
  'list-ordered': ['M10 6h11', 'M10 12h11', 'M10 18h11', 'M4 6h1v4', 'M4 10h2', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'],
  minus: ['M5 12h14'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z'],
  'more-vertical': [
    'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    'M12 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    'M12 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  ],
  pencil: ['M4 20h4L19 9l-4-4L4 16v4z', 'm13.5 6.5 4 4'],
  plus: ['M5 12h14', 'M12 5v14'],
  quote: ['M10 7H5v5h5V7zm0 5c0 3-1.5 5-4 6', 'M19 7h-5v5h5V7zm0 5c0 3-1.5 5-4 6'],
  'rotate-ccw': ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  sparkles: [
    'M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z',
    'M20 3v4',
    'M22 5h-4',
  ],
  star: ['M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z'],
  sun: [
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M12 2v2',
    'M12 20v2',
    'm4.93 4.93 1.41 1.41',
    'm17.66 17.66 1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'm6.34 17.66-1.41 1.41',
    'm19.07 4.93-1.41 1.41',
  ],
  tag: [
    'M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z',
    'M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  ],
  target: [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
    'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  ],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  trophy: [
    'M6 9H4.5a2.5 2.5 0 0 1 0-5H6',
    'M18 9h1.5a2.5 2.5 0 0 0 0-5H18',
    'M4 22h16',
    'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22',
    'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22',
    'M18 2H6v7a6 6 0 0 0 12 0V2z',
  ],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  'zoom-in': ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.35-4.35', 'M11 8v6', 'M8 11h6'],
  'zoom-out': ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.35-4.35', 'M8 11h6'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

/** Decorative by default (aria-hidden); the surrounding button or label carries the accessible name. */
@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" aria-hidden="true" focusable="false">
      @for (d of paths(); track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex-shrink: 0;
        line-height: 0;
        vertical-align: -0.15em;
      }
      svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
    `,
  ],
})
export class IconComponent {
  readonly name = input.required<IconName>();
  /** Pixels; accepts the plain attribute form `size="14"`. */
  readonly size = input(16, { transform: numberAttribute });
  protected readonly paths = computed(() => ICONS[this.name()]);
}
