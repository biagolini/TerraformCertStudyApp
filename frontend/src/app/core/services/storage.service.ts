import { Injectable, signal } from '@angular/core';
import { Question } from '../models/question.model';
import { Pack } from '../models/pack.model';
import { QuestionBank } from '../models/bank.model';
import { Note } from '../models/note.model';
import { StudentProfile } from '../models/profile.model';
import { Script } from '../models/script.model';
import { ChatSession } from '../models/chat.model';
import { QuizAttempt } from '../models/quiz-attempt.model';
import { AppSettings, DEFAULT_SETTINGS } from '../models/settings.model';
import { environment } from '../../../environments/environment';

interface ApiData {
  packs: Pack[];
  banks?: QuestionBank[];
  questions: Question[];
  scripts: Script[];
  chats?: ChatSession[];
  notes?: Note[];
  settings: AppSettings | null;
  profile?: StudentProfile | null;
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

  private _packs = signal<Pack[]>([]);
  private _banks = signal<QuestionBank[]>([]);
  private _notes = signal<Note[]>([]);
  private _profile = signal<StudentProfile | null>(null);
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

  /** Called by AuthService after successful login: loads the user's whole dataset from the API. */
  async initialize(idToken: string): Promise<void> {
    this.token = idToken;
    const remote = await this.fetchAll();
    this.applyRemote(remote);
    this.ready.set(true);
    this.attachVisibilityListener();
  }

  private applyRemote(remote: ApiData): void {
    this._packs.set(remote.packs ?? []);
    this._banks.set(remote.banks ?? []);
    this._questions.set(remote.questions ?? []);
    this._scripts.set(remote.scripts ?? []);
    this._chats.set(remote.chats ?? []);
    this._notes.set(remote.notes ?? []);
    this._profile.set(remote.profile ?? null);
    const merged = remote.settings ? { ...DEFAULT_SETTINGS, ...remote.settings } : { ...DEFAULT_SETTINGS };
    this._settings.set(merged);
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
      this.applyRemote(remote);
      this.syncStatus.set('idle');
      this.lastError.set(null);
      this.lastSyncedAt.set(Date.now());
    } catch (err) {
      this.syncStatus.set('error');
      this.lastError.set(err instanceof Error ? err.message : 'Failed to sync with the server.');
      console.error('[StorageService] refresh failed:', err);
    }
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

  getBanks(): QuestionBank[] {
    return this._banks();
  }

  saveBanks(banks: QuestionBank[]): void {
    const previous = this._banks();
    this._banks.set(banks);
    this.diffAndSync('banks', previous, banks, (id) => `${this.apiUrl}/data/banks/${id}`, () => this._banks());
  }

  getNotes(): Note[] {
    return this._notes();
  }

  saveNotes(notes: Note[]): void {
    const previous = this._notes();
    this._notes.set(notes);
    this.diffAndSync('notes', previous, notes, (id) => `${this.apiUrl}/data/notes/${id}`, () => this._notes());
  }

  getProfile(): StudentProfile | null {
    return this._profile();
  }

  saveProfile(profile: StudentProfile): void {
    this._profile.set(profile);
    this.schedulePush('profile', () => this.fire(`${this.apiUrl}/data/profile`, 'PUT', this._profile()));
  }

  /** Drops everything that belongs to a deleted certification from the local
   * copy. The backend's DELETE /data/packs/{id} cascades on its own, so
   * nothing here is pushed. */
  purgePackLocal(packId: string): void {
    this._banks.set(this._banks().filter((b) => b.packId !== packId));
    this._questions.set(this._questions().filter((q) => q.packId !== packId));
    this._scripts.set(this._scripts().filter((s) => s.packId !== packId));
    this._chats.set(this._chats().filter((c) => c.packId !== packId));
    this._notes.set(this._notes().filter((n) => n.packId !== packId));
  }

  /** Same idea as purgePackLocal, for DELETE /data/banks/{id}, which cascades to the bank's questions. */
  purgeBankLocal(bankId: string): void {
    this._questions.set(this._questions().filter((q) => q.bankId !== bankId));
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
    void this.fire(`${this.apiUrl}/data/settings`, 'PUT', settings);
  }

  // ==========================================================================
  // Individual item API calls (for immediate backend persistence)
  // ==========================================================================

  /** Authenticated request against the API (same token handling as the sync
   * layer) for endpoints that are not plain entity sync, e.g. note bodies. */
  async apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAuthToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(`${this.apiUrl}${path}`, { ...init, headers });
  }

  /** DELETE /data/{collection}/{id}. Returns true on success. */
  async deleteItem(collection: 'banks' | 'notes', id: string): Promise<boolean> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(`${this.apiUrl}/data/${collection}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

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
}
