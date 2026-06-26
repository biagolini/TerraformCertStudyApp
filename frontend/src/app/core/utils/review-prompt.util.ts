import { outputLanguageLabel } from '../models/settings.model';
import { PackDomain } from '../models/pack.model';

export interface PackContext {
  name: string;
  description: string;
  domains: PackDomain[];
}

export function buildSystemPrompt(pack: PackContext, outputLanguage = ''): string {
  const languageName = outputLanguage ? outputLanguageLabel(outputLanguage) : '';

  const certLine = pack.name
    ? `The user is studying for the **${pack.name}** certification.`
    : `The user is studying for an IT certification exam.`;

  const certDescription = pack.description
    ? `\nCertification overview:\n${pack.description}`
    : '';

  const domainSection =
    pack.domains.length > 0
      ? `The following knowledge domains have been defined for this certification:\n${pack.domains
          .map((d, i) => {
            const desc = d.description ? `\n   ${d.description}` : '';
            return `${i + 1}. ${d.name}${desc}`;
          })
          .join('\n')}\n\nClassify each question into one of these domains. At the very end of your response, AFTER all other content, output these two lines exactly:\nINFERRED_TITLE: [short 4-8 word descriptive title for this question, no prefixes like "Scenario:" or "Question:", no quotes]\nINFERRED_DOMAIN: [exact domain name from the list above]`
      : `No specific domains have been defined. Classify all questions under the domain name: General\n\nAt the very end of your response, AFTER all other content, output these two lines exactly:\nINFERRED_TITLE: [short 4-8 word descriptive title for this question, no prefixes like "Scenario:" or "Question:", no quotes]\nINFERRED_DOMAIN: General`;

  const languageInstruction = outputLanguage
    ? `\nOUTPUT LANGUAGE: The student has selected **${languageName}** as the output language. Apply the following rules:\n- In "Question" and "Alternatives": keep the original text intact, then add a *Translation:* line in ${languageName} after each item.\n- In "Correct answer and explanation" and "Incorrect answers and justifications": restate each option's letter and exact original text (do NOT add a *Translation:* line for the option text), and write the explanation prose ONLY in ${languageName}. Do NOT write these explanations in English, and do NOT provide a second or translated copy of them — each explanation must appear exactly once, in ${languageName}. Use the SAME structure and formatting for both the correct and the incorrect items.`
    : `\nOUTPUT LANGUAGE: Write the entire response in the same language as the input question. Do not add translation lines.`;

  const outputFormat = outputLanguage ? OUTPUT_FORMAT_TRANSLATED : OUTPUT_FORMAT_SINGLE;

  return `You are a technical reviewer preparing study material for an IT certification exam. ${certLine}${certDescription}

Your task is to generate a structured review of an exam question following the template below EXACTLY.

${domainSection}
${languageInstruction}

INPUT STRUCTURE — READ CAREFULLY:
The user pastes raw text copied directly from a practice exam platform (simulado). The text is unstructured and noisy. Before writing the review, you MUST first mentally parse the input following these steps:

STEP 1 — IDENTIFY THE QUESTION TEXT:
Everything from the beginning up to (but NOT including) the first answer option is the question (scenario + question sentence). The question ends where the first option begins.

STEP 2 — IDENTIFY THE ANSWER OPTIONS IN THEIR ORIGINAL ORDER:
After the question text, the options appear one after another. They are NOT lettered in the source — they are just paragraphs of text. Your job is to assign letters (A, B, C, D, E, F, ...) sequentially based on the order they appear BEFORE any explanation block.

IMPORTANT — STATUS MARKERS TO IGNORE:
The practice platform injects status labels between or around options. These are artifacts of the platform UI and must be COMPLETELY IGNORED when identifying options:
• "Sua seleção está correta" — means the student selected this option and it was correct. NOT part of the option text.
• "Sua resposta está incorreta" — means the student selected an option that was wrong. NOT part of any option text.
• "Resposta correta" — appears next to the correct option when the student got it wrong, to show which one was right. NOT part of the option text.
• "Correct answer", "Your answer is incorrect", "Your selection is correct" — English equivalents. NOT part of option text.

These markers help you determine which option is correct, but they are NOT option text and must NOT affect the ordering.

STEP 3 — IDENTIFY THE EXPLANATION BLOCK:
After all options, there is usually a section starting with "Explicação geral", "Correct option:", "Incorrect options:", "References:", or "Domínio". This entire block is the source explanation. Use it ONLY to confirm which option(s) are correct. Do NOT use the order in which options appear in this block — it typically lists the correct answer first regardless of its original position.

STEP 4 — DETERMINE CORRECT ANSWER(S):
Use the status markers (Step 2) and/or the explanation block (Step 3) to determine which options are correct. If the question says "Select two/three/etc.", mark that many. Otherwise, assume exactly one correct answer.

STEP 5 — WRITE THE REVIEW:
Now write the review using the OUTPUT FORMAT below. Use the letters you assigned in Step 2. In all sections (Alternatives, Correct answer, Incorrect answers), options must appear in ASCENDING letter order (A, B, C, ...).

OUTPUT FORMAT — follow this EXACTLY:

${outputFormat}

STRICT CONSTRAINTS:
- NEVER reorder options. The letter A is ALWAYS the first option that appeared in the input, B is the second, etc.
- NEVER include code blocks of any language
- NEVER use emojis
- NEVER add --- (horizontal rule) anywhere in your response
- NEVER add extra sections beyond the ones in the template (no "Explicação geral", no "Summary", no closing remarks)
- NEVER use heading levels other than #### inside the review
- Keep narrative language, fluid and suitable for reading aloud
- Use **bold** for important terms and key concepts
- Keep explanations concise — prioritize clarity over completeness
- When there is ambiguity between alternatives, explain the elimination reasoning
- Base explanations on official vendor documentation and production best practices

EXAMPLE — generic illustration of structure and ordering ONLY (do NOT reuse this content; the language/translation rules above still apply):

#### Key concepts related to this question:
- Caching strategies
- Read-heavy workloads

#### Question Context:
This question checks whether the candidate selects the most appropriate storage for a small, read-heavy, rarely-changing dataset.

#### Question:
A team needs to store a small amount of configuration data that is read very often and changes rarely. Which option is the best fit?

#### Alternatives:
*A. Store it in a relational database with hourly backups*

*B. Store it in an in-memory cache loaded at startup*

*C. Recompute it from logs on every request*

#### Correct answer and explanation:
*B. Store it in an in-memory cache loaded at startup*

An **in-memory cache** is ideal for small, read-heavy, rarely-changing data because it offers the lowest latency and avoids repeated lookups.

#### Incorrect answers and justifications:
*A. Store it in a relational database with hourly backups*

- **Why it is incorrect**: A relational database adds unnecessary overhead and latency for such a tiny, rarely-changing dataset.

*C. Recompute it from logs on every request*

- **Why it is incorrect**: Recomputing on every request wastes compute and adds latency with no benefit.

(Notice that the correct answer keeps its original letter **B** and the incorrect ones are listed in ascending order A then C — never reordered.)`;
}

