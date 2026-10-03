import { InterfaceLanguage } from '../models/i18n.model';
import { outputLanguageLabel } from '../models/settings.model';

/** InterfaceLanguage's codes ('en'|'pt'|'es'|'it') don't all match
 * OUTPUT_LANGUAGES' codes directly — Portuguese is `'pt-BR'` there, not
 * `'pt'` — so the interface language must be mapped before it's used as an
 * OUTPUT_LANGUAGES-compatible translation target. */
const INTERFACE_TO_OUTPUT_CODE: Record<InterfaceLanguage, string> = { en: 'en', pt: 'pt-BR', es: 'es', it: 'it' };

function baseCode(code: string): string {
  return code.split('-')[0].toLowerCase();
}

/** Resolves which language code the "Translate with AI" button should
 * target, given: an explicit user override (Settings' translationTargetLanguage,
 * empty string = "Automatic"), the question's own detected source language
 * (`Question.language`, missing on older data = assume 'en'), and the app's
 * interface language. Automatic mode targets the interface language, but
 * translating a question into the language it's ALREADY in is a useless
 * no-op — so it cascades through Portuguese, then English, until it finds a
 * language that actually differs from the source (compared by base code, so
 * `'pt-BR'` and `'pt'` are treated as the same language). Returns an
 * OUTPUT_LANGUAGES-compatible code either way, so outputLanguageLabel()
 * resolves a real display name instead of falling back to the raw code. */
export function resolveTranslationTargetCode(
  questionLanguage: string | undefined,
  interfaceLanguage: InterfaceLanguage,
  override: string,
): string {
  if (override) return override;
  const source = baseCode(questionLanguage || 'en');
  const candidates = [INTERFACE_TO_OUTPUT_CODE[interfaceLanguage], 'pt-BR', 'en'];
  for (const candidate of candidates) {
    if (baseCode(candidate) !== source) return candidate;
  }
  return 'en';
}

export function resolveTranslationTargetLabel(
  questionLanguage: string | undefined,
  interfaceLanguage: InterfaceLanguage,
  override: string,
): string {
  const code = resolveTranslationTargetCode(questionLanguage, interfaceLanguage, override);
  return outputLanguageLabel(code);
}

/**
 * System prompt for a single, non-streaming completion that translates an
 * already-reviewed question's content (stem/alternatives/comments/general
 * comment) into the user's interface language — see ReviewViewerComponent's
 * "Translate with AI" button. Structured JSON in, structured JSON out (same
 * shape) so the frontend can swap each field's displayed text in place
 * without disturbing the existing per-card layout or reveal-answer gating.
 */
export function buildTranslateReviewPrompt(targetLanguageLabel: string): string {
  return `You translate AI-generated certification exam review content into ${targetLanguageLabel}.

You will receive a JSON object with this shape:
{"stem": string, "alternatives": [{"letter": string, "text": string, "comment": string}], "generalComment": string | null}

Translate every string value (stem, each alternative's text and comment, generalComment) into
${targetLanguageLabel}. Preserve Markdown formatting exactly (headings, bold, italics, lists, code
spans, links, image references). Do not translate code identifiers, AWS/service names, or content
inside code spans/blocks. Preserve the JSON key names, the "letter" values, the array order, and
whether generalComment is null exactly as given.

STRICT OUTPUT RULES:
- Output ONLY the JSON object, nothing else. No markdown code fences, no explanation, no preamble.
- The output must be valid JSON with exactly the same shape as the input.`;
}
