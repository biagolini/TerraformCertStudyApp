import { Injectable, inject } from '@angular/core';
import JSZip from 'jszip';
import { StorageService } from './storage.service';
import { NotesService } from './notes.service';
import { sameAuthorName } from '../models/author.model';

export const BACKUP_FORMAT = 'cert-study-backup';
export const BACKUP_VERSION = 1;

export const BACKUP_TABLES = ['certifications', 'banks', 'authors', 'questions', 'notes', 'transcripts', 'chats', 'attempts', 'settings', 'profile'] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
export type BackupCollections = Partial<Record<BackupTable, unknown>>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Full export of the user's data as one JSON file: certifications, banks, bank authors,
 * questions, notes (metadata and Markdown bodies), transcripts, chats,
 * mock-exam attempts, settings and profile. Question/note images stay in S3
 * and are referenced by key; they are not embedded.
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly storage = inject(StorageService);
  private readonly notes = inject(NotesService);

  async build(onProgress?: (done: number, total: number) => void): Promise<Blob> {
    const noteList = this.storage.getNotes();
    const notes = [];
    for (let i = 0; i < noteList.length; i++) {
      const note = noteList[i];
      const body = await this.notes.loadBody(note.id).catch(() => '');
      notes.push({ ...note, body });
      onProgress?.(i + 1, noteList.length);
    }
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      packs: this.storage.getPacks(),
      banks: this.storage.getBanks(),
      authors: this.storage.getAuthors(),
      questions: this.storage.getQuestions(),
      notes,
      scripts: this.storage.getScripts(),
      chats: this.storage.getChats(),
      attempts: await this.storage.listAttempts(),
      settings: this.storage.getSettings(),
      profile: this.storage.getProfile(),
    };
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  }

  /** Every table of the student's data, each as its own array (settings and
   * profile as one object). `packId` limits it to one certification: its
   * banks, their authors, questions, notes, transcripts, chats and attempts. */
  async collections(packId: string | null, onProgress?: (done: number, total: number) => void): Promise<BackupCollections> {
    const inPack = <T extends { packId: string }>(items: T[]): T[] => (packId ? items.filter((i) => i.packId === packId) : items);
    const noteList = inPack(this.storage.getNotes());
    const notes = [];
    for (let i = 0; i < noteList.length; i++) {
      const note = noteList[i];
      const body = await this.notes.loadBody(note.id).catch(() => '');
      notes.push({ ...note, body });
      onProgress?.(i + 1, noteList.length);
    }
    const banks = inPack(this.storage.getBanks());
    const authors = this.storage.getAuthors();
    return {
      certifications: packId ? this.storage.getPacks().filter((p) => p.id === packId) : this.storage.getPacks(),
      banks,
      authors: packId ? authors.filter((a) => banks.some((b) => sameAuthorName(b.author, a.name))) : authors,
      questions: inPack(this.storage.getQuestions()),
      notes,
      transcripts: inPack(this.storage.getScripts()),
      chats: inPack(this.storage.getChats()),
      attempts: inPack(await this.storage.listAttempts()),
      ...(packId ? {} : { settings: this.storage.getSettings(), profile: this.storage.getProfile() }),
    };
  }

  /** A ZIP with one `<table>.json` per table plus a `manifest.json` with the counts. */
  async downloadZip(packId: string | null, fileStem: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const data = await this.collections(packId, onProgress);
    const zip = new JSZip();
    const counts: Record<string, number> = {};
    for (const [name, value] of Object.entries(data)) {
      zip.file(`${name}.json`, JSON.stringify(value ?? null, null, 2));
      counts[name] = Array.isArray(value) ? value.length : value ? 1 : 0;
    }
    zip.file(
      'manifest.json',
      JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, layout: 'one-file-per-table', exportedAt: new Date().toISOString(), certificationId: packId, counts }, null, 2),
    );
    this.save(await zip.generateAsync({ type: 'blob' }), `${fileStem}-${today()}.zip`);
  }

  /** One table as a single JSON file. */
  async downloadTable(name: BackupTable, packId: string | null, fileStem: string): Promise<void> {
    const data = await this.collections(packId);
    this.save(new Blob([JSON.stringify(data[name] ?? null, null, 2)], { type: 'application/json' }), `${fileStem}-${name}-${today()}.json`);
  }

  private save(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async download(onProgress?: (done: number, total: number) => void): Promise<void> {
    this.save(await this.build(onProgress), `cert-study-backup-${today()}.json`);
  }
}
