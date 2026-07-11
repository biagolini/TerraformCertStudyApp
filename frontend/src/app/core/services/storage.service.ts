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
import { AppSettings, DEFAULT_SETTINGS } from '../models/settings.model';
import { isStudyMethod } from '../models/method.model';
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

interface ApiData {
  packs: Pack[];
  questions: Question[];
  scripts: Script[];
  chats?: ChatSession[];
  settings: AppSettings | null;
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  /** Signal that resolves to true once remote data has been loaded. */
  readonly ready = signal(false);

  private _packs = signal<Pack[]>([]);
  private _questions = signal<Question[]>([]);
  private _scripts = signal<Script[]>([]);
  private _chats = signal<ChatSession[]>([]);
  private _settings = signal<AppSettings>({ ...DEFAULT_SETTINGS });

  private token: string | null = null;
  private apiUrl = environment.apiUrl;

  /**
   * Called by AuthService after successful login.
   * Loads remote data, migrates localStorage if needed.
   */
  async initialize(idToken: string): Promise<void> {
    this.token = idToken;

    const remote = await this.fetchAll();
    const hasRemoteData = remote.packs.length > 0 || remote.questions.length > 0 || remote.scripts.length > 0 || (remote.chats?.length ?? 0) > 0 || remote.settings !== null;

    if (hasRemoteData) {
      // Use DynamoDB as source of truth
      this._packs.set(remote.packs);
      this._questions.set(remote.questions);
      this._scripts.set(remote.scripts);
      this._chats.set(remote.chats ?? []);
      this._settings.set(remote.settings ?? { ...DEFAULT_SETTINGS });
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
  }

  /** Update token when refreshed */
  updateToken(token: string): void {
    this.token = token;
  }

  // ==========================================================================
  // Public API — same interface as before
  // ==========================================================================

  getQuestions(): Question[] {
    return this._questions();
  }

  saveQuestions(questions: Question[]): void {
    this._questions.set(questions);
    this.syncPutAll();
  }

  clearQuestions(): void {
    this._questions.set([]);
    this.syncPutAll();
  }

  getPacks(): Pack[] {
    return this._packs();
  }

  savePacks(packs: Pack[]): void {
    this._packs.set(packs);
    this.syncPutAll();
  }

  getScripts(): Script[] {
    return this._scripts();
  }

  saveScripts(scripts: Script[]): void {
    this._scripts.set(scripts);
    this.syncPutAll();
  }

  getChats(): ChatSession[] {
    return this._chats();
  }

  saveChats(chats: ChatSession[]): void {
    this._chats.set(chats);
    this.syncPutAll();
  }

  getSettings(): AppSettings {
    return this._settings();
  }

  saveSettings(settings: AppSettings): void {
    this._settings.set(settings);
    this.fire(`${this.apiUrl}/data/settings`, 'PUT', settings);
  }

  // ==========================================================================
  // Individual item API calls (for immediate backend persistence)
  // ==========================================================================

  /** Delete a single question from DynamoDB. Returns true on success. */
  async deleteQuestion(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/data/questions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Delete a single pack from DynamoDB. Returns true on success. */
  async deletePack(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/data/packs/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Delete a single script from DynamoDB. Returns true on success. */
  async deleteScript(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/data/scripts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Delete a single chat session from DynamoDB. Returns true on success. */
  async deleteChat(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/data/chats/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Update a single question in DynamoDB. Returns true on success. */
  async updateQuestion(question: Question): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/data/questions/${question.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(question),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Remote API calls
  // ==========================================================================

  private async fetchAll(): Promise<ApiData> {
    try {
      const res = await fetch(`${this.apiUrl}/data`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) return { packs: [], questions: [], scripts: [], chats: [], settings: null };
      return await res.json() as ApiData;
    } catch {
      return { packs: [], questions: [], scripts: [], chats: [], settings: null };
    }
  }

  private async pushAll(data: { packs: Pack[]; questions: Question[]; scripts: Script[]; chats: ChatSession[]; settings: AppSettings }): Promise<void> {
    try {
      await fetch(`${this.apiUrl}/data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(data),
      });
    } catch {
      // Silently fail — data is still in memory
    }
  }

  /** Debounced full sync — writes all packs, questions, scripts to cloud */
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  private syncPutAll(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.pushAll({
        packs: this._packs(),
        questions: this._questions(),
        scripts: this._scripts(),
        chats: this._chats(),
        settings: this._settings(),
      });
    }, 500);
  }

  /** Fire-and-forget HTTP request */
  private fire(url: string, method: string, body?: unknown): void {
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => {});
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
        activePackId: typeof parsed.activePackId === 'string' ? parsed.activePackId : DEFAULT_SETTINGS.activePackId,
        activeMethod:
          typeof parsed.activeMethod === 'string' && isStudyMethod(parsed.activeMethod)
            ? parsed.activeMethod
            : DEFAULT_SETTINGS.activeMethod,
        outputLanguage: typeof parsed.outputLanguage === 'string' ? parsed.outputLanguage : DEFAULT_SETTINGS.outputLanguage,
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
