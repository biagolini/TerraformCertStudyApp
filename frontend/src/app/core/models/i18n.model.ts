export type InterfaceLanguage = 'en' | 'pt' | 'es' | 'it';

export interface InterfaceLanguageOption {
  code: InterfaceLanguage;
  label: string;
}

/** Labels are always shown in their own language, not the currently active
 * one — a user who can't read the active language still needs to find their
 * own in this list. */
export const INTERFACE_LANGUAGES: InterfaceLanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
];

export function isInterfaceLanguage(value: string): value is InterfaceLanguage {
  return value === 'en' || value === 'pt' || value === 'es' || value === 'it';
}
