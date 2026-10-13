import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { BankAuthor, BankAuthorDraft, sameAuthorName } from '../models/author.model';
import { BanksService } from './banks.service';
import { StorageService } from './storage.service';
import { newId } from '../utils/id.util';

/**
 * Bank authors shared by every certification. Banks store the author's name,
 * so this service keeps the two in step: renaming an author renames it on its
 * banks, deleting one reassigns its banks first, and any name used by a bank
 * without a record yet (banks created before authors existed, or typed in the
 * import flow) gets one automatically.
 */
@Injectable({ providedIn: 'root' })
export class AuthorsService {
  private readonly storage = inject(StorageService);
  private readonly banks = inject(BanksService);

  private readonly state = signal<BankAuthor[]>([]);

  /** Alphabetical, case-insensitive. */
  readonly authors = computed(() => [...this.state()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));

  /** Banks per author name, across every certification. */
  readonly bankCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const bank of this.banks.all()) {
      const author = this.byName(bank.author);
      if (author) counts.set(author.id, (counts.get(author.id) ?? 0) + 1);
    }
    return counts;
  });

  constructor() {
    effect(() => {
      if (!this.storage.ready()) return;
      const stored = this.storage.getAuthors();
      const bankNames = this.banks.all().map((b) => b.author);
      untracked(() => {
        this.state.set(stored);
        this.adoptBankNames(bankNames);
      });
    });
  }

  byName(name: string): BankAuthor | undefined {
    return name.trim() ? this.state().find((a) => sameAuthorName(a.name, name)) : undefined;
  }

  /** Returns the existing author with that name, or creates it. */
  ensure(name: string): BankAuthor | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    return this.byName(trimmed) ?? this.create({ name: trimmed, url: '', notes: '' });
  }

  create(draft: BankAuthorDraft): BankAuthor {
    const now = Date.now();
    const author: BankAuthor = { id: newId(), ...normalize(draft), createdAt: now, updatedAt: now };
    this.persist([...this.state(), author]);
    return author;
  }

  /** A new name is applied to every bank of this author. Fails (false) when another author already has that name. */
  update(id: string, draft: BankAuthorDraft): boolean {
    const current = this.state().find((a) => a.id === id);
    const next = normalize(draft);
    if (!current || !next.name) return false;
    const clash = this.byName(next.name);
    if (clash && clash.id !== id) return false;
    if (current.name !== next.name) this.banks.renameAuthor(current.name, next.name);
    this.persist(this.state().map((a) => (a.id === id ? { ...a, ...next, updatedAt: Date.now() } : a)));
    return true;
  }

  /** Reassigns the author's banks to `reassignTo` ('' = no author), then deletes the record. */
  async remove(id: string, reassignTo: string): Promise<boolean> {
    const author = this.state().find((a) => a.id === id);
    if (!author) return false;
    const ok = await this.storage.deleteItem('authors', id);
    if (!ok) return false;
    this.banks.renameAuthor(author.name, reassignTo);
    this.persist(this.state().filter((a) => a.id !== id));
    return true;
  }

  /** One record per distinct bank author name that has none yet. */
  private adoptBankNames(names: readonly string[]): void {
    const missing: string[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (trimmed && !this.byName(trimmed) && !missing.some((m) => sameAuthorName(m, trimmed))) missing.push(trimmed);
    }
    if (missing.length === 0) return;
    const now = Date.now();
    this.persist([...this.state(), ...missing.map((name) => ({ id: newId(), name, url: '', notes: '', createdAt: now, updatedAt: now }))]);
  }

  private persist(next: BankAuthor[]): void {
    this.state.set(next);
    this.storage.saveAuthors(next);
  }
}

function normalize(draft: BankAuthorDraft): BankAuthorDraft {
  return { name: draft.name.trim(), url: draft.url.trim(), notes: draft.notes.trim() };
}
