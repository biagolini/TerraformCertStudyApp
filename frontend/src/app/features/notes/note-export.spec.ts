import JSZip from 'jszip';
import { exportNoteMarkdown, imageFileNames, storedImageRefs, withLocalImagePaths } from './note-export';

const BODY = [
  '# Storage',
  '![Bucket layout](note/n1/1a2b3c4d-layout.png)',
  'See ![external](https://example.com/a.png) and ![again](note/n1/1a2b3c4d-layout.png).',
  '![Other](note/n1/9f8e7d6c-layout.png)',
].join('\n');

describe('note export', () => {
  it('lists stored image refs once, skipping external URLs', () => {
    expect(storedImageRefs(BODY)).toEqual(['note/n1/1a2b3c4d-layout.png', 'note/n1/9f8e7d6c-layout.png']);
  });

  it('names images without the upload prefix and keeps names unique', () => {
    const names = imageFileNames(storedImageRefs(BODY));
    expect([...names.values()]).toEqual(['layout.png', 'layout-2.png']);
  });

  it('points image links at the img folder', () => {
    const names = imageFileNames(storedImageRefs(BODY));
    expect(withLocalImagePaths(BODY, names)).toContain('![Bucket layout](img/layout.png)');
    expect(withLocalImagePaths(BODY, names)).toContain('![Other](img/layout-2.png)');
    expect(withLocalImagePaths(BODY, names)).toContain('![external](https://example.com/a.png)');
  });

  it('exports a plain .md when there are no images', async () => {
    const file = await exportNoteMarkdown('My Notes', '# Title\ntext', async () => new Blob());
    expect(file.filename).toBe('my-notes.md');
  });

  it('exports a .zip with the images in img/ and rewritten links', async () => {
    const file = await exportNoteMarkdown('My Notes', BODY, async (ref) => new Blob([ref]));
    expect(file.filename).toBe('my-notes.zip');
    const zip = await JSZip.loadAsync(file.blob);
    expect(Object.keys(zip.files).sort()).toEqual(['img/', 'img/layout-2.png', 'img/layout.png', 'my-notes.md']);
    expect(await zip.file('my-notes.md')!.async('string')).toContain('](img/layout.png)');
  });

  it('keeps the original link for an image that fails to download', async () => {
    const file = await exportNoteMarkdown('n', BODY, async (ref) => {
      if (ref.includes('9f8e')) throw new Error('gone');
      return new Blob([ref]);
    });
    const zip = await JSZip.loadAsync(file.blob);
    expect(await zip.file('n.md')!.async('string')).toContain('![Other](note/n1/9f8e7d6c-layout.png)');
  });
});
