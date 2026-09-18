import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { StudyMethod } from '../models/method.model';
import { DEFAULT_NAV_ORDER, NAV_ITEMS, NavTabId, resolveNavOrder } from '../models/nav-item.model';
import { AppSettings, DEFAULT_SETTINGS, ReviewMode, ThemeMode } from '../models/settings.model';
import { InterfaceLanguage } from '../models/i18n.model';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly storage = inject(StorageService);

  private readonly state = signal<AppSettings>({ ...DEFAULT_SETTINGS });

  readonly settings = this.state.asReadonly();
  readonly theme = computed(() => this.state().theme);
  readonly defaultModel = computed(() => this.state().defaultModel);
  readonly importExtractionModel = computed(() => this.state().importExtractionModel);
  readonly activePackId = computed(() => this.state().activePackId);
  readonly activeMethod = computed(() => this.state().activeMethod);
  readonly interfaceLanguage = computed(() => this.state().interfaceLanguage);
  readonly outputLanguage = computed(() => this.state().outputLanguage);
  readonly defaultReviewMode = computed(() => this.state().defaultReviewMode);
  readonly showCorrectInReview = computed(() => this.state().showCorrectInReview);
  readonly defaultTrackTime = computed(() => this.state().defaultTrackTime);
  readonly defaultUseAccommodation = computed(() => this.state().defaultUseAccommodation);
  readonly hiddenNavTabs = computed(() => this.state().hiddenNavTabs);
  /** Every current nav item, in the user's chosen display order — see
   * resolveNavOrder for how a stale/incomplete stored order is handled. */
  readonly orderedNavItems = computed(() => resolveNavOrder(this.state().navOrder ?? DEFAULT_NAV_ORDER));

  constructor() {
    effect(() => {
      if (this.storage.ready()) {
        const loaded = this.storage.getSettings();
        console.debug('[SettingsService] loaded from storage:', loaded);
        this.state.set(loaded);
      }
    });
  }

  setTheme(theme: ThemeMode): void {
    this.update((s) => ({ ...s, theme }));
  }

  setDefaultModel(value: string): void {
    this.update((s) => ({ ...s, defaultModel: value.trim() || s.defaultModel }));
  }

  setImportExtractionModel(value: string): void {
    this.update((s) => ({ ...s, importExtractionModel: value.trim() || s.importExtractionModel }));
  }

  setActivePackId(id: string): void {
    if (id === this.state().activePackId) return;
    console.debug('[SettingsService] setActivePackId:', this.state().activePackId, '->', id);
    this.update((s) => ({ ...s, activePackId: id }));
  }

  setActiveMethod(method: StudyMethod): void {
    if (method === this.state().activeMethod) return;
    this.update((s) => ({ ...s, activeMethod: method }));
  }

  setInterfaceLanguage(value: InterfaceLanguage): void {
    if (value === this.state().interfaceLanguage) return;
    this.update((s) => ({ ...s, interfaceLanguage: value }));
  }

  setOutputLanguage(value: string): void {
    if (value === this.state().outputLanguage) return;
    this.update((s) => ({ ...s, outputLanguage: value }));
  }

  setDefaultReviewMode(value: ReviewMode): void {
    if (value === this.state().defaultReviewMode) return;
    this.update((s) => ({ ...s, defaultReviewMode: value }));
  }

  setShowCorrectInReview(value: boolean): void {
    if (value === this.state().showCorrectInReview) return;
    this.update((s) => ({ ...s, showCorrectInReview: value }));
  }

  setDefaultTrackTime(value: boolean): void {
    if (value === this.state().defaultTrackTime) return;
    this.update((s) => ({ ...s, defaultTrackTime: value }));
  }

  setDefaultUseAccommodation(value: boolean): void {
    if (value === this.state().defaultUseAccommodation) return;
    this.update((s) => ({ ...s, defaultUseAccommodation: value }));
  }

  toggleNavTab(id: NavTabId): void {
    const current = this.state().hiddenNavTabs;
    const hidden = current.includes(id);
    // Never allow hiding the last visible tab — an empty tabbar has no way
    // back to Settings to undo it.
    if (!hidden && current.length >= NAV_ITEMS.length - 1) return;
    const next = hidden ? current.filter((t) => t !== id) : [...current, id];
    this.update((s) => ({ ...s, hiddenNavTabs: next }));
  }

  /** Swaps `id` with its neighbor in the given direction — operates on the
   * already-resolved, complete ordering (orderedNavItems), not the raw
   * (possibly stale/incomplete) stored navOrder, so this always produces a
   * full, valid order regardless of what was there before. */
  moveNavTab(id: NavTabId, direction: 'up' | 'down'): void {
    const order = this.orderedNavItems().map((item) => item.id);
    const index = order.indexOf(id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= order.length) return;
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
    this.update((s) => ({ ...s, navOrder: order }));
  }

  private update(updater: (current: AppSettings) => AppSettings): void {
    const next = updater(this.state());
    this.state.set(next);
    this.storage.saveSettings(next);
  }
}
