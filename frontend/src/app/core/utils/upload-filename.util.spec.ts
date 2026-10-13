import { safeUploadFilename } from './upload-filename.util';

describe('safeUploadFilename', () => {
  it('folds accents and replaces spaces and symbols', () => {
    expect(safeUploadFilename('Captura de Tela 2026-10-13 às 10.00.png', 'image/png')).toBe('Captura-de-Tela-2026-10-13-as-10.00.png');
  });

  it('keeps a valid name as is', () => {
    expect(safeUploadFilename('diagram_v2.jpeg')).toBe('diagram_v2.jpeg');
  });

  it('takes the extension from the MIME type when the name has none', () => {
    expect(safeUploadFilename('image', 'image/webp')).toBe('image.webp');
    expect(safeUploadFilename('', 'image/jpeg')).toBe('image.jpg');
  });
});
