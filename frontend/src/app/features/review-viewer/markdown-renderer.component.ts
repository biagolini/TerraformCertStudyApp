import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ImageAssetService } from '../../core/services/image-asset.service';
import { LightboxService } from '../../core/services/lightbox.service';

type InlineSegment =
  | { kind: 'text' | 'bold' | 'italic' | 'code'; value: string }
  | { kind: 'link'; value: string; href: string }
  | { kind: 'img'; alt: string; ref: string };

interface ListItem {
  inline: InlineSegment[];
  /** null = plain bullet, true/false = task-list checkbox. */
  checked: boolean | null;
}

type Block =
  | { kind: 'h2' | 'h3'; inline: InlineSegment[] }
  | { kind: 'hr' }
  | { kind: 'p'; inline: InlineSegment[]; muted: boolean }
  | { kind: 'ul' | 'ol'; items: ListItem[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; lines: InlineSegment[][] }
  | { kind: 'table'; header: InlineSegment[][]; rows: InlineSegment[][][] };

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
              <button type="button" class="md-img-btn" (click)="lightbox.open(state, seg.alt)" [attr.aria-label]="seg.alt || 'Open image'">
                <img class="md-img" [src]="state" [alt]="seg.alt" />
              </button>
            }
          }
        } @else if (seg.kind === 'link') {
          <a class="md-link" [href]="seg.href" target="_blank" rel="noopener noreferrer">{{ seg.value }}</a>
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
                <li [class.task]="item.checked !== null">
                  @if (item.checked !== null) {
                    <input type="checkbox" [checked]="item.checked" disabled aria-hidden="true" />
                  }
                  <ng-container *ngTemplateOutlet="inline; context: { $implicit: item.inline }" />
                </li>
              }
            </ul>
          }
          @case ('ol') {
            <ol class="md-ol">
              @for (item of asList(block).items; track $index) {
                <li>
                  <ng-container *ngTemplateOutlet="inline; context: { $implicit: item.inline }" />
                </li>
              }
            </ol>
          }
          @case ('code') {
            <pre class="md-pre"><code>{{ asCode(block) }}</code></pre>
          }
          @case ('quote') {
            <blockquote class="md-quote">
              @for (line of asQuote(block); track $index) {
                <p><ng-container *ngTemplateOutlet="inline; context: { $implicit: line }" /></p>
              }
            </blockquote>
          }
          @case ('table') {
            <div class="md-table-wrap">
              <table class="md-table">
                <thead>
                  <tr>
                    @for (cell of asTable(block).header; track $index) {
                      <th><ng-container *ngTemplateOutlet="inline; context: { $implicit: cell }" /></th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of asTable(block).rows; track $index) {
                    <tr>
                      @for (cell of row; track $index) {
                        <td><ng-container *ngTemplateOutlet="inline; context: { $implicit: cell }" /></td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
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
      .md-ol {
        padding-left: var(--space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .md-ol li {
        list-style: decimal;
      }
      .md-ul li.task {
        list-style: none;
        margin-left: calc(-1 * var(--space-md));
      }
      .md-ul li.task input {
        margin-right: 6px;
      }
      .md-pre {
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: var(--space-sm) var(--space-md);
        overflow-x: auto;
        font-size: 0.9em;
        line-height: 1.5;
      }
      .md-pre code {
        background: none;
        padding: 0;
        white-space: pre;
      }
      .md-quote {
        border-left: 3px solid var(--pack-color, var(--color-purple));
        background: var(--pack-color-soft, rgba(108, 92, 231, 0.08));
        border-radius: 0 var(--radius-md) var(--radius-md) 0;
        padding: var(--space-sm) var(--space-md);
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .md-table-wrap {
        overflow-x: auto;
      }
      .md-table {
        border-collapse: collapse;
        width: 100%;
        font-size: 0.95em;
      }
      .md-table th,
      .md-table td {
        border: 1px solid var(--bg-border);
        padding: 6px 10px;
        text-align: left;
        vertical-align: top;
      }
      .md-table th {
        background: var(--bg-elevated);
        font-weight: 700;
      }
      .md-link {
        color: var(--color-blue);
        text-decoration: underline;
        word-break: break-word;
      }
      .md-img-btn {
        display: block;
        padding: 0;
        border: 0;
        background: none;
        cursor: zoom-in;
        max-width: 100%;
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
  protected readonly lightbox = inject(LightboxService);

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
  asList(block: Block): { items: ListItem[] } {
    return block.kind === 'ul' || block.kind === 'ol' ? { items: block.items } : { items: [] };
  }
  asCode(block: Block): string {
    return block.kind === 'code' ? block.text : '';
  }
  asQuote(block: Block): InlineSegment[][] {
    return block.kind === 'quote' ? block.lines : [];
  }
  asTable(block: Block): { header: InlineSegment[][]; rows: InlineSegment[][][] } {
    return block.kind === 'table' ? block : { header: [], rows: [] };
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
    else if (block.kind === 'ul' || block.kind === 'ol') block.items.forEach((item) => scan(item.inline));
    else if (block.kind === 'quote') block.lines.forEach(scan);
    else if (block.kind === 'table') [...block.header, ...block.rows.flat()].forEach(scan);
  }
  return refs;
}

const TASK_RE = /^\[( |x|X)\]\s+/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let list: { kind: 'ul' | 'ol'; items: ListItem[] } | null = null;
  let quote: InlineSegment[][] | null = null;

  const flush = () => {
    if (list && list.items.length > 0) blocks.push({ kind: list.kind, items: list.items });
    if (quote && quote.length > 0) blocks.push({ kind: 'quote', lines: quote });
    list = null;
    quote = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, '  ');
    const trimmed = line.trim();

    // Fenced code block: everything verbatim up to the closing fence.
    if (trimmed.startsWith('```')) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (trimmed === '') {
      flush();
      continue;
    }
    // Table: a `| a | b |` row followed by a `|---|---|` separator.
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1].trim())) {
      flush();
      const header = splitRow(trimmed).map(parseInline);
      const rows: InlineSegment[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      i--;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    if (trimmed === '---' || /^[-*_]{3,}$/.test(trimmed)) {
      flush();
      blocks.push({ kind: 'hr' });
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      // Map: # and ## -> h2 (larger), ### and deeper -> h3 (smaller)
      const kind = level <= 2 ? 'h2' : 'h3';
      blocks.push({ kind, inline: parseInline(headingMatch[2]) });
      continue;
    }
    if (trimmed.startsWith('>')) {
      if (list) flush();
      if (!quote) quote = [];
      const text = trimmed.replace(/^>\s?/, '');
      if (text) quote.push(parseInline(text));
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || ordered) {
      const kind = bullet ? 'ul' : 'ol';
      if (quote || (list && list.kind !== kind)) flush();
      if (!list) list = { kind, items: [] };
      let text = (bullet ?? ordered)![1];
      let checked: boolean | null = null;
      const task = TASK_RE.exec(text);
      if (bullet && task) {
        checked = task[1].toLowerCase() === 'x';
        text = text.replace(TASK_RE, '');
      }
      list.items.push({ inline: parseInline(text), checked });
      continue;
    }

    flush();

    const muted = /^\*[\s\S]+\*$/.test(trimmed) && !/\*\*/.test(trimmed);
    blocks.push({ kind: 'p', inline: parseInline(trimmed), muted });
  }

  flush();
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
    if (text[i] === '[') {
      const labelEnd = text.indexOf(']', i + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const hrefEnd = text.indexOf(')', labelEnd + 2);
        const href = hrefEnd !== -1 ? text.slice(labelEnd + 2, hrefEnd).trim() : '';
        // Only absolute http(s) links become anchors; anything else (javascript:,
        // data:, relative) stays plain text.
        if (/^https?:\/\//i.test(href)) {
          flushText();
          segments.push({ kind: 'link', value: text.slice(i + 1, labelEnd), href });
          i = hrefEnd + 1;
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
