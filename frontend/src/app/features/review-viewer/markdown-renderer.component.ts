import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ImageAssetService } from '../../core/services/image-asset.service';

type InlineSegment =
  | { kind: 'text' | 'bold' | 'italic' | 'code'; value: string }
  | { kind: 'img'; alt: string; ref: string };

type Block =
  | { kind: 'h2' | 'h3'; inline: InlineSegment[] }
  | { kind: 'hr' }
  | { kind: 'p'; inline: InlineSegment[]; muted: boolean }
  | { kind: 'ul'; items: InlineSegment[][] };

@Component({
  selector: 'app-markdown-renderer',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #inline let-segments>
      @for (seg of segments; track $index) {
        @if (seg.kind === 'bold') {
          <strong>{{ seg.value }}</strong>
        } @else if (seg.kind === 'italic') {
          <em>{{ seg.value }}</em>
        } @else if (seg.kind === 'code') {
          <code>{{ seg.value }}</code>
        } @else if (seg.kind === 'img') {
          @if (imageAssets.resolve(seg.ref)(); as state) {
            @if (state === 'error') {
              <span class="md-img-error" [attr.title]="'Image failed to load: ' + seg.ref">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 16l4.5-6 3.5 4 3-3L20 16M4 5h16v14H4z"
                  />
                </svg>
                {{ seg.alt || 'Image unavailable' }}
              </span>
            } @else if (state !== 'pending') {
              <img class="md-img" [src]="state" [alt]="seg.alt" />
            }
          }
        } @else {
          <span>{{ seg.value }}</span>
        }
      }
    </ng-template>

    <div class="markdown">
      @for (block of blocks(); track $index) {
        @switch (block.kind) {
          @case ('h2') {
            <h2 class="md-h2">
              <ng-container *ngTemplateOutlet="inline; context: { $implicit: asInline(block) }" />
            </h2>
          }
          @case ('h3') {
            <h3 class="md-h3">
              <ng-container *ngTemplateOutlet="inline; context: { $implicit: asInline(block) }" />
            </h3>
          }
          @case ('hr') {
            <hr class="md-hr" />
          }
          @case ('p') {
            <p class="md-p" [class.muted]="asParagraph(block).muted">
              <ng-container *ngTemplateOutlet="inline; context: { $implicit: asParagraph(block).inline }" />
            </p>
          }
          @case ('ul') {
            <ul class="md-ul">
              @for (item of asList(block).items; track $index) {
                <li>
                  <ng-container *ngTemplateOutlet="inline; context: { $implicit: item }" />
                </li>
              }
            </ul>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .markdown {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        color: var(--text-primary);
        font-size: var(--font-size-base);
        line-height: 1.6;
      }
      .md-h2 {
        font-size: var(--font-size-xl);
        color: var(--text-primary);
        margin-top: var(--space-sm);
      }
      .md-h3 {
        font-size: var(--font-size-lg);
        color: var(--text-secondary);
        margin-top: var(--space-sm);
      }
      .md-hr {
        border: none;
        border-top: 1px solid var(--bg-border);
        margin: var(--space-sm) 0;
      }
      .md-p.muted {
        color: var(--text-muted);
        font-size: calc(var(--font-size-base) - 1px);
      }
      .md-ul {
        padding-left: var(--space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .md-ul li {
        list-style: disc;
        margin-left: 0;
        color: var(--text-primary);
      }
      strong {
        color: var(--text-primary);
        font-weight: 700;
      }
      .md-img {
        display: block;
        max-width: 100%;
        border-radius: var(--radius-md);
        margin: var(--space-xs) 0;
      }
      .md-img-error {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        margin: var(--space-xs) 0;
        padding: var(--space-xs) var(--space-sm);
        border: 1px dashed var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-muted);
        font-size: calc(var(--font-size-base) - 1px);
        font-style: italic;
      }
      em {
        font-style: italic;
      }
      code {
        background: var(--bg-elevated);
        padding: 1px 5px;
        border-radius: var(--radius-sm);
        font-family: monospace;
        font-size: 0.9em;
      }
    `,
  ],
})
export class MarkdownRendererComponent {
  protected readonly imageAssets = inject(ImageAssetService);

  readonly source = input.required<string>();

  readonly blocks = computed<Block[]>(() => parseMarkdown(this.source()));

  constructor() {
    // Triggers the actual presign fetch here, outside template rendering —
    // AuthService.getValidToken() synchronously writes a signal, and Angular
    // forbids signal writes while a template is being rendered (NG0600), so
    // this can't be done from the template's own `imageAssets.resolve()` call.
    effect(() => {
      for (const ref of collectImageRefs(this.blocks())) {
        this.imageAssets.ensureFetched(ref);
      }
    });
  }

  asInline(block: Block): InlineSegment[] {
    return block.kind === 'h2' || block.kind === 'h3' ? block.inline : [];
  }
  asParagraph(block: Block): { inline: InlineSegment[]; muted: boolean } {
    return block.kind === 'p' ? { inline: block.inline, muted: block.muted } : { inline: [], muted: false };
  }
  asList(block: Block): { items: InlineSegment[][] } {
    return block.kind === 'ul' ? { items: block.items } : { items: [] };
  }
}

function collectImageRefs(blocks: Block[]): string[] {
  const refs: string[] = [];
  const scan = (segments: InlineSegment[]) => {
    for (const seg of segments) {
      if (seg.kind === 'img') refs.push(seg.ref);
    }
  };
  for (const block of blocks) {
    if (block.kind === 'h2' || block.kind === 'h3' || block.kind === 'p') scan(block.inline);
    else if (block.kind === 'ul') block.items.forEach(scan);
  }
  return refs;
}

function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let listBuffer: InlineSegment[][] | null = null;

  const flushList = () => {
    if (listBuffer && listBuffer.length > 0) {
      blocks.push({ kind: 'ul', items: listBuffer });
    }
    listBuffer = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    const trimmed = line.trim();

    if (trimmed === '') {
      flushList();
      continue;
    }
    if (trimmed === '---' || /^[-*_]{3,}$/.test(trimmed)) {
      flushList();
      blocks.push({ kind: 'hr' });
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      // Map: # and ## -> h2 (larger), ### and deeper -> h3 (smaller)
      const kind = level <= 2 ? 'h2' : 'h3';
      blocks.push({ kind, inline: parseInline(headingMatch[2]) });
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (!listBuffer) listBuffer = [];
      listBuffer.push(parseInline(trimmed.replace(/^[-*]\s+/, '')));
      continue;
    }

    flushList();

    const muted = /^\*[\s\S]+\*$/.test(trimmed) && !/\*\*/.test(trimmed);
    blocks.push({ kind: 'p', inline: parseInline(trimmed), muted });
  }

  flushList();
  return blocks;
}

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let i = 0;
  let textBuffer = '';

  const flushText = () => {
    if (textBuffer) {
      segments.push({ kind: 'text', value: textBuffer });
      textBuffer = '';
    }
  };

  while (i < text.length) {
    if (text.startsWith('![', i)) {
      const altEnd = text.indexOf(']', i + 2);
      if (altEnd !== -1 && text[altEnd + 1] === '(') {
        const refEnd = text.indexOf(')', altEnd + 2);
        if (refEnd !== -1) {
          flushText();
          segments.push({
            kind: 'img',
            alt: text.slice(i + 2, altEnd),
            ref: text.slice(altEnd + 2, refEnd),
          });
          i = refEnd + 1;
          continue;
        }
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        flushText();
        segments.push({ kind: 'code', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        flushText();
        segments.push({ kind: 'bold', value: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1 && end !== i + 1) {
        flushText();
        segments.push({ kind: 'italic', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    textBuffer += text[i];
    i++;
  }

  flushText();
  return segments;
}
