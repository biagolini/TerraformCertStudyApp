import { Injectable, signal } from '@angular/core';
import { Question } from '../models/question.model';
import {
  DEFAULT_PACK_COLOR,
  DEFAULT_PACK_NAME,
  Pack,
  PackDomain,
} from '../models/pack.model';
import { Script } from '../models/script.model';
import { ChatSession } from '../models/chat.model';
import { QuizAttempt } from '../models/quiz-attempt.model';
import { AppSettings, DEFAULT_SETTINGS, isReviewMode } from '../models/settings.model';
import { isStudyMethod } from '../models/method.model';
import { NAV_ITEMS, NavTabId } from '../models/nav-item.model';
import { MAX_QUIZ_TOOLBAR_ROWS, isQuizToolId } from '../models/quiz-tool.model';
import { isInterfaceLanguage } from '../models/i18n.model';
import { environment } from '../../../environments/environment';

function deserializeDomain(raw: unknown): PackDomain | null {
  if (typeof raw === 'string' && raw.trim()) {
    return { name: raw.trim(), description: '' };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const name = typeof obj['name'] === 'string' ? obj['name'].trim() : '';
    if (!name) return null;
    const domain: PackDomain = { name, description: typeof obj['description'] === 'string' ? obj['description'] : '' };
    if (typeof obj['order'] === 'number') domain.order = obj['order'] as number;
    return domain;
  }
  return null;
}

const PREFIX = 'cert_study__';
const KEY_QUESTIONS = `${PREFIX}questions`;
const KEY_SETTINGS = `${PREFIX}settings`;
const KEY_PACKS = `${PREFIX}packs`;
const KEY_SCRIPTS = `${PREFIX}scripts`;
/** Per-device, NEVER synced — see reconcileActivePackId(). Deliberately a
 * separate localStorage key from the synced settings blob, so this device's
 * own last-active pack survives a remote pull that disagrees with it. */
const LOCAL_ACTIVE_PACK_KEY = `${PREFIX}local_active_pack_id`;

interface ApiData {
  packs: Pack[];
  questions: Question[];
  scripts: Script[];
  chats?: ChatSession[];
  settings: AppSettings | null;
}

/** Minimum time between visibility-triggered refreshes, to avoid spamming the API on quick tab switches. */
const AUTO_REFRESH_MIN_INTERVAL_MS = 20_000;

@Injectable({ providedIn: 'root' })
export class StorageService {
  /** Signal that resolves to true once remote data has been loaded. */
  readonly ready = signal(false);

  /** Sync health, surfaced by SyncStatusComponent and the Settings drawer. */
  readonly syncStatus = signal<'idle' | 'syncing' | 'error'>('idle');
  readonly lastError = signal<string | null>(null);
  readonly lastSyncedAt = signal<number | null>(null);

  /** Set when a remote pull reports a different `activePackId` than this
   * device's own local record — see reconcileActivePackId(). Consumed by
   * PackSwitchBannerComponent, which only surfaces it once the user is off
   * the /quiz route (never interrupting an in-progress attempt). */
  readonly pendingPackSwitch = signal<{ packId: string; packName: string } | null>(null);

  private _packs = signal<Pack[]>([]);
  private _questions = signal<Question[]>([]);
  private _scripts = signal<Script[]>([]);
  private _chats = signal<ChatSession[]>([]);
  private _settings = signal<AppSettings>({ ...DEFAULT_SETTINGS });

  private token: string | null = null;
  private apiUrl = environment.apiUrl;
  private visibilityListenerAttached = false;

  /** Supplied by AuthService — returns a fresh, auto-refreshed id token (or redirects to login and throws). */
  private tokenProvider: (() => Promise<string>) | null = null;

  setTokenProvider(provider: () => Promise<string>): void {
    this.tokenProvider = provider;
  }

  /** Resolves a valid token for an authenticated request, refreshing it first if a provider is registered. */
  private async getAuthToken(): Promise<string> {
    if (this.tokenProvider) {
      this.token = await this.tokenProvider();
      return this.token;
    }
    if (!this.token) throw new Error('Not authenticated.');
    return this.token;
  }

