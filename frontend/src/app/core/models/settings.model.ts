export type ThemeMode = 'light' | 'dark';

import { StudyMethod } from './method.model';

export interface AppSettings {
  theme: ThemeMode;
  defaultModel: string;
  activePackId: string;
  activeMethod: StudyMethod;
  outputLanguage: string;
}

export const DEFAULT_MODEL = 'amazon.nova-lite-v1:0';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  defaultModel: DEFAULT_MODEL,
  activePackId: '',
  activeMethod: 'question',
  outputLanguage: '',
};

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
