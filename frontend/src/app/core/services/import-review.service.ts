import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ImportDraftQuestion, normalizeDraftImages } from '../models/import-draft.model';
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
      this.draftsState.set((body.drafts ?? []).map(normalizeDraftImages));
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
    const normalized = normalizeDraftImages(body.draft);
    this.draftsState.update((drafts) => drafts.map((d) => (d.index === index ? normalized : d)));
    return {};
  }

  /** Real CloudWatch logs for the import-explain invocation that produced
   * this draft's Phase 2 failure (see the failed-draft "Show logs" button).
   * `requestId: null` means the backend had nothing to look up (draft never
   * reached or never failed Phase 2). */
  async getDraftLogs(
    jobId: string,
    index: number,
  ): Promise<{ requestId: string | null; events: { timestamp: number; message: string }[]; error?: string }> {
    const token = await this.auth.getValidToken();
    const res = await fetch(`${this.apiUrl}/data/imports/${jobId}/drafts/${index}/logs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { requestId: null, events: [], error: body.error || 'Failed to load logs.' };
    }
    return (await res.json()) as { requestId: string | null; events: { timestamp: number; message: string }[] };
  }

  /** Directly overwrites one draft's content with what the reviewer typed
   * — no AI call, for a quick correction. */
  async updateDraft(
    jobId: string,
    index: number,
    edits: Pick<
      ImportDraftQuestion,
      'title' | 'domain' | 'stem' | 'alternatives' | 'sourceGeneralComment' | 'images'
    >,
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
    const normalized = normalizeDraftImages(body.draft);
    this.draftsState.update((drafts) => drafts.map((d) => (d.index === index ? normalized : d)));
    return {};
  }

  /** Generates a short title from the given stem/alternatives — reads from
   * whatever the edit form currently holds (not the stored draft), so it
   * reflects unsaved edits too. Never persists anything; the caller fills
   * the title field, the reviewer still has to click Save. */
  async generateTitle(
    jobId: string,
    index: number,
    stem: string,
    alternatives: { text: string; isCorrect: boolean }[],
  ): Promise<{ title?: string; error?: string }> {
    const token = await this.auth.getValidToken();
    const res = await fetch(`${this.apiUrl}/data/imports/${jobId}/drafts/${index}/generate-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ stem, alternatives }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { error: body.error || 'Failed to generate a title.' };
    }
    const body = (await res.json()) as { title: string };
    return { title: body.title };
  }

  /** Starts Phase 2 (explanation generation, "Refine extraction with AI")
   * for every approved (successfully-extracted, not yet promoted) draft —
   * the backend's own default when draftIndices is omitted. The caller
   * navigates away afterward — ImportExamService's existing poller picks
   * up GENERATING progress on its next tick, no extra wiring needed here. */
  async startExplanations(jobId: string): Promise<{ error?: string }> {
    const token = await this.auth.getValidToken();
    const res = await fetch(`${this.apiUrl}/data/imports/${jobId}/generate-explanations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { error: body.error || 'Failed to start explanation generation.' };
    }
    return {};
  }

  /** "Save as is" — finalizes every approved draft directly into its final
   * Question using the extracted sourceComment/sourceGeneralComment text
   * verbatim as the explanation, no AI call at all. Synchronous; the
   * caller navigates away on success same as startExplanations. */
  async saveAsIs(jobId: string): Promise<{ error?: string; saved?: number }> {
    const token = await this.auth.getValidToken();
    const res = await fetch(`${this.apiUrl}/data/imports/${jobId}/save-as-is`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { error: body.error || 'Failed to save.' };
    }
    const body = (await res.json()) as { saved: number };
    return { saved: body.saved };
  }

  /** Removes one question from the review list entirely — a duplicate, a
   * chunk that shouldn't have been its own question, etc. */
  async deleteDraft(jobId: string, index: number): Promise<{ error?: string }> {
    const token = await this.auth.getValidToken();
    const res = await fetch(`${this.apiUrl}/data/imports/${jobId}/drafts/${index}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { error: body.error || 'Failed to delete.' };
    }
    this.draftsState.update((drafts) => drafts.filter((d) => d.index !== index));
    return {};
  }

  /** Adds a brand-new, blank question to the review list — for something
   * extraction missed. Starts FAILED (a friendly placeholder message, not
   * a real error) until the reviewer fills it in via edit mode. */
  async addDraft(jobId: string): Promise<{ draft?: ImportDraftQuestion; error?: string }> {
    const token = await this.auth.getValidToken();
    const res = await fetch(`${this.apiUrl}/data/imports/${jobId}/drafts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { error: body.error || 'Failed to add a new question.' };
    }
    const body = (await res.json()) as { draft: ImportDraftQuestion };
    const normalized = normalizeDraftImages(body.draft);
    this.draftsState.update((drafts) => [...drafts, normalized]);
    return { draft: normalized };
  }
}
