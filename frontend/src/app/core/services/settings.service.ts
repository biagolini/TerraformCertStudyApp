import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { StudyMethod } from '../models/method.model';
import { AppSettings, DEFAULT_SETTINGS, ThemeMode } from '../models/settings.model';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly storage = inject(StorageService);

  private readonly state = signal<AppSettings>({ ...DEFAULT_SETTINGS });

  readonly settings = this.state.asReadonly();
  readonly theme = computed(() => this.state().theme);
  readonly defaultModel = computed(() => this.state().defaultModel);
  readonly activePackId = computed(() => this.state().activePackId);
  readonly activeMethod = computed(() => this.state().activeMethod);
  readonly outputLanguage = computed(() => this.state().outputLanguage);

  constructor() {
    effect(() => {
      if (this.storage.ready()) {
        this.state.set(this.storage.getSettings());
      }
    });
  }

  setTheme(theme: ThemeMode): void {
    this.update((s) => ({ ...s, theme }));
  }

  setDefaultModel(value: string): void {
    this.update((s) => ({ ...s, defaultModel: value.trim() || s.defaultModel }));
  }

  setActivePackId(id: string): void {
    if (id === this.state().activePackId) return;
    this.update((s) => ({ ...s, activePackId: id }));
  }

  setActiveMethod(method: StudyMethod): void {
    if (method === this.state().activeMethod) return;
    this.update((s) => ({ ...s, activeMethod: method }));
  }

  setOutputLanguage(value: string): void {
    if (value === this.state().outputLanguage) return;
    this.update((s) => ({ ...s, outputLanguage: value }));
  }

  private update(updater: (current: AppSettings) => AppSettings): void {
    const next = updater(this.state());
    this.state.set(next);
    this.storage.saveSettings(next);
  }
}
