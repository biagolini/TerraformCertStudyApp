import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject } from '@angular/core';
import { ThemeMode } from '../models/settings.model';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly settings = inject(SettingsService);
  private readonly document = inject(DOCUMENT);

  constructor() {
    effect(() => {
      this.apply(this.settings.theme());
    });
  }

  apply(theme: ThemeMode): void {
    const root = this.document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    root.classList.add(`theme-${theme}`);
  }

  toggle(): void {
    const next: ThemeMode = this.settings.theme() === 'light' ? 'dark' : 'light';
    this.settings.setTheme(next);
  }
}
