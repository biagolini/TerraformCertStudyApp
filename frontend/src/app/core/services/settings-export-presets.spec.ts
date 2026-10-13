import { withoutOrphanExportPresets } from './settings.service';
import { AppSettings, DEFAULT_SETTINGS } from '../models/settings.model';
import { ExportPreset } from '../models/export-preset.model';

const preset = { source: 'banks' } as ExportPreset;

describe('withoutOrphanExportPresets', () => {
  it('drops presets of certifications that no longer exist', () => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS, exportPresets: { keep: preset, gone: preset } };
    expect(Object.keys(withoutOrphanExportPresets(settings, new Set(['keep'])).exportPresets ?? {})).toEqual(['keep']);
  });

  it('returns the same object when nothing changes, so no write happens', () => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS, exportPresets: { keep: preset } };
    expect(withoutOrphanExportPresets(settings, new Set(['keep']))).toBe(settings);
    expect(withoutOrphanExportPresets(DEFAULT_SETTINGS, new Set())).toBe(DEFAULT_SETTINGS);
  });
});
