import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { StudyMethod } from '../models/method.model';
import { DEFAULT_NAV_ORDER, NAV_ITEMS, NavTabId, resolveNavOrder } from '../models/nav-item.model';
import {
  DEFAULT_QUIZ_TOOL_ORDER,
  MAX_QUIZ_TOOLBAR_ROWS,
  QuizToolId,
  resolveQuizToolOrder,
} from '../models/quiz-tool.model';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  IMPORT_REVIEW_CONCURRENCY_MAX,
  NOTE_READING_THEMES,
  NoteReadingTheme,
  ReviewMode,
  ThemeMode,
  migrateSettings,
} from '../models/settings.model';
import { HeaderActionId, resolveHeaderActions } from '../models/header-action.model';
import { InterfaceLanguage } from '../models/i18n.model';
import { ExportPreset } from '../models/export-preset.model';
import { StorageService } from './storage.service';
import { NOTE_OUTLINE_DEFAULT_DEPTH } from '../utils/note-outline.util';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly storage = inject(StorageService);

  private readonly state = signal<AppSettings>({ ...DEFAULT_SETTINGS });

  readonly settings = this.state.asReadonly();
  readonly theme = computed(() => this.state().theme);
  readonly defaultModel = computed(() => this.state().defaultModel);
  readonly importExtractionModel = computed(() => this.state().importExtractionModel);
  readonly importReviewModel = computed(() => this.state().importReviewModel || DEFAULT_SETTINGS.importReviewModel);
  readonly importReviewTimeoutSeconds = computed(
    () => this.state().importReviewTimeoutSeconds || DEFAULT_SETTINGS.importReviewTimeoutSeconds,
  );
  readonly importReviewConcurrency = computed(
    () => this.state().importReviewConcurrency || DEFAULT_SETTINGS.importReviewConcurrency,
  );
  readonly activePackId = computed(() => this.state().activePackId);
  readonly activeMethod = computed(() => this.state().activeMethod);
  readonly interfaceLanguage = computed(() => this.state().interfaceLanguage);
  readonly outputLanguage = computed(() => this.state().outputLanguage);
  readonly translationTargetLanguage = computed(() => this.state().translationTargetLanguage);
  readonly defaultReviewMode = computed(() => this.state().defaultReviewMode);
  readonly showCorrectInReview = computed(() => this.state().showCorrectInReview);
  readonly defaultTrackTime = computed(() => this.state().defaultTrackTime);
  readonly defaultUseAccommodation = computed(() => this.state().defaultUseAccommodation);
  readonly hiddenNavTabs = computed(() => this.state().hiddenNavTabs);
  /** Every current nav item, in the user's chosen display order — see
   * resolveNavOrder for how a stale/incomplete stored order is handled. */
  readonly orderedNavItems = computed(() => resolveNavOrder(this.state().navOrder ?? DEFAULT_NAV_ORDER));
  readonly hiddenQuizTools = computed(() => this.state().hiddenQuizTools ?? []);
  /** Every quiz toolbar button, in the user's chosen display order. */
  readonly orderedQuizTools = computed(() => resolveQuizToolOrder(this.state().quizToolOrder ?? DEFAULT_QUIZ_TOOL_ORDER));
  readonly quizToolbarRows = computed(() => this.state().quizToolbarRows ?? DEFAULT_SETTINGS.quizToolbarRows);
  /** Optional header buttons the user turned on, in display order. */
  readonly headerActions = computed(() => resolveHeaderActions(this.state().headerActions));

  constructor() {
    effect(() => {
      if (this.storage.ready()) {
        const stored = this.storage.getSettings();
        // Skipped when no certification came back: an empty list may be a failed
        // load, and pruning then would wipe every saved export configuration.
        const packIds = new Set(this.storage.getPacks().map((p) => p.id));
        const migrated = migrateSettings(stored);
        const loaded = packIds.size > 0 ? withoutOrphanExportPresets(migrated, packIds) : migrated;
        console.debug('[SettingsService] loaded from storage:', loaded);
        this.state.set(loaded);
        // Persist once so the migration is not re-run (and re-saved) on every load.
        if (loaded !== stored) this.storage.saveSettings(loaded);
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

  setImportReviewModel(value: string): void {
    this.update((s) => ({ ...s, importReviewModel: value.trim() || s.importReviewModel }));
  }

  setImportReviewTimeoutSeconds(value: number): void {
    const seconds = Math.max(60, Math.min(840, Math.round(Number(value)) || 300));
    this.update((s) => ({ ...s, importReviewTimeoutSeconds: seconds }));
  }

  setImportReviewConcurrency(value: number): void {
    const n = Math.max(1, Math.min(IMPORT_REVIEW_CONCURRENCY_MAX, Math.round(Number(value)) || 4));
    this.update((s) => ({ ...s, importReviewConcurrency: n }));
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

  setTranslationTargetLanguage(value: string): void {
    if (value === this.state().translationTargetLanguage) return;
    this.update((s) => ({ ...s, translationTargetLanguage: value }));
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

  /** Hiding every tool is allowed here (unlike the bottom nav, where it would
   * lock the user out of Settings): the toolbar is a convenience layer and the
   * same actions still exist at the bottom of the question. */
  toggleQuizTool(id: QuizToolId): void {
    const current = this.hiddenQuizTools();
    const next = current.includes(id) ? current.filter((t) => t !== id) : [...current, id];
    this.update((s) => ({ ...s, hiddenQuizTools: next }));
  }

  /** Swaps `id` with its neighbor — same "operate on the resolved order, not the
   * raw stored one" approach as moveNavTab. */
  moveQuizTool(id: QuizToolId, direction: 'up' | 'down'): void {
    const order = this.orderedQuizTools().map((tool) => tool.id);
    const index = order.indexOf(id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= order.length) return;
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
    this.update((s) => ({ ...s, quizToolOrder: order }));
  }

  setQuizToolbarRows(rows: number): void {
    const clamped = Math.max(1, Math.min(MAX_QUIZ_TOOLBAR_ROWS, Math.trunc(rows) || 1));
    if (clamped === this.quizToolbarRows()) return;
    this.update((s) => ({ ...s, quizToolbarRows: clamped }));
  }

  addHeaderAction(id: HeaderActionId): void {
    const current = this.headerActions();
    if (current.includes(id)) return;
    this.update((s) => ({ ...s, headerActions: [...current, id] }));
  }

  removeHeaderAction(id: HeaderActionId): void {
    const current = this.headerActions();
    if (!current.includes(id)) return;
    this.update((s) => ({ ...s, headerActions: current.filter((a) => a !== id) }));
  }

  moveHeaderAction(id: HeaderActionId, direction: 'up' | 'down'): void {
    const order = [...this.headerActions()];
    const index = order.indexOf(id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= order.length) return;
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
    this.update((s) => ({ ...s, headerActions: order }));
  }

  exportPreset(packId: string): ExportPreset | null {
    return this.state().exportPresets?.[packId] ?? null;
  }

  /** Drops the export configuration of certifications that no longer exist
   * (called when one is deleted). Writes only when something was removed. */
  pruneExportPresets(packIds: ReadonlySet<string>): void {
    const current = this.state();
    const next = withoutOrphanExportPresets(current, packIds);
    if (next !== current) this.update(() => next);
  }

  /** Note that last received a concept from a mock-exam question in this certification. */
  summaryNote(packId: string): string | null {
    return this.state().summaryNotes?.[packId] ?? null;
  }

  saveSummaryNote(packId: string, noteId: string): void {
    if (this.summaryNote(packId) === noteId) return;
    this.update((s) => ({ ...s, summaryNotes: { ...(s.summaryNotes ?? {}), [packId]: noteId } }));
  }

  readonly noteOutlineOpen = computed(() => this.state().noteOutlineOpen ?? false);
  readonly noteOutlineDepth = computed(() => this.state().noteOutlineDepth ?? NOTE_OUTLINE_DEFAULT_DEPTH);

  readonly noteReadingTheme = computed<NoteReadingTheme>(() => {
    const theme = this.state().noteReadingTheme;
    return theme && NOTE_READING_THEMES.includes(theme) ? theme : 'site';
  });

  setNoteReadingTheme(theme: NoteReadingTheme): void {
    if (theme === this.noteReadingTheme()) return;
    this.update((s) => ({ ...s, noteReadingTheme: theme }));
  }

  setNoteOutlineOpen(open: boolean): void {
    if (open === this.noteOutlineOpen()) return;
    this.update((s) => ({ ...s, noteOutlineOpen: open }));
  }

  setNoteOutlineDepth(depth: number): void {
    const clamped = Math.max(1, Math.min(6, Math.trunc(depth) || NOTE_OUTLINE_DEFAULT_DEPTH));
    if (clamped === this.noteOutlineDepth()) return;
    this.update((s) => ({ ...s, noteOutlineDepth: clamped }));
  }

  /** Skips the write when nothing changed, so restoring a preset never re-saves it. */
  saveExportPreset(packId: string, preset: ExportPreset): void {
    const current = this.exportPreset(packId);
    if (current && JSON.stringify(current) === JSON.stringify(preset)) return;
    this.update((s) => ({ ...s, exportPresets: { ...(s.exportPresets ?? {}), [packId]: preset } }));
  }

  private update(updater: (current: AppSettings) => AppSettings): void {
    const next = updater(this.state());
    this.state.set(next);
    this.storage.saveSettings(next);
  }
}

/** Same settings without export presets of deleted certifications; the same
 * object when there is nothing to drop, so callers can skip the write. */
export function withoutOrphanExportPresets(settings: AppSettings, packIds: ReadonlySet<string>): AppSettings {
  let next = settings;
  for (const key of ['exportPresets', 'summaryNotes'] as const) {
    const map = next[key] as Record<string, unknown> | undefined;
    if (!map) continue;
    const kept = Object.fromEntries(Object.entries(map).filter(([id]) => packIds.has(id)));
    if (Object.keys(kept).length !== Object.keys(map).length) next = { ...next, [key]: kept };
  }
  return next;
}
