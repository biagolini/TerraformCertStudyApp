import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { DEFAULT_MODEL, outputLanguageLabel } from '../models/settings.model';
import { PackContext, buildSystemPrompt } from '../utils/review-prompt.util';
import { buildTranscriptScriptPrompt } from '../utils/transcript-prompt.util';
import { buildChatSystemPrompt, buildChatSummaryPrompt } from '../utils/chat-prompt.util';
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

  async *streamChat(
    history: { role: 'user' | 'assistant'; content: string }[],
    pack: PackContext,
    model: string | undefined,
    signal: AbortSignal,
    outputLanguage?: string,
  ): AsyncGenerator<string, void, void> {
    if (history.length === 0) throw new Error('Conversation history cannot be empty.');
    const system = buildChatSystemPrompt(pack, outputLanguage);
    const messages: BedrockMessage[] = history.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));
    yield* this.streamConverse(system, messages, model, signal);
  }

  async *streamChatSummary(
    history: { role: 'user' | 'assistant'; content: string }[],
    existingSummary: string,
    pack: PackContext,
    model: string | undefined,
    signal: AbortSignal,
    outputLanguage?: string,
  ): AsyncGenerator<string, void, void> {
    if (history.length === 0) throw new Error('No conversation to summarize.');
    const system = buildChatSummaryPrompt(pack, outputLanguage);
    const transcript = history
      .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
      .join('\n\n');
    const previousSummaryBlock = existingSummary.trim()
      ? `\n\n=== EXISTING SUMMARY (update this with new content from the conversation below) ===\n${existingSummary.trim()}`
      : '';
    const userMessage = `Below is the full tutoring conversation. Produce the summary following your system instructions.${previousSummaryBlock}\n\n=== CONVERSATION ===\n${transcript}`;

    yield* this.streamConverse(
      system,
      [{ role: 'user', content: [{ text: userMessage }] }],
      model,
      signal,
    );
  }

  async generateTitle(
    sourceText: string,
    model: string | undefined,
    signal: AbortSignal,
    outputLanguage?: string,
  ): Promise<string> {
    const clean = sourceText.trim();
    if (!clean) throw new Error('No content to generate a title from.');
    const system = buildTitlePrompt(outputLanguage);
    let accumulated = '';
    for await (const chunk of this.streamConverse(
      system,
      [{ role: 'user', content: [{ text: clean.slice(0, 6000) }] }],
      model,
      signal,
    )) {
      accumulated += chunk;
    }
    return accumulated
      .trim()
      .replace(/^["'`*_\s]+|["'`*_\s]+$/g, '')
      .slice(0, 80)
      .trim();
  }

  private async *streamConverse(
    system: string,
    messages: BedrockMessage[],
    model: string | undefined,
    signal: AbortSignal,
  ): AsyncGenerator<string, void, void> {
    const token = await this.auth.getValidToken();

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

function buildTitlePrompt(outputLanguage?: string): string {
  const lang = outputLanguage
    ? `Write the title in ${outputLanguageLabel(outputLanguage)}.`
    : 'Write the title in the same language as the content.';
  return `You generate a concise title for an exam question study note. Read the content the user provides and output ONLY a short, descriptive title of 4 to 8 words capturing the main topic or scenario. ${lang}

STRICT OUTPUT RULES:
- Output only the title text, nothing else.
- No quotes, no markdown, no bullet points.
- No prefixes such as "Title:", "Question:", or "Scenario:".
- No trailing punctuation.
- No explanation or commentary.`;
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