  /**
   * Called by AuthService after successful login.
   * Loads remote data, migrates localStorage if needed.
   */
  async initialize(idToken: string): Promise<void> {
    this.token = idToken;

    const remote = await this.fetchAll();
    const hasRemoteData = remote.packs.length > 0 || remote.questions.length > 0 || remote.scripts.length > 0 || (remote.chats?.length ?? 0) > 0 || remote.settings !== null;

    console.debug('[StorageService] initialize — remote data:', {
      hasRemoteData,
      packsCount: remote.packs.length,
      settings: remote.settings,
    });

    if (hasRemoteData) {
      // Use DynamoDB as source of truth
      this._packs.set(remote.packs);
      this._questions.set(remote.questions);
      this._scripts.set(remote.scripts);
      this._chats.set(remote.chats ?? []);
      const merged = remote.settings ? { ...DEFAULT_SETTINGS, ...remote.settings } : { ...DEFAULT_SETTINGS };
      this._settings.set(this.reconcileActivePackId(merged));
      // Clear localStorage since cloud is canonical
      this.clearLocalStorage();
    } else {
      // Check localStorage for migration
      const localPacks = this.readLocalPacks();
      const localQuestions = this.readLocalQuestions();
      const localScripts = this.readLocalScripts();
      const localSettings = this.readLocalSettings();

      const hasLocal = localPacks.length > 0 || localQuestions.length > 0 || localScripts.length > 0;

      if (hasLocal) {
        // Migrate local → cloud
        this._packs.set(localPacks);
        this._questions.set(localQuestions);
        this._scripts.set(localScripts);
        this._chats.set([]);
        this._settings.set(localSettings);

        await this.pushAll({
          packs: localPacks,
          questions: localQuestions,
          scripts: localScripts,
          chats: [],
          settings: localSettings,
        });
        this.clearLocalStorage();
      } else {
        // Fresh start
        this._packs.set([]);
        this._questions.set([]);
        this._scripts.set([]);
        this._chats.set([]);
        this._settings.set(localSettings);
      }
    }

    this.ready.set(true);
    this.attachVisibilityListener();
  }

  /** Update token when refreshed */
  updateToken(token: string): void {
    this.token = token;
  }

  /**
   * Re-pulls /data and replaces local state with the cloud copy.
   * Used both by the manual sync button and the auto-refresh-on-focus listener.
   * Flushes any pending debounced write first, so a pull never discards an unsaved edit.
   */
  async refresh(): Promise<void> {
    if (!this.token || this.syncStatus() === 'syncing') return;

    await this.flushPendingSync();

    this.syncStatus.set('syncing');
    try {
      const remote = await this.fetchAll();
      this._packs.set(remote.packs);
      this._questions.set(remote.questions);
      this._scripts.set(remote.scripts);
      this._chats.set(remote.chats ?? []);
      const merged = remote.settings ? { ...DEFAULT_SETTINGS, ...remote.settings } : { ...DEFAULT_SETTINGS };
      this._settings.set(this.reconcileActivePackId(merged));
      this.syncStatus.set('idle');
      this.lastError.set(null);
      this.lastSyncedAt.set(Date.now());
    } catch (err) {
      this.syncStatus.set('error');
      this.lastError.set(err instanceof Error ? err.message : 'Failed to sync with the server.');
      console.error('[StorageService] refresh failed:', err);
    }
  }

