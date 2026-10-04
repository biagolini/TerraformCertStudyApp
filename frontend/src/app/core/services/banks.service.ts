import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { QuestionBank, QuestionBankDraft } from '../models/bank.model';
import { PacksService } from './packs.service';
import { StorageService } from './storage.service';
import { newId } from '../utils/id.util';

/** Author of the bank created on demand when the user adds a question before any bank exists. */
export const DEFAULT_BANK_AUTHOR = 'Me';

export interface BankAuthorGroup {
  author: string;
  banks: QuestionBank[];
}

@Injectable({ providedIn: 'root' })
export class BanksService {
  private readonly storage = inject(StorageService);
  private readonly packs = inject(PacksService);

  private readonly state = signal<QuestionBank[]>([]);

  readonly all = computed(() => [...this.state()].sort((a, b) => a.createdAt - b.createdAt));

  /** Banks of the active certification. */
  readonly banks = computed(() => {
    const packId = this.packs.activePack().id;
    return this.all().filter((b) => b.packId === packId);
  });

  /** Active certification's banks grouped by author, authors alphabetically, unnamed authors last. */
  readonly byAuthor = computed<BankAuthorGroup[]>(() => groupByAuthor(this.banks()));

  constructor() {
    effect(() => {
      if (this.storage.ready()) this.state.set(this.storage.getBanks().map(normalizeLegacy));
    });
  }

  forPack(packId: string): QuestionBank[] {
    return this.all().filter((b) => b.packId === packId);
  }

  getById(id: string): QuestionBank | undefined {
    return this.state().find((b) => b.id === id);
  }

  create(packId: string, draft: QuestionBankDraft): QuestionBank {
    const now = Date.now();
    const bank: QuestionBank = {
      id: newId(),
      packId,
      ...normalizeDraft(draft),
      createdAt: now,
      updatedAt: now,
    };
    this.persist([...this.state(), bank]);
    return bank;
  }

  update(id: string, draft: QuestionBankDraft): void {
    this.persist(
      this.state().map((b) => {
        if (b.id !== id) return b;
        const normalized = normalizeDraft(draft);
        return { ...b, ...normalized, updatedAt: Date.now() };
      }),
    );
  }

  /** Bumps a bank's updatedAt — called when one of its questions changes, so "last modified" stays honest. */
  touch(id: string): void {
    if (!this.getById(id)) return;
    this.persist(this.state().map((b) => (b.id === id ? { ...b, updatedAt: Date.now() } : b)));
  }

  /** Server-side delete cascades to the bank's questions; the local copy is purged to match. */
  async remove(id: string): Promise<boolean> {
    const ok = await this.storage.deleteItem('banks', id);
    if (!ok) return false;
    this.storage.purgeBankLocal(id);
    this.persist(this.state().filter((b) => b.id !== id));
    return true;
  }

  /** Returns the first bank of a certification, creating the default one if it has none yet. */
  ensureDefault(packId: string): QuestionBank {
    return this.forPack(packId)[0] ?? this.create(packId, { author: DEFAULT_BANK_AUTHOR, version: '', sourceUrl: '', description: '' });
  }

  private persist(next: QuestionBank[]): void {
    this.state.set(next);
    this.storage.saveBanks(next);
  }
}

export function groupByAuthor(banks: readonly QuestionBank[]): BankAuthorGroup[] {
  const groups = new Map<string, QuestionBank[]>();
  for (const bank of banks) {
    const key = bank.author.trim();
    const list = groups.get(key) ?? [];
    list.push(bank);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([author, list]) => ({ author, banks: list }));
}

/** Banks saved before banks lost their separate name: an old `name` becomes the author when no author was set. */
function normalizeLegacy(bank: QuestionBank): QuestionBank {
  const legacyName = (bank as QuestionBank & { name?: string }).name?.trim();
  return !bank.author?.trim() && legacyName ? { ...bank, author: legacyName } : bank;
}

function normalizeDraft(draft: QuestionBankDraft): QuestionBankDraft {
  return {
    author: draft.author.trim(),
    version: draft.version.trim(),
    sourceUrl: draft.sourceUrl.trim(),
    description: draft.description.trim(),
  };
}
