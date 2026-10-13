import JSZip from 'jszip';
import { Block, InlineSegment, parseMarkdown } from '../review-viewer/markdown-renderer.component';
import { slugify } from '../../core/utils/file-splitter.util';

/** Downloads one stored image by its relative key (see ImageAssetService.download). */
export type ImageFetcher = (ref: string) => Promise<Blob>;

export interface ExportedFile {
  blob: Blob;
  filename: string;
}

// `![alt](ref)` where ref is a stored image key (`note/{noteId}/{file}` or a
// question image), not an external http(s) URL, which stays a plain link.
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Stored image keys referenced by a note body, in order, without duplicates. */
export function storedImageRefs(markdown: string): string[] {
  const refs: string[] = [];
  for (const match of markdown.matchAll(IMAGE_RE)) {
    const ref = match[2];
    if (!/^https?:\/\//i.test(ref) && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

/** File name each image gets inside the export's img/ folder: the stored name
 * without the upload's random prefix, made unique when two collide. */
export function imageFileNames(refs: string[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const ref of refs) {
    const base = (ref.split('/').pop() || 'image.png').replace(/^[0-9a-f]{8}-/, '');
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem}-${n}${ext}`;
    used.add(name.toLowerCase());
    names.set(ref, name);
  }
  return names;
}

/** The body with each stored image pointing at `img/<file>` instead. */
export function withLocalImagePaths(markdown: string, names: Map<string, string>): string {
  return markdown.replace(IMAGE_RE, (whole, alt: string, ref: string) => {
    const name = names.get(ref);
    return name ? `![${alt}](img/${name})` : whole;
  });
}

function baseName(title: string): string {
  return slugify(title) || 'note';
}

/** A note as Markdown: a plain `.md` when it has no images, otherwise a `.zip`
 * with the `.md` and an `img/` folder the Markdown points to. An image that
 * cannot be downloaded keeps its original reference. */
export async function exportNoteMarkdown(title: string, markdown: string, fetchImage: ImageFetcher): Promise<ExportedFile> {
  const name = baseName(title);
  const refs = storedImageRefs(markdown);
  if (refs.length === 0) {
    return { blob: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), filename: `${name}.md` };
  }
  const names = imageFileNames(refs);
  const zip = new JSZip();
  const images = zip.folder('img')!;
  const results = await Promise.allSettled(refs.map(async (ref) => images.file(names.get(ref)!, await fetchImage(ref))));
  results.forEach((r, i) => {
    if (r.status === 'rejected') names.delete(refs[i]);
  });
  zip.file(`${name}.md`, withLocalImagePaths(markdown, names));
  return { blob: await zip.generateAsync({ type: 'blob' }), filename: `${name}.zip` };
}

interface LoadedImage {
  data: ArrayBuffer;
  width: number;
  height: number;
}

/** Word look of an exported note: Word's built-in "Office" theme with green
 * banded headings (a solid band for Heading 1, a light band for Heading 2,
 * a thin rule for Headings 3 and 4, small caps throughout), Calibri body text
 * and gray code blocks. Values are Word's own units: sizes in half-points,
 * borders in eighths of a point, spacing in twentieths of a point. */
const WORD_STYLE = {
  font: 'Calibri',
  codeFont: 'Lucida Console',
  green: '549E39',
  greenLight: 'DBEFD3',
  greenDark: '294E1C',
  greenMid: '3E762A',
  codeFill: 'BFBFBF',
  textSize: 22,
};

/** Space after a paragraph or the last item of a list (twentieths of a point),
 * the blank line between blocks a Markdown reader expects. */
const PARAGRAPH_GAP = 200;

/** Word page body is about 6.3 in wide; images are scaled down to fit it. */
const MAX_IMAGE_WIDTH_PX = 600;

/** Re-encodes any image as PNG (Word does not take WebP) and reads its size. */
async function toPng(blob: Blob): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG conversion failed'))), 'image/png'),
  );
  const scale = Math.min(1, MAX_IMAGE_WIDTH_PX / bitmap.width);
  return { data: await png.arrayBuffer(), width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) };
}

/** A note as a Word document with its images embedded. The `docx` library is
 * loaded only here, on demand, so it stays out of the app's initial bundle. */
export async function exportNoteDocx(title: string, markdown: string, fetchImage: ImageFetcher): Promise<ExportedFile> {
  const docx = await import('docx');
  const { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph } = docx;
  const { ShadingType, Table, TableCell, TableRow, TextRun, WidthType } = docx;
  const W = WORD_STYLE;
  const box = (color: string, size: number) => {
    const side = { style: BorderStyle.SINGLE, size, color, space: 0 };
    return { top: side, left: side, bottom: side, right: side };
  };

  const images = new Map<string, LoadedImage>();
  await Promise.allSettled(
    storedImageRefs(markdown).map(async (ref) => images.set(ref, await toPng(await fetchImage(ref)))),
  );

  const HEADINGS = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];
  type Run = InstanceType<typeof TextRun> | InstanceType<typeof ImageRun> | InstanceType<typeof ExternalHyperlink>;

  const runs = (segments: InlineSegment[], extra: { bold?: boolean } = {}): Run[] =>
    segments.map((seg): Run => {
      switch (seg.kind) {
        case 'bold':
          return new TextRun({ text: seg.value, bold: true });
        case 'italic':
          return new TextRun({ text: seg.value, italics: true, ...extra });
        case 'code':
          return new TextRun({ text: seg.value, font: W.codeFont, ...extra });
        case 'link':
          return new ExternalHyperlink({ link: seg.href, children: [new TextRun({ text: seg.value, style: 'Hyperlink' })] });
        case 'img': {
          const img = images.get(seg.ref);
          return img
            ? new ImageRun({ type: 'png', data: img.data, transformation: { width: img.width, height: img.height }, altText: { name: seg.alt || 'image', description: seg.alt, title: seg.alt } })
            : new TextRun({ text: `[${seg.alt || 'image'}]`, italics: true });
        }
        default:
          return new TextRun({ text: seg.value, ...extra });
      }
    });

  let listInstance = 0;
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }),
  ];
  const blocks: Block[] = parseMarkdown(markdown);
  for (const block of blocks) {
    switch (block.kind) {
      case 'h2':
      case 'h3':
        children.push(new Paragraph({ heading: HEADINGS[block.level - 1], children: runs(block.inline) }));
        break;
      case 'p':
        children.push(new Paragraph({ spacing: { after: PARAGRAPH_GAP }, children: runs(block.inline) }));
        break;
      case 'ul':
        block.items.forEach((item, i) => {
          const mark = item.checked === null ? [] : [new TextRun(item.checked ? '[x] ' : '[ ] ')];
          const after = i === block.items.length - 1 ? PARAGRAPH_GAP : 0;
          children.push(new Paragraph({ bullet: { level: item.level }, spacing: { after }, children: [...mark, ...runs(item.inline)] }));
        });
        break;
      case 'ol': {
        const instance = ++listInstance;
        block.items.forEach((item, i) => {
          const after = i === block.items.length - 1 ? PARAGRAPH_GAP : 0;
          children.push(new Paragraph({ numbering: { reference: 'numbered', level: item.level, instance }, spacing: { after }, children: runs(item.inline) }));
        });
        break;
      }
      case 'quote':
        for (const line of block.lines) {
          children.push(
            new Paragraph({
              indent: { left: 360 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: W.green, space: 8 } },
              spacing: { after: PARAGRAPH_GAP / 2 },
              children: runs(line),
            }),
          );
        }
        break;
      case 'code':
        for (const line of block.text.split('\n')) {
          children.push(
            new Paragraph({
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: W.codeFill },
              spacing: { after: 0 },
              children: [new TextRun({ text: line || ' ', font: W.codeFont, color: '000000' })],
            }),
          );
        }
        break;
      case 'table':
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: block.header.map(
                  (cell) => new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: W.greenLight }, children: [new Paragraph({ children: runs(cell, { bold: true }) })] }),
                ),
              }),
              ...block.rows.map(
                (row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph({ children: runs(cell) })] })) }),
              ),
            ],
          }),
        );
        break;
      case 'hr':
        children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: W.green, space: 1 } }, children: [] }));
        break;
    }
  }

  const heading = (run: object, paragraph: object) => ({ run: { font: W.font, size: W.textSize, smallCaps: true, ...run }, paragraph });
  const doc = new Document({
    title,
    styles: {
      default: {
        document: { run: { font: W.font, size: W.textSize } },
        title: { run: { font: W.font, smallCaps: true, color: W.green, size: 52 }, paragraph: { spacing: { before: 720, after: 240 } } },
        heading1: heading(
          { bold: true, color: 'FFFFFF' },
          { border: box(W.green, 24), shading: { type: ShadingType.CLEAR, color: 'auto', fill: W.green }, spacing: { before: 240, after: 120 } },
        ),
        heading2: heading(
          { color: '000000' },
          { border: box(W.greenLight, 24), shading: { type: ShadingType.CLEAR, color: 'auto', fill: W.greenLight }, spacing: { before: 240, after: 120 } },
        ),
        heading3: heading(
          { color: W.greenDark },
          { border: { top: { style: BorderStyle.SINGLE, size: 6, color: W.green, space: 2 }, left: { style: BorderStyle.SINGLE, size: 6, color: W.green, space: 2 } }, spacing: { before: 300, after: 80 } },
        ),
        heading4: heading(
          { color: W.greenMid },
          { border: { top: { style: BorderStyle.DOTTED, size: 6, color: W.green, space: 2 }, left: { style: BorderStyle.DOTTED, size: 6, color: W.green, space: 2 } }, spacing: { before: 300, after: 80 } },
        ),
        heading5: heading({ color: W.greenMid }, { spacing: { before: 240, after: 60 } }),
        heading6: heading({ color: W.greenMid, italics: true }, { spacing: { before: 240, after: 60 } }),
      },
    },
    numbering: {
      config: [
        {
          reference: 'numbered',
          levels: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL].map((format, level) => ({
            level,
            format,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children }],
  });
  return { blob: await Packer.toBlob(doc), filename: `${baseName(title)}.docx` };
}
