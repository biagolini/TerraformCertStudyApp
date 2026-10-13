export type ThemeMode = 'light' | 'dark';

import { StudyMethod } from './method.model';
import { DEFAULT_NAV_ORDER, NavTabId } from './nav-item.model';
import { DEFAULT_QUIZ_TOOL_ORDER, QuizToolId } from './quiz-tool.model';
import { DEFAULT_HEADER_ACTIONS, HeaderActionId } from './header-action.model';
import { InterfaceLanguage } from './i18n.model';
import { ExportPreset } from './export-preset.model';

export type ReviewMode = 'generate' | 'manual';

export interface AppSettings {
  theme: ThemeMode;
  defaultModel: string;
  importExtractionModel: string;
  /** Model the review agent writes import explanations with ("Refine with AI"). */
  importReviewModel: string;
  /** Max seconds to wait for one question's AI review before giving up (60..840). */
  importReviewTimeoutSeconds: number;
  /** How many questions are reviewed in parallel (1..10). */
  importReviewConcurrency: number;
  activePackId: string;
  activeMethod: StudyMethod;
  /** Language the app's own UI (buttons, labels, menus) is rendered in —
   * distinct from outputLanguage below, which only affects AI-generated
   * text (reviews, explanations, chat replies). */
  interfaceLanguage: InterfaceLanguage;
  outputLanguage: string;
  /** Forces the "Translate with AI" button's target language — empty string
   * means "Automatic" (interface language, unless the question is already
   * in that language, in which case falls back through Portuguese then
   * English — see translate-prompt.util.ts's resolveTranslationTarget).
   * Distinct from outputLanguage above, which only affects newly-GENERATED
   * review text, not translating an already-generated one. */
  translationTargetLanguage: string;
  defaultReviewMode: ReviewMode;
  showCorrectInReview: boolean;
  defaultTrackTime: boolean;
  defaultUseAccommodation: boolean;
  /** Bottom-nav tabs the user has chosen to hide — see NAV_ITEMS. Default
   * empty (all visible); an id with no matching NAV_ITEMS entry is ignored. */
  hiddenNavTabs: NavTabId[];
  /** Display order of bottom-nav tabs — see NAV_ITEMS and resolveNavOrder,
   * which tolerates a stale/incomplete list (a nav item added after this
   * was saved, or one that no longer exists). */
  navOrder: NavTabId[];
  /** Quiz annotation-toolbar buttons the user has chosen to hide — see
   * QUIZ_TOOLS. Default empty (all visible). */
  hiddenQuizTools: QuizToolId[];
  /** Display order of the quiz annotation-toolbar buttons — see QUIZ_TOOLS
   * and resolveQuizToolOrder. */
  quizToolOrder: QuizToolId[];
  /** How many rows the quiz toolbar is split into (1 by default, capped at
   * MAX_QUIZ_TOOLBAR_ROWS). Rows are only materialized when there is at least
   * one button per row — see splitQuizToolRows. */
  quizToolbarRows: number;
  /** Visible optional header buttons, in display order (Settings is always
   * shown after them). See HEADER_ACTIONS. */
  headerActions: HeaderActionId[];
  /** Last Export page configuration per certification (pack id). */
  exportPresets?: Record<string, ExportPreset>;
  /** Note last chosen to receive concepts from mock-exam questions, per certification (pack id). */
  summaryNotes?: Record<string, string>;
  /** Study note preview: whether the heading index panel is open, and how
   * many heading levels it lists (default 3). */
  noteOutlineOpen?: boolean;
  noteOutlineDepth?: number;
  /** Color theme of study note text; 'site' (default) follows the site theme. */
  noteReadingTheme?: NoteReadingTheme;
  /** Schema version of layout defaults already applied to this user's stored
   * settings. Deliberately absent from DEFAULT_SETTINGS: the stored object is
   * merged over the defaults, so a default here would hide the fact that an
   * older stored copy never went through migrateSettings. */
  layoutVersion?: number;
}

/** Bumped whenever a layout default must reach users whose settings were
 * already saved (every save writes the whole object, so a changed default
 * alone never reaches them). */
export const CURRENT_LAYOUT_VERSION = 1;

/** Applies layout defaults that changed after a user's settings were stored.
 * v1: the quiz toolbar is split over 2 rows on phones (8 buttons in one row
 * truncated every label). Returns the same object when nothing changed. */
export function migrateSettings(settings: AppSettings): AppSettings {
  const version = settings.layoutVersion ?? 0;
  if (version >= CURRENT_LAYOUT_VERSION) return settings;
  let next: AppSettings = { ...settings };
  if (version < 1) {
    next = { ...next, quizToolbarRows: Math.max(2, next.quizToolbarRows ?? 1) };
  }
  return { ...next, layoutVersion: CURRENT_LAYOUT_VERSION };
}

export const DEFAULT_MODEL = 'amazon.nova-lite-v1:0';
// The system-defined inference profile id, not the bare foundation-model id —
// GET /data/models (see lambda/data/app.py's _list_usable_models) prefers the
// profile over the base id whenever both exist for the same underlying model,
// so this must match exactly or the Settings dropdown shows it as "not in
// current list" even though it's a perfectly valid, selectable option.
export const DEFAULT_IMPORT_EXTRACTION_MODEL = 'us.amazon.nova-pro-v1:0';
export const DEFAULT_IMPORT_REVIEW_MODEL = 'us.amazon.nova-2-lite-v1:0';
export const IMPORT_REVIEW_TIMEOUT_OPTIONS = [60, 120, 180, 300, 480, 600, 840];
export const IMPORT_REVIEW_CONCURRENCY_MAX = 10;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  defaultModel: DEFAULT_MODEL,
  importExtractionModel: DEFAULT_IMPORT_EXTRACTION_MODEL,
  importReviewModel: DEFAULT_IMPORT_REVIEW_MODEL,
  importReviewTimeoutSeconds: 300,
  importReviewConcurrency: 4,
  activePackId: '',
  activeMethod: 'question',
  interfaceLanguage: 'en',
  outputLanguage: '',
  translationTargetLanguage: '',
  defaultReviewMode: 'generate',
  showCorrectInReview: true,
  defaultTrackTime: false,
  defaultUseAccommodation: false,
  hiddenNavTabs: [],
  navOrder: DEFAULT_NAV_ORDER,
  hiddenQuizTools: [],
  quizToolOrder: DEFAULT_QUIZ_TOOL_ORDER,
  quizToolbarRows: 2,
  headerActions: DEFAULT_HEADER_ACTIONS,
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

/** Color themes a study note's text can be read in, independent of the site theme. */
export const NOTE_READING_THEMES = ['site', 'light', 'dark', 'sepia'] as const;
export type NoteReadingTheme = (typeof NOTE_READING_THEMES)[number];

/** CSS class that applies a reading theme's tokens (see _variables.scss); '' for 'site'. */
export function readingThemeClass(theme: NoteReadingTheme): string {
  return theme === 'site' ? '' : `reading-theme-${theme}`;
}
