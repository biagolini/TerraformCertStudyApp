export type ThemeMode = 'light' | 'dark';

import { StudyMethod } from './method.model';
import { NavTabId } from './nav-item.model';

export type ReviewMode = 'generate' | 'manual';

export interface AppSettings {
  theme: ThemeMode;
  defaultModel: string;
  importExtractionModel: string;
  activePackId: string;
  activeMethod: StudyMethod;
  outputLanguage: string;
  defaultReviewMode: ReviewMode;
  showCorrectInReview: boolean;
  defaultTrackTime: boolean;
  defaultUseAccommodation: boolean;
  /** Bottom-nav tabs the user has chosen to hide — see NAV_ITEMS. Default
   * empty (all visible); an id with no matching NAV_ITEMS entry is ignored. */
  hiddenNavTabs: NavTabId[];
}

export const DEFAULT_MODEL = 'amazon.nova-lite-v1:0';
// The system-defined inference profile id, not the bare foundation-model id —
// GET /data/models (see lambda/data/app.py's _list_usable_models) prefers the
// profile over the base id whenever both exist for the same underlying model,
// so this must match exactly or the Settings dropdown shows it as "not in
// current list" even though it's a perfectly valid, selectable option.
export const DEFAULT_IMPORT_EXTRACTION_MODEL = 'us.amazon.nova-pro-v1:0';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  defaultModel: DEFAULT_MODEL,
  importExtractionModel: DEFAULT_IMPORT_EXTRACTION_MODEL,
  activePackId: '',
  activeMethod: 'question',
  outputLanguage: '',
  defaultReviewMode: 'generate',
  showCorrectInReview: true,
  defaultTrackTime: false,
  defaultUseAccommodation: false,
  hiddenNavTabs: [],
};

export function isReviewMode(value: string): value is ReviewMode {
  return value === 'generate' || value === 'manual';
}

export interface OutputLanguageOption {
  code: string;
  label: string;
}

export const OUTPUT_LANGUAGES: OutputLanguageOption[] = [
  { code: '', label: 'Same as input (default)' },
  { code: 'en', label: 'English' },
  { code: 'pt-BR', label: 'Portuguese (Brazilian)' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'vi', label: 'Vietnamese' },
];

export function outputLanguageLabel(code: string): string {
  return OUTPUT_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export const DEFAULT_DOMAIN = 'General';
