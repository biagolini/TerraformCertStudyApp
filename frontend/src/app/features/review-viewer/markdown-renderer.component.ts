import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ImageAssetService } from '../../core/services/image-asset.service';
import { LightboxService } from '../../core/services/lightbox.service';

export type InlineSegment =
  | { kind: 'text' | 'bold' | 'italic' | 'code'; value: string }
  | { kind: 'link'; value: string; href: string }
  | { kind: 'img'; alt: string; ref: string };

export interface ListItem {
  inline: InlineSegment[];
  /** null = plain bullet, true/false = task-list checkbox. */
  checked: boolean | null;
  /** Nesting depth, 0 for a top-level item (from the line's indentation). */
  level: number;
}

export type Block =
  /** `level` is the Markdown level (1–6); `kind` is only the compact visual size. */
  | { kind: 'h2' | 'h3'; level: number; inline: InlineSegment[] }
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
  host: { '[class.doc]': 'document()' },
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
            <h2 class="md-h2" [attr.data-level]="headingLevel(block)">
              <ng-container *ngTemplateOutlet="inline; context: { $implicit: asInline(block) }" />
            </h2>
          }
          @case ('h3') {
            <h3 class="md-h3" [attr.data-level]="headingLevel(block)">
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
                <li [class.task]="item.checked !== null" [attr.data-depth]="item.level || null">
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
                <li [attr.data-depth]="item.level || null">
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
      :host(.doc) [data-level] {
        scroll-margin-top: calc(var(--header-height) + 64px);
        line-height: 1.3;
        color: var(--text-primary);
      }
      :host(.doc) [data-level='1'] {
        margin-top: var(--space-lg);
        padding: var(--space-sm) var(--space-md);
        border-left: 6px solid var(--pack-color, var(--color-purple));
        border-radius: 0 var(--radius-md) var(--radius-md) 0;
        background: var(--pack-color-soft, rgba(108, 92, 231, 0.12));
        font-size: calc(var(--font-size-xl) + 4px);
        font-weight: 800;
      }
      :host(.doc) [data-level='2'] {
        margin-top: var(--space-md);
        padding: 0 0 var(--space-xs) var(--space-sm);
        border-left: 3px solid var(--pack-color, var(--color-purple));
        border-bottom: 1px solid var(--bg-border);
        font-size: var(--font-size-xl);
        font-weight: 700;
      }
      :host(.doc) [data-level='3'] {
        font-size: var(--font-size-lg);
        font-weight: 700;
        color: var(--pack-color, var(--color-purple));
      }
      :host(.doc) [data-level='4'],
      :host(.doc) [data-level='5'],
      :host(.doc) [data-level='6'] {
        font-size: var(--font-size-base);
        font-weight: 700;
        color: var(--text-secondary);
      }
      :host(.doc) .markdown > :first-child {
        margin-top: 0;
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
      .md-ul li[data-depth='1'],
      .md-ol li[data-depth='1'] {
        margin-left: var(--space-lg);
      }
      .md-ul li[data-depth='2'],
      .md-ol li[data-depth='2'] {
        margin-left: calc(var(--space-lg) * 2);
      }
      .md-ul li[data-depth='3'],
      .md-ol li[data-depth='3'] {
        margin-left: calc(var(--space-lg) * 3);
      }
      .md-ul li[data-depth='1'] {
        list-style: circle;
      }
      .md-ul li[data-depth='2'],
      .md-ul li[data-depth='3'] {
        list-style: square;
      }
      .md-ol li[data-depth] {
        list-style: lower-alpha;
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
  /** Long-document styling (study notes): every heading level gets its own
   * look, so H1/H2/H3 sections are easy to tell apart, and headings leave
   * room for the sticky header when scrolled to. */
  readonly document = input(false);

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
  headingLevel(block: Block): number | null {
    return block.kind === 'h2' || block.kind === 'h3' ? block.level : null;
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
const LIST_ITEM_RE = /^([-*+]|\d+[.)])\s+/;

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
  // Indentation of each open nesting level in the current list; an item's
  // level is its position here, so 2- and 4-space indents both nest by one.
  let indents: number[] = [];
  let quote: InlineSegment[][] | null = null;

  const flush = () => {
    if (list && list.items.length > 0) blocks.push({ kind: list.kind, items: list.items });
    indents = [];
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
      // A "loose" list has blank lines between its items; it stays one list
      // (keeping its nesting) when the next non-blank line is another item.
      let next = i + 1;
      while (next < lines.length && lines[next].trim() === '') next++;
      if (list && next < lines.length && LIST_ITEM_RE.test(lines[next].trim())) continue;
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
      blocks.push({ kind, level, inline: parseInline(headingMatch[2]) });
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
      const indent = line.length - line.trimStart().length;
      const nested = !!list && indents.length > 0 && indent > indents[0];
      // A nested item of the other kind stays inside the current list.
      if (quote || (list && list.kind !== kind && !nested)) flush();
      if (!list) list = { kind, items: [] };
      while (indents.length > 0 && indent < indents[indents.length - 1]) indents.pop();
      if (indents.length === 0 || indent > indents[indents.length - 1]) indents.push(indent);
      const level = Math.min(indents.length - 1, 3);
      let text = (bullet ?? ordered)![1];
      let checked: boolean | null = null;
      const task = TASK_RE.exec(text);
      if (bullet && task) {
        checked = task[1].toLowerCase() === 'x';
        text = text.replace(TASK_RE, '');
      }
      list.items.push({ inline: parseInline(text), checked, level });
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
