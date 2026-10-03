import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Script } from '../models/script.model';
import { StorageService } from './storage.service';
import { PacksService } from './packs.service';

@Injectable({ providedIn: 'root' })
export class ScriptsService {
  private readonly storage = inject(StorageService);
  private readonly packs = inject(PacksService);

  private readonly state = signal<Script[]>([]);

  /** Transcript summaries of the active certification, newest first. */
  readonly scripts = computed(() => {
    const packId = this.packs.activePack().id;
    return this.state()
      .filter((s) => s.packId === packId)
      .sort((a, b) => b.createdAt - a.createdAt);
  });
  readonly count = computed(() => this.scripts().length);

  constructor() {
    effect(() => {
      if (this.storage.ready()) {
        this.state.set(this.storage.getScripts());
      }
    });
  }

  add(script: Script): void {
    this.persist([script, ...this.state()]);
  }

  setContent(id: string, content: string): void {
    this.persist(
      this.state().map((s) => (s.id === id ? { ...s, content } : s)),
    );
  }

  appendToContent(id: string, chunk: string): void {
    if (!chunk) return;
    this.persist(
      this.state().map((s) => (s.id === id ? { ...s, content: s.content + chunk } : s)),
    );
  }

  updatePartial(id: string, partial: Partial<Pick<Script, 'title' | 'content'>>): void {
    this.persist(this.state().map((s) => (s.id === id ? { ...s, ...partial } : s)));
  }

  remove(id: string): void {
    void this.storage.deleteScript(id);
    this.persist(this.state().filter((s) => s.id !== id));
  }

  /** Deletes every transcript of the active certification. */
  clearAll(): void {
    const mine = this.scripts();
    for (const script of mine) void this.storage.deleteScript(script.id);
    const ids = new Set(mine.map((s) => s.id));
    this.persist(this.state().filter((s) => !ids.has(s.id)));
  }

  getById(id: string): Script | undefined {
    return this.state().find((s) => s.id === id);
  }

  private persist(next: Script[]): void {
    this.state.set(next);
    this.storage.saveScripts(next);
  }
}
