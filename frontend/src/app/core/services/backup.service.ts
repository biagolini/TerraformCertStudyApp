import { Injectable, inject } from '@angular/core';
import { StorageService } from './storage.service';
import { NotesService } from './notes.service';

export const BACKUP_FORMAT = 'cert-study-backup';
export const BACKUP_VERSION = 1;

/**
 * Full export of the user's data as one JSON file: certifications, banks,
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

  async download(onProgress?: (done: number, total: number) => void): Promise<void> {
    const blob = await this.build(onProgress);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cert-study-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
