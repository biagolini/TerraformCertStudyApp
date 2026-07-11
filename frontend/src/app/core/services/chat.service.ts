import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { ChatMessage, ChatSession, DEFAULT_CHAT_TITLE } from '../models/chat.model';
import { PacksService } from './packs.service';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly storage = inject(StorageService);
  private readonly packs = inject(PacksService);

  private readonly state = signal<ChatSession[]>([]);

  readonly allSessions = computed(() =>
    [...this.state()].sort((a, b) => b.updatedAt - a.updatedAt),
  );

  readonly sessions = computed(() => {
    const activeId = this.packs.activePack().id;
    return this.allSessions().filter((s) => s.packId === activeId);
  });

  readonly count = computed(() => this.sessions().length);

  constructor() {
    effect(() => {
      if (this.storage.ready()) {
        this.state.set(this.storage.getChats());
      }
    });
  }

  create(packId: string): ChatSession {
    const now = Date.now();
    const session: ChatSession = {
      id: this.uuid(),
      packId,
      title: DEFAULT_CHAT_TITLE,
      messages: [],
      summary: '',
      summaryUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.persist([session, ...this.state()]);
    return session;
  }

  appendMessage(id: string, message: ChatMessage): void {
    this.persist(
      this.state().map((s) =>
        s.id === id ? { ...s, messages: [...s.messages, message], updatedAt: Date.now() } : s,
      ),
    );
  }

  appendToLastMessage(id: string, chunk: string): void {
    if (!chunk) return;
    this.persist(
      this.state().map((s) => {
        if (s.id !== id || s.messages.length === 0) return s;
        const messages = [...s.messages];
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = { ...last, content: last.content + chunk };
        return { ...s, messages, updatedAt: Date.now() };
      }),
    );
  }

  setSummary(id: string, summary: string): void {
    this.persist(
      this.state().map((s) =>
        s.id === id ? { ...s, summary, summaryUpdatedAt: Date.now() } : s,
      ),
    );
  }

  appendToSummary(id: string, chunk: string): void {
    if (!chunk) return;
    this.persist(
      this.state().map((s) => (s.id === id ? { ...s, summary: s.summary + chunk } : s)),
    );
  }

  updatePartial(id: string, partial: Partial<Pick<ChatSession, 'title'>>): void {
    this.persist(this.state().map((s) => (s.id === id ? { ...s, ...partial } : s)));
  }

  remove(id: string): void {
    void this.storage.deleteChat(id);
    this.persist(this.state().filter((s) => s.id !== id));
  }

  removeByPackId(packId: string): void {
    const toDelete = this.state().filter((s) => s.packId === packId);
    for (const s of toDelete) {
      void this.storage.deleteChat(s.id);
    }
    this.persist(this.state().filter((s) => s.packId !== packId));
  }

  clearActivePack(): void {
    const activeId = this.packs.activePack().id;
    this.removeByPackId(activeId);
  }

  getById(id: string): ChatSession | undefined {
    return this.state().find((s) => s.id === id);
  }

  private persist(next: ChatSession[]): void {
    this.state.set(next);
    this.storage.saveChats(next);
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