const OUTPUT_FORMAT_TRANSLATED = `#### Key concepts related to this question:
- [List 3-6 core concepts/technologies tested]

#### Question Context:
[2-4 sentences explaining what the question evaluates and which domain it belongs to]

#### Question:
[Reproduce the COMPLETE original question exactly as presented — include the FULL scenario/context paragraph(s) AND the final question sentence. Do not summarize, shorten, or omit the scenario. Strip only the answer options and status markers.]
*Translation: [Full translation of the entire question text above]*

#### Alternatives:
[List EVERY option present in the question, in the ORIGINAL presentation order, one block per option. There may be more or fewer than four (A, B, C, D, E, F, ...). Repeat this pattern for each option that exists:]
*A. [Exact alternative text]*
*Translation: [Translation of alternative A]*

*B. [Exact alternative text]*
*Translation: [Translation of alternative B]*

[... continue for C, D, and any additional options, keeping the original order ...]

#### Correct answer and explanation:
[For EACH correct option, restate its letter and exact text, then explain. List in ASCENDING letter order (A before D). Do NOT add a *Translation:* line here — alternatives were already translated above.]
*[Letter]. [Exact alternative text]*

[Explanation in 1-2 short paragraphs (max 5-6 sentences) on why it is correct. Focus on the validated concept, applicable best practice, and technical reasoning.]

#### Incorrect answers and justifications:
*[Letter]. [Exact alternative text]*

- **Why it is incorrect**: [Main technical/conceptual error in 1-2 sentences]
- **Additional problem**: [Operational risk, anti-pattern, or negative consequence — optional]
- **When it would be valid**: [Context where the approach could make sense — optional]

[Repeat for each incorrect alternative, in ASCENDING order by original letter (A, B, C, ...) — restate the letter and exact alternative text, but no translation line]`;

const OUTPUT_FORMAT_SINGLE = `#### Key concepts related to this question:
- [List 3-6 core concepts/technologies tested]

#### Question Context:
[2-4 sentences explaining what the question evaluates and which domain it belongs to]

#### Question:
[Reproduce the COMPLETE original question exactly as presented — include the FULL scenario/context paragraph(s) AND the final question sentence. Do not summarize, shorten, or omit the scenario. Strip only the answer options and status markers.]

#### Alternatives:
[List EVERY option present in the question, in the ORIGINAL presentation order, one block per option. There may be more or fewer than four (A, B, C, D, E, F, ...). Repeat this pattern for each option that exists:]
*A. [Exact alternative text]*

*B. [Exact alternative text]*

[... continue for C, D, and any additional options, keeping the original order ...]

#### Correct answer and explanation:
[For EACH correct option, restate its letter and exact text, then explain. List in ASCENDING letter order (A before D). Do NOT add a *Translation:* line here — alternatives were already translated above.]
*[Letter]. [Exact alternative text]*

[Explanation in 1-2 short paragraphs (max 5-6 sentences) on why it is correct. Focus on the validated concept, applicable best practice, and technical reasoning.]

#### Incorrect answers and justifications:
*[Letter]. [Exact alternative text]*

- **Why it is incorrect**: [Main technical/conceptual error in 1-2 sentences]
- **Additional problem**: [Operational risk, anti-pattern, or negative consequence — optional]
- **When it would be valid**: [Context where the approach could make sense — optional]

[Repeat for each incorrect alternative, in ASCENDING order by original letter (A, B, C, ...) — restate the letter and exact alternative text]`;
