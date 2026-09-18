import { Injectable, computed, inject } from '@angular/core';
import { SettingsService } from '../services/settings.service';
import { EN } from './en';
import { PT } from './pt';
import { ES } from './es';
import { IT } from './it';
import { InterfaceLanguage } from '../models/i18n.model';

const DICTS: Record<InterfaceLanguage, Record<string, string>> = { en: EN, pt: PT, es: ES, it: IT };

/** App-wide UI translation. Every component that renders user-facing text
 * injects this and calls `i18n.t('key')` directly in its template (not a
 * pipe) — a signal read inside a template expression is what Angular's
 * OnPush change-detection tracks, so a language change re-renders every
 * consuming view automatically the same way any other signal does. */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly settings = inject(SettingsService);

  readonly lang = computed<InterfaceLanguage>(() => this.settings.interfaceLanguage());

  t(key: string, params?: Record<string, string | number | null | undefined>): string {
    const dict = DICTS[this.lang()] ?? EN;
    let value = dict[key] ?? EN[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replaceAll(`{{${k}}}`, String(v ?? ''));
      }
    }
    return value;
  }
}
