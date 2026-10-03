import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Script } from '../models/script.model';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class ScriptsService {
  private readonly storage = inject(StorageService);

  private readonly state = signal<Script[]>([]);

  readonly scripts = computed(() =>
    [...this.state()].sort((a, b) => b.createdAt - a.createdAt),
  );
  readonly count = computed(() => this.state().length);

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

  clearAll(): void {
    this.persist([]);
  }

  getById(id: string): Script | undefined {
    return this.state().find((s) => s.id === id);
  }

  private persist(next: Script[]): void {
    this.state.set(next);
    this.storage.saveScripts(next);
  }
}