  /** Reconciles a just-pulled remote settings object's `activePackId` against
   * THIS device's own last-known active pack, so a remote pull never
   * silently swaps which pack the user is looking at (see
   * pendingPackSwitch's doc comment). First-ever sync on a device (no local
   * record yet) or an already-matching value passes through untouched. A
   * genuine mismatch keeps the device's own pack active and flags the
   * remote's choice via `pendingPackSwitch` for the banner to offer later —
   * called with `_packs` already populated with `remote.packs` at both call
   * sites, so the remote pack's name is available to look up here. */
  private reconcileActivePackId(remoteSettings: AppSettings): AppSettings {
    const localPackId = localStorage.getItem(LOCAL_ACTIVE_PACK_KEY);
    const remotePackId = remoteSettings.activePackId;
    if (!localPackId || localPackId === remotePackId) {
      if (remotePackId) localStorage.setItem(LOCAL_ACTIVE_PACK_KEY, remotePackId);
      return remoteSettings;
    }
    const remotePack = this._packs().find((p) => p.id === remotePackId);
    if (remotePack) {
      this.pendingPackSwitch.set({ packId: remotePackId, packName: remotePack.name });
    }
    return { ...remoteSettings, activePackId: localPackId };
  }

  /** Re-affirms THIS device's current settings (in particular activePackId)
   * to the backend, bypassing SettingsService.setActivePackId's same-value
   * guard — used by the "stay on my current pack" resolution of a pending
   * pack-switch conflict, where the local value never actually changed (it
   * was never overwritten in the first place) but still needs to overwrite
   * the stale value the backend currently has. */
  forceSyncSettings(): void {
    void this.fire(`${this.apiUrl}/data/settings`, 'PUT', this._settings());
  }

