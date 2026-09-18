import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ImportDraftQuestion } from '../models/import-draft.model';
import { AuthService } from './auth.service';

/** Backs the review screen only — job-scoped state that's only relevant
 * while that one page is mounted, unlike ImportExamService's always-on
 * root-level job list and background poller (a genuinely different
 * lifecycle: active from app boot regardless of route). A human reviewing
 * a static list doesn't need it to silently change under them, so this
 * service does no polling of its own. */
@Injectable({ providedIn: 'root' })
export class ImportReviewService {
  private readonly auth = inject(AuthService);
  private readonly apiUrl = environment.apiUrl;

  private readonly draftsState = signal<ImportDraftQuestion[]>([]);
  readonly drafts = this.draftsState.asReadonly();

  private readonly loadingState = signal(false);
  readonly loading = this.loadingState.asReadonly();

  async loadDrafts(jobId: string): Promise<void> {
    this.loadingState.set(true);
    try {
      const token = await this.auth.getValidToken();
      const res = await fetch(`${this.apiUrl}/data/imports/${jobId}/drafts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        this.draftsState.set([]);
        return;
      }
      const body = (await res.json()) as { drafts: ImportDraftQuestion[] };
      this.draftsState.set(body.drafts ?? []);
    } finally {
      this.loadingState.set(false);
    }
  }

  /** Re-runs structure extraction for exactly one question, optionally with
   * a correction hint — patches that one draft in place on success. */
  async reExtract(jobId: string, index: number, hint?: string): Promise<{ error?: string }> {
    const token = await this.auth.getValidToken();
    const res = await fetch(`${this.apiUrl}/data/imports/${jobId}/drafts/${index}/re-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(hint ? { hint } : {}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { error: body.error || 'Re-extract failed.' };
    }
    const body = (await res.json()) as { draft: ImportDraftQuestion };
    this.draftsState.update((drafts) => drafts.map((d) => (d.index === index ? body.draft : d)));
    return {};
  }

  /** Directly overwrites one draft's title/domain/stem/alternatives with
   * what the reviewer typed — no AI call, for a quick correction. */
  async updateDraft(
    jobId: string,
    index: number,
    edits: Pick<ImportDraftQuestion, 'title' | 'domain' | 'stem' | 'alternatives'>,
  ): Promise<{ error?: string }> {
    const token = await this.auth.getValidToken();
    const res = await fetch(`${this.apiUrl}/data/imports/${jobId}/drafts/${index}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(edits),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { error: body.error || 'Failed to save edits.' };
    }
    const body = (await res.json()) as { draft: ImportDraftQuestion };
    this.draftsState.update((drafts) => drafts.map((d) => (d.index === index ? body.draft : d)));
    return {};
  }

  /** Starts Phase 2 (explanation generation) for the given approved draft
   * indices. The caller navigates away afterward — ImportExamService's
   * existing poller picks up GENERATING progress on its next tick, no
   * extra wiring needed here. */
  async startExplanations(jobId: string, draftIndices: number[]): Promise<{ error?: string }> {
    const token = await this.auth.getValidToken();
    const res = await fetch(`${this.apiUrl}/data/imports/${jobId}/generate-explanations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ draftIndices }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { error: body.error || 'Failed to start explanation generation.' };
    }
    return {};
  }
}
