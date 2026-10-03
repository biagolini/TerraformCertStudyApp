import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Note, countWords, noteExcerpt } from '../models/note.model';
import { PacksService } from './packs.service';
import { StorageService } from './storage.service';
import { newId } from '../utils/id.util';

/**
 * Notes: metadata syncs like every other entity (`NOTE#` rows through
 * StorageService), while the Markdown body is read/written separately
 * through /data/notes/{id}/content, which the Lambda keeps in S3. Bodies are
 * cached in memory for the session so switching between notes is instant.
 */
@Injectable({ providedIn: 'root' })
export class NotesService {
  private readonly storage = inject(StorageService);
  private readonly packs = inject(PacksService);

  private readonly state = signal<Note[]>([]);
  private readonly bodies = new Map<string, string>();

  readonly all = computed(() => [...this.state()].sort((a, b) => b.updatedAt - a.updatedAt));

  /** Notes of the active certification, most recently edited first. */
  readonly notes = computed(() => {
    const packId = this.packs.activePack().id;
    return this.all().filter((n) => n.packId === packId);
  });

  constructor() {
    effect(() => {
      if (this.storage.ready()) this.state.set(this.storage.getNotes());
    });
  }

  getById(id: string): Note | undefined {
    return this.state().find((n) => n.id === id);
  }

  countFor(packId: string): number {
    return this.state().filter((n) => n.packId === packId).length;
  }

  /** Creates the metadata row immediately and the body on the first save. */
  async create(packId: string, title: string, body = '', tags: string[] = []): Promise<Note> {
    const now = Date.now();
    const note: Note = {
      id: newId(),
      packId,
      title: title.trim() || 'Untitled note',
      tags,
      excerpt: noteExcerpt(body),
      wordCount: countWords(body),
      createdAt: now,
      updatedAt: now,
    };
    this.persist([note, ...this.state()]);
    // The content PUT is validated against the metadata row, so that row
    // must be written first instead of waiting out the sync debounce.
    await this.storage.flushPendingSync();
    if (body) await this.saveBody(note.id, body);
    else this.bodies.set(note.id, '');
    return note;
  }

  updateMeta(id: string, patch: Partial<Pick<Note, 'title' | 'tags'>>): void {
    this.persist(
      this.state().map((n) =>
        n.id === id
          ? {
              ...n,
              ...(patch.title !== undefined ? { title: patch.title.trim() || n.title } : {}),
              ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
              updatedAt: Date.now(),
            }
          : n,
      ),
    );
  }

  /** Returns the cached body, or fetches it. Empty string for a note that has none yet. */
  async loadBody(id: string): Promise<string> {
    const cached = this.bodies.get(id);
    if (cached !== undefined) return cached;
    const res = await this.storage.apiFetch(`/data/notes/${encodeURIComponent(id)}/content`);
    if (res.status === 404) {
      this.bodies.set(id, '');
      return '';
    }
    if (!res.ok) throw new Error(`Failed to load the note (HTTP ${res.status}).`);
    const { markdown } = (await res.json()) as { markdown?: string };
    const body = markdown ?? '';
    this.bodies.set(id, body);
    return body;
  }

  /** Writes the body to S3 (through the API) and refreshes excerpt/word count on the metadata. */
  async saveBody(id: string, markdown: string): Promise<void> {
    const res = await this.storage.apiFetch(`/data/notes/${encodeURIComponent(id)}/content`, {
      method: 'PUT',
      body: JSON.stringify({ markdown }),
    });
    if (!res.ok) throw new Error(`Failed to save the note (HTTP ${res.status}).`);
    this.bodies.set(id, markdown);
    this.persist(
      this.state().map((n) =>
        n.id === id ? { ...n, excerpt: noteExcerpt(markdown), wordCount: countWords(markdown), updatedAt: Date.now() } : n,
      ),
    );
  }

  /** Uploads an image for this note and returns the reference to embed as `![alt](ref)`. */
  async uploadImage(id: string, file: File): Promise<string> {
    const res = await this.storage.apiFetch(`/data/notes/${encodeURIComponent(id)}/images`, {
      method: 'POST',
      body: JSON.stringify({ filename: file.name }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Failed to start the upload.');
    }
    const { ref, uploadUrl } = (await res.json()) as { ref: string; uploadUrl: string };
    const put = await fetch(uploadUrl, { method: 'PUT', body: file });
    if (!put.ok) throw new Error('Upload to storage failed.');
    return ref;
  }

  /** The API deletes the metadata row and the note's whole S3 prefix (body and images). */
  async remove(id: string): Promise<boolean> {
    const ok = await this.storage.deleteItem('notes', id);
    if (!ok) return false;
    this.bodies.delete(id);
    this.persist(this.state().filter((n) => n.id !== id));
    return true;
  }

  private persist(next: Note[]): void {
    this.state.set(next);
    this.storage.saveNotes(next);
  }
}

export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, 12);
}