  private attachVisibilityListener(): void {
    if (this.visibilityListenerAttached || typeof document === 'undefined') return;
    this.visibilityListenerAttached = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const last = this.lastSyncedAt();
      if (last !== null && Date.now() - last < AUTO_REFRESH_MIN_INTERVAL_MS) return;
      void this.refresh();
    });
  }

  // ==========================================================================
  // Public API — same interface as before
  // ==========================================================================

  getQuestions(): Question[] {
    return this._questions();
  }

  saveQuestions(questions: Question[]): void {
    const previous = this._questions();
    this._questions.set(questions);
    this.diffAndSync('questions', previous, questions, (id) => `${this.apiUrl}/data/questions/${id}`, () => this._questions());
  }

  clearQuestions(): void {
    const previous = this._questions();
    this._questions.set([]);
    this.diffAndSync('questions', previous, [], (id) => `${this.apiUrl}/data/questions/${id}`, () => this._questions());
  }

  getPacks(): Pack[] {
    return this._packs();
  }

  savePacks(packs: Pack[]): void {
    const previous = this._packs();
    this._packs.set(packs);
    this.diffAndSync('packs', previous, packs, (id) => `${this.apiUrl}/data/packs/${id}`, () => this._packs());
  }

  getScripts(): Script[] {
    return this._scripts();
  }

  saveScripts(scripts: Script[]): void {
    const previous = this._scripts();
    this._scripts.set(scripts);
    this.diffAndSync('scripts', previous, scripts, (id) => `${this.apiUrl}/data/scripts/${id}`, () => this._scripts());
  }

  getChats(): ChatSession[] {
    return this._chats();
  }

  saveChats(chats: ChatSession[]): void {
    const previous = this._chats();
    this._chats.set(chats);
    this.diffAndSync('chats', previous, chats, (id) => `${this.apiUrl}/data/chats/${id}`, () => this._chats());
  }

  getSettings(): AppSettings {
    return this._settings();
  }

  saveSettings(settings: AppSettings): void {
    console.debug('[StorageService] saveSettings:', settings);
    this._settings.set(settings);
    // Keeps this device's own per-device tracker current on every write —
    // covers both the ordinary pack-switcher flow and the pack-switch
    // banner's "Switch" resolution, in one place (see reconcileActivePackId).
    if (settings.activePackId) localStorage.setItem(LOCAL_ACTIVE_PACK_KEY, settings.activePackId);
    void this.fire(`${this.apiUrl}/data/settings`, 'PUT', settings);
  }

  // ==========================================================================
  // Individual item API calls (for immediate backend persistence)
  // ==========================================================================

  /** Delete a single question from DynamoDB. Returns true on success. */
  async deleteQuestion(id: string): Promise<boolean> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(`${this.apiUrl}/data/questions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Delete a single pack from DynamoDB. Returns true on success. */
  async deletePack(id: string): Promise<boolean> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(`${this.apiUrl}/data/packs/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Delete a single script from DynamoDB. Returns true on success. */
  async deleteScript(id: string): Promise<boolean> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(`${this.apiUrl}/data/scripts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Delete a single chat session from DynamoDB. Returns true on success. */
  async deleteChat(id: string): Promise<boolean> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(`${this.apiUrl}/data/chats/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Update a single question in DynamoDB. Returns true on success. */
  async updateQuestion(question: Question): Promise<boolean> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(`${this.apiUrl}/data/questions/${question.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(question),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Persists a quiz attempt — in-progress or finished, distinguished by
   * `attempt.status`. Same route/full-overwrite semantics either way: the sk is
   * derived server-side from examSlug+startedAt+id, which stay fixed for the life
   * of a session, so repeated calls with the same attempt overwrite the same item. */
  async saveAttempt(attempt: QuizAttempt): Promise<boolean> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(`${this.apiUrl}/data/attempts/${attempt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(attempt),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Deletes an in-progress (or finished) attempt. examSlug/startedAt are required
   * as query params so the Lambda can reconstruct the exact sort key — DynamoDB
   * deletes are by full key, not by an arbitrary attribute filter. */
  async deleteAttempt(attempt: Pick<QuizAttempt, 'id' | 'examSlug' | 'startedAt'>): Promise<boolean> {
    try {
      const token = await this.getAuthToken();
      const params = new URLSearchParams({ examSlug: attempt.examSlug, startedAt: String(attempt.startedAt) });
      const res = await fetch(`${this.apiUrl}/data/attempts/${attempt.id}?${params}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Lists the user's quiz attempts (most recent first), optionally scoped to one exam. */
  async listAttempts(examSlug?: string): Promise<QuizAttempt[]> {
    try {
      const token = await this.getAuthToken();
      const query = examSlug ? `?examSlug=${encodeURIComponent(examSlug)}` : '';
      const res = await fetch(`${this.apiUrl}/data/attempts${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { attempts: QuizAttempt[] };
      return body.attempts ?? [];
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Remote API calls
  // ==========================================================================

  private async fetchAll(): Promise<ApiData> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(`${this.apiUrl}/data`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Failed to load data from the server (HTTP ${res.status}).`);
      }
      return await res.json() as ApiData;
    } catch (err) {
      console.error('[StorageService] fetchAll failed:', err);
      throw err instanceof Error ? err : new Error('Failed to load data from the server.');
    }
  }

  private async pushAll(data: { packs: Pack[]; questions: Question[]; scripts: Script[]; chats: ChatSession[]; settings: AppSettings }): Promise<void> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(`${this.apiUrl}/data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        throw new Error(`Failed to save data to the server (HTTP ${res.status}).`);
      }
      this.lastError.set(null);
      this.syncStatus.set('idle');
      this.lastSyncedAt.set(Date.now());
    } catch (err) {
      this.syncStatus.set('error');
      this.lastError.set(err instanceof Error ? err.message : 'Failed to save data to the server.');
      console.error('[StorageService] pushAll failed — changes are only saved locally:', err);
    }
  }

  /** Debounced per-item sync — see diffAndSync below. Keyed by `${kind}:${id}`
   * so concurrent edits to different items (or different entity types) debounce
   * independently instead of coalescing into one another. */
  private readonly pendingItemWrites = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => Promise<void> }>();

  private schedulePush(key: string, run: () => Promise<void>): void {
    const existing = this.pendingItemWrites.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingItemWrites.delete(key);
      void run();
    }, 500);
    this.pendingItemWrites.set(key, { timer, run });
  }

  /** Pushes only the items that actually changed since the last local
   * snapshot, one PUT per item, instead of overwriting every pack/question/
   * script/chat on every edit. This is what closes the stale-snapshot race:
   * previously, ANY edit anywhere triggered a full-dataset PUT of this
   * device's local copy, so an unrelated edit on device B could re-send B's
   * stale copy of an item device A had just changed, silently clobbering it.
   * With per-item pushes, B only ever touches the item it actually edited.
   * (Concurrent edits to the exact same item are a harder problem this does
   * not attempt to solve — last write wins there, same as before.) */
  private diffAndSync<T extends { id: string }>(
    kind: string,
    previous: readonly T[],
    next: readonly T[],
    url: (id: string) => string,
    currentList: () => readonly T[],
  ): void {
    const prevById = new Map(previous.map((item) => [item.id, item]));
    for (const item of next) {
      const before = prevById.get(item.id);
      if (before && JSON.stringify(before) === JSON.stringify(item)) continue;
      this.schedulePush(`${kind}:${item.id}`, async () => {
        const latest = currentList().find((i) => i.id === item.id);
        if (latest) await this.fire(url(item.id), 'PUT', latest);
      });
    }
  }

  /**
   * Cancels every pending debounced per-item write and pushes them all
   * immediately. The 500ms debounce above exists to coalesce rapid-fire
   * edits (e.g. typing) — but for a discrete, deliberate action like
   * reordering packs, waiting means a quick reload right after clicking can
   * silently drop the change (nothing flushes a pending setTimeout on
   * unload). Call this after actions where that gap would be surprising.
   */
  async flushPendingSync(): Promise<void> {
    const entries = [...this.pendingItemWrites.values()];
    if (entries.length === 0) return;
    this.pendingItemWrites.clear();
    for (const { timer } of entries) clearTimeout(timer);
    await Promise.all(entries.map((e) => e.run()));
  }

  /** Fire-and-forget HTTP request */
  private async fire(url: string, method: string, body?: unknown): Promise<void> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`Failed to save data to the server (HTTP ${res.status}).`);
      this.syncStatus.set('idle');
      this.lastError.set(null);
      this.lastSyncedAt.set(Date.now());
    } catch (err) {
      this.syncStatus.set('error');
      this.lastError.set(err instanceof Error ? err.message : 'Failed to save data to the server.');
      console.error('[StorageService] fire failed — changes are only saved locally:', err);
    }
  }

  // ==========================================================================
  // localStorage read (for migration only)
  // ==========================================================================

  private readLocalPacks(): Pack[] {
    const raw = localStorage.getItem(KEY_PACKS);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Pack[];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: typeof (p as any).description === 'string' ? (p as any).description : '',
          version: typeof p.version === 'string' ? p.version : '',
          domains: Array.isArray(p.domains) ? p.domains.map(deserializeDomain).filter((d): d is PackDomain => !!d) : [],
          color: typeof p.color === 'string' && p.color ? p.color : DEFAULT_PACK_COLOR,
          createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
          updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now(),
          exportIntroQuestions: typeof (p as any).exportIntroQuestions === 'string' ? (p as any).exportIntroQuestions : undefined,
          exportIntroTranscripts: typeof (p as any).exportIntroTranscripts === 'string' ? (p as any).exportIntroTranscripts : undefined,
          exportIntroChat: typeof (p as any).exportIntroChat === 'string' ? (p as any).exportIntroChat : undefined,
        }));
    } catch { return []; }
  }

  private readLocalQuestions(): Question[] {
    const raw = localStorage.getItem(KEY_QUESTIONS);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Question[];
      return Array.isArray(parsed)
        ? parsed.filter((q) => q && typeof q.id === 'string' && typeof q.packId === 'string')
        : [];
    } catch { return []; }
  }

  private readLocalScripts(): Script[] {
    const raw = localStorage.getItem(KEY_SCRIPTS);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Script[];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((s) => s && typeof s.id === 'string')
        .map((s) => ({
          id: s.id,
          title: typeof s.title === 'string' ? s.title : '',
          content: typeof s.content === 'string' ? s.content : '',
          sources: Array.isArray(s.sources) ? s.sources.filter((t): t is string => typeof t === 'string') : [],
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        }));
    } catch { return []; }
  }

  private readLocalSettings(): AppSettings {
    const raw = localStorage.getItem(KEY_SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return {
        theme: parsed.theme === 'dark' ? 'dark' : 'light',
        defaultModel: typeof parsed.defaultModel === 'string' && parsed.defaultModel ? parsed.defaultModel : DEFAULT_SETTINGS.defaultModel,
        importExtractionModel:
          typeof parsed.importExtractionModel === 'string' && parsed.importExtractionModel
            ? parsed.importExtractionModel
            : DEFAULT_SETTINGS.importExtractionModel,
        activePackId: typeof parsed.activePackId === 'string' ? parsed.activePackId : DEFAULT_SETTINGS.activePackId,
        activeMethod:
          typeof parsed.activeMethod === 'string' && isStudyMethod(parsed.activeMethod)
            ? parsed.activeMethod
            : DEFAULT_SETTINGS.activeMethod,
        interfaceLanguage:
          typeof parsed.interfaceLanguage === 'string' && isInterfaceLanguage(parsed.interfaceLanguage)
            ? parsed.interfaceLanguage
            : DEFAULT_SETTINGS.interfaceLanguage,
        outputLanguage: typeof parsed.outputLanguage === 'string' ? parsed.outputLanguage : DEFAULT_SETTINGS.outputLanguage,
        translationTargetLanguage:
          typeof parsed.translationTargetLanguage === 'string'
            ? parsed.translationTargetLanguage
            : DEFAULT_SETTINGS.translationTargetLanguage,
        defaultReviewMode:
          typeof parsed.defaultReviewMode === 'string' && isReviewMode(parsed.defaultReviewMode)
            ? parsed.defaultReviewMode
            : DEFAULT_SETTINGS.defaultReviewMode,
        showCorrectInReview:
          typeof parsed.showCorrectInReview === 'boolean'
            ? parsed.showCorrectInReview
            : DEFAULT_SETTINGS.showCorrectInReview,
        defaultTrackTime:
          typeof parsed.defaultTrackTime === 'boolean' ? parsed.defaultTrackTime : DEFAULT_SETTINGS.defaultTrackTime,
        defaultUseAccommodation:
          typeof parsed.defaultUseAccommodation === 'boolean'
            ? parsed.defaultUseAccommodation
            : DEFAULT_SETTINGS.defaultUseAccommodation,
        hiddenNavTabs: Array.isArray(parsed.hiddenNavTabs)
          ? parsed.hiddenNavTabs.filter((id): id is NavTabId => NAV_ITEMS.some((item) => item.id === id))
          : DEFAULT_SETTINGS.hiddenNavTabs,
        navOrder: Array.isArray(parsed.navOrder)
          ? parsed.navOrder.filter((id): id is NavTabId => NAV_ITEMS.some((item) => item.id === id))
          : DEFAULT_SETTINGS.navOrder,
        hiddenQuizTools: Array.isArray(parsed.hiddenQuizTools)
          ? parsed.hiddenQuizTools.filter(isQuizToolId)
          : DEFAULT_SETTINGS.hiddenQuizTools,
        quizToolOrder: Array.isArray(parsed.quizToolOrder)
          ? parsed.quizToolOrder.filter(isQuizToolId)
          : DEFAULT_SETTINGS.quizToolOrder,
        quizToolbarRows:
          typeof parsed.quizToolbarRows === 'number' && Number.isFinite(parsed.quizToolbarRows)
            ? Math.max(1, Math.min(MAX_QUIZ_TOOLBAR_ROWS, Math.trunc(parsed.quizToolbarRows)))
            : DEFAULT_SETTINGS.quizToolbarRows,
      };
    } catch { return { ...DEFAULT_SETTINGS }; }
  }

  private clearLocalStorage(): void {
    try {
      localStorage.removeItem(KEY_PACKS);
      localStorage.removeItem(KEY_QUESTIONS);
      localStorage.removeItem(KEY_SCRIPTS);
      localStorage.removeItem(KEY_SETTINGS);
    } catch {}
  }
}
