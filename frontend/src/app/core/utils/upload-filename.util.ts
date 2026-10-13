const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** A filename the upload API accepts (letters, digits, `.`, `_`, `-` and a
 * supported image extension). Screenshots are often named with spaces and
 * accents ("Captura de Tela 2026-10-13 às 10.00.png"), and a pasted image
 * may have no useful name at all, so this folds accents, replaces anything
 * else with `-`, and takes the extension from the MIME type when needed. */
export function safeUploadFilename(name: string, mimeType = ''): string {
  const dot = name.lastIndexOf('.');
  const rawExt = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const ext = IMAGE_EXTENSIONS.includes(rawExt) ? rawExt : (EXTENSION_BY_TYPE[mimeType] ?? 'png');
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return `${stem || 'image'}.${ext}`;
}
