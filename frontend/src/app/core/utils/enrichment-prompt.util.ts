import { ParsedAlternative } from './question-parse.util';

/**
 * System prompt for a single, non-streaming completion that extracts the vendor
 * services/products a question is actually about, from its already-parsed content.
 * Kept separate from review-prompt.util.ts since this runs once per saved question
 * (not during the main streamed review generation) and has a much narrower job.
 */
export function buildRelatedServicesPrompt(): string {
  return `You extract the specific named services or products a certification exam question is about.

Read the question and its alternatives. Output ONLY a JSON array of strings — the exact names of vendor
services/products referenced or clearly implied (e.g. "Amazon S3", "AWS Lambda", "Azure Functions",
"Claude", "Kubernetes"). Do not include generic concepts (e.g. "object storage", "high availability") —
only concrete named services/products.

STRICT OUTPUT RULES:
- Output ONLY the JSON array, nothing else. No markdown code fences, no explanation.
- If no specific named service/product is referenced, output [].
- Deduplicate. Use the vendor's official product name/casing (e.g. "Amazon EC2", not "ec2").
- Maximum 8 items.`;
}

export function buildRelatedServicesUserMessage(stem: string, alternatives: ParsedAlternative[]): string {
  const optionsText = alternatives.map((a) => `${a.letter}. ${a.text}`).join('\n');
  return `Question:\n${stem}\n\nAlternatives:\n${optionsText}`;
}
