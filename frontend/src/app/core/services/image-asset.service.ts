import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/**
 * Resolves a question's relative image key (`{jobId}/{questionId}/{filename}`)
 * into a presigned S3 GET URL, cached in-memory per key for this session.
 * Presigned URLs expire after a few minutes — a page reload naturally clears
 * the cache, which is an accepted limitation rather than a bug.
 */
/** A resolved image is either still pending, permanently failed (bad key,
 * 404, network error — anything that isn't going to fix itself on its own),
 * or a real presigned URL. Consumers render a placeholder for 'error' rather
 * than silently showing nothing, so a broken image reference is visible
 * instead of invisible. */
export type ImageLoadState = 'pending' | 'error';

@Injectable({ providedIn: 'root' })
export class ImageAssetService {
  private readonly auth = inject(AuthService);
  private readonly cache = new Map<string, WritableSignal<string | ImageLoadState>>();
  private readonly fetchStarted = new Set<string>();

  /** Returns a signal for the resolved state — a pure read, safe to call
   * directly from a template. Does NOT trigger the network fetch itself
   * (see `ensureFetched`): `AuthService.getValidToken()` synchronously
   * writes a signal internally, and Angular's NG0600 guard forbids any
   * signal write while it's actively rendering a template, so kicking off
   * the fetch chain from here would throw (silently, since the caller
   * swallows it) on every single call. */
  resolve(relativeKey: string): Signal<string | ImageLoadState> {
    return this.getOrCreateSignal(relativeKey);
  }

  /** Actually triggers the presign fetch for a key, at most once. Call this
   * from a non-rendering reactive context (e.g. an `effect()`), never
   * directly from a template expression — see the note on `resolve()`. */
  ensureFetched(relativeKey: string): void {
    if (this.fetchStarted.has(relativeKey)) return;
    this.fetchStarted.add(relativeKey);
    void this.fetchPresignedUrl(relativeKey, this.getOrCreateSignal(relativeKey));
  }

  private getOrCreateSignal(relativeKey: string): WritableSignal<string | ImageLoadState> {
    let urlSignal = this.cache.get(relativeKey);
    if (!urlSignal) {
      urlSignal = signal<string | ImageLoadState>('pending');
      this.cache.set(relativeKey, urlSignal);
    }
    return urlSignal;
  }

  private async fetchPresignedUrl(
    relativeKey: string,
    urlSignal: WritableSignal<string | ImageLoadState>,
  ): Promise<void> {
    try {
      const token = await this.auth.getValidToken();
      const response = await fetch(
        `${environment.apiUrl}/data/assets/presign?key=${encodeURIComponent(relativeKey)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        urlSignal.set('error');
        return;
      }
      const body = (await response.json()) as { url?: string };
      urlSignal.set(body.url ?? 'error');
    } catch {
      urlSignal.set('error');
    }
  }
}
