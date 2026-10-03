import { Injectable, computed, inject } from '@angular/core';
import { CertTrackStatus, EMPTY_PROFILE, StudentProfile } from '../models/profile.model';
import { Pack, ProviderCategory } from '../models/pack.model';
import { StorageService } from './storage.service';

/** The student profile (single `PROFILE` row). Reads straight from StorageService's signal. */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly storage = inject(StorageService);

  readonly profile = computed<StudentProfile>(() => ({ ...EMPTY_PROFILE, ...(this.storage.getProfile() ?? {}) }));
  readonly interests = computed(() => new Set<ProviderCategory>(this.profile().interests));
  readonly isEmpty = computed(() => this.storage.getProfile() === null);

  save(patch: Partial<StudentProfile>): void {
    this.storage.saveProfile({ ...this.profile(), ...patch, updatedAt: Date.now() });
  }

  /** Track key for a certification: its catalog id, or `pack:{id}` for a hand-made one. */
  trackKey(pack: Pick<Pack, 'id' | 'catalogId'>): string {
    return pack.catalogId || `pack:${pack.id}`;
  }

  statusOf(key: string): CertTrackStatus | null {
    return this.profile().tracks[key]?.status ?? null;
  }

  /** Sets (or clears, with null) the track status of a certification. */
  setStatus(key: string, status: CertTrackStatus | null): void {
    const tracks = { ...this.profile().tracks };
    if (status === null) delete tracks[key];
    else {
      const earnedDate =
        status === 'earned' ? (tracks[key]?.earnedDate ?? new Date().toISOString().slice(0, 10)) : tracks[key]?.earnedDate;
      tracks[key] = { ...tracks[key], status, earnedDate, updatedAt: Date.now() };
    }
    this.save({ tracks });
  }

  setTrackDate(key: string, field: 'earnedDate' | 'targetDate', value: string): void {
    const current = this.profile().tracks[key];
    if (!current) return;
    this.save({ tracks: { ...this.profile().tracks, [key]: { ...current, [field]: value || undefined, updatedAt: Date.now() } } });
  }

  toggleInterest(provider: ProviderCategory): void {
    const set = new Set(this.profile().interests);
    if (set.has(provider)) set.delete(provider);
    else set.add(provider);
    this.save({ interests: [...set] });
  }
}
