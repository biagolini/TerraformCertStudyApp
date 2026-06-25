import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { DEFAULT_MODEL } from '../models/settings.model';
import { PackContext, buildSystemPrompt } from '../utils/review-prompt.util';
import { buildTranscriptScriptPrompt } from '../utils/transcript-prompt.util';
import { AuthService } from './auth.service';

interface BedrockMessage {
  role: 'user' | 'assistant';
  content: Array<{ text: string }>;
}

/**
 * Talks to the API Gateway /converse endpoint, which invokes a Lambda that
 * calls Amazon Bedrock (Nova models) via converse_stream. Authentication is
 * done with the Cognito id token (Bearer). Responses are streamed as NDJSON.
 */
@Injectable({ providedIn: 'root' })
export class BedrockService {
  private readonly auth = inject(AuthService);

  async *streamReview(
    question: string,
    pack: PackContext,
    model: string | undefined,
    signal: AbortSignal,
    outputLanguage?: string,
  ): AsyncGenerator<string, void, void> {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) throw new Error('Question cannot be empty.');
    const system = buildSystemPrompt(pack, outputLanguage);
    yield* this.streamConverse(
      system,
      [{ role: 'user', content: [{ text: trimmedQuestion }] }],
      model,
      signal,
    );
  }

  async *streamTranscriptScript(
    transcripts: string[],
    model: string | undefined,
    signal: AbortSignal,
    outputLanguage?: string,
  ): AsyncGenerator<string, void, void> {
    const cleaned = transcripts.map((t) => t.trim()).filter((t) => t.length > 0);
    if (cleaned.length === 0) throw new Error('At least one transcript is required.');

    const system = buildTranscriptScriptPrompt(outputLanguage);
    const joined = cleaned
      .map((text, i) => `--- LESSON ${i + 1} TRANSCRIPT ---\n${text}`)
      .join('\n\n');
    const userMessage = `Below are ${cleaned.length} lesson transcript${cleaned.length === 1 ? '' : 's'}. Use them as the source material for the technical summary, following the format in your system instructions.\n\n${joined}`;

    yield* this.streamConverse(
      system,
      [{ role: 'user', content: [{ text: userMessage }] }],
      model,
      signal,
    );
  }

  async *streamRefineReview(
    currentReview: string,
    feedback: string,
    pack: PackContext,
    model: string | undefined,
    signal: AbortSignal,
    outputLanguage?: string,
  ): AsyncGenerator<string, void, void> {
    const trimmedFeedback = feedback.trim();
    if (!trimmedFeedback) throw new Error('Feedback cannot be empty.');
    if (!currentReview.trim()) throw new Error('No review to refine.');

    const system = buildSystemPrompt(pack, outputLanguage);
    const userMessage = `You previously generated the exam review below. Refine it based on the user's feedback while keeping the SAME OUTPUT FORMAT specified in your instructions.

=== CURRENT REVIEW ===
${currentReview}

=== USER FEEDBACK ===
${trimmedFeedback}

Return the FULL refined review. Apply only the changes needed to address the feedback; preserve everything else.`;

    yield* this.streamConverse(
      system,
      [{ role: 'user', content: [{ text: userMessage }] }],
      model,
      signal,
    );
  }

  private async *streamConverse(
    system: string,
    messages: BedrockMessage[],
    model: string | undefined,
    signal: AbortSignal,
  ): AsyncGenerator<string, void, void> {
    const token = this.auth.getIdToken();
    if (!token) throw new Error('Not authenticated. Please sign in again.');

    const response = await fetch(`${environment.apiUrl}/converse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model_id: model || DEFAULT_MODEL,
        system_prompt: system,
        messages,
        // max_tokens intentionally omitted: Bedrock then defaults to the
        // model's maximum allowed output (10K for Amazon Nova).
      }),
      signal,
    });

    if (!response.ok) {
      const message = await this.extractError(response);
      throw new Error(message);
    }
    if (!response.body) throw new Error('Streaming is not supported in this environment.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const text = parseNdjsonLine(line);
          if (text) yield text;
        }
      }
      if (buffer.trim()) {
        const text = parseNdjsonLine(buffer);
        if (text) yield text;
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  private async extractError(response: Response): Promise<string> {
    try {
      const text = await response.text();
      // Body may be NDJSON with an ERROR line, or plain JSON.
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        try {
          const evt = JSON.parse(line) as { type?: string; message?: string };
          if (evt.message) return evt.message;
        } catch {
          // not JSON, ignore
        }
      }
    } catch {
      // ignore
    }
    return `Request failed with status ${response.status}.`;
  }
}

/**
 * Parses a single NDJSON line from the Lambda stream.
 * Returns the token text for TOKEN events, throws for ERROR events,
 * and returns null for END/METADATA/empty lines.
 */
function parseNdjsonLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const evt = JSON.parse(trimmed) as { type?: string; text?: string; message?: string };
    if (evt.type === 'TOKEN') return evt.text ?? null;
    if (evt.type === 'ERROR') throw new Error(evt.message || 'Generation failed.');
    // END, METADATA, or unknown → no text
    return null;
  } catch (err) {
    // Re-throw ERROR events; ignore JSON parse failures on partial lines.
    if (err instanceof Error && err.message && !err.message.includes('JSON')) {
      throw err;
    }
    return null;
  }
}
