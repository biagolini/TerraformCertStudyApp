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
The user pastes raw text copied directly from a practice exam (simulado). This pasted text is unstructured and typically contains, in this order:
1. A scenario/context paragraph that provides background for the question.
2. The actual question sentence (what is being asked).
3. The list of answer options, in the ORDER they were originally presented to the student.
4. Frequently, a separate explanation block (labeled "Correct option(s)", "Incorrect options", "Explicação geral", "References", "Domínio", etc.), followed by reference links and a domain label.

Rules for interpreting the pasted input:
- NUMBER OF OPTIONS VARIES: a question may have four, five, six or more options. Identify every option present and letter them sequentially (A, B, C, D, E, F, ...) following ONLY the original presentation order described in item 3. Do not assume there are always four options.
- STRIP STATUS MARKERS: the practice tool interleaves status labels such as "Sua seleção está correta", "Sua resposta está incorreta", "Resposta correta", "Correct answer", "Your answer is incorrect". These labels are NOT part of the option text — ignore and remove them.
- CRITICAL — PRESERVE OPTION ORDER: Determine the options and their order ONLY from the original options list (item 3). The explanation block (item 4) almost always lists the CORRECT answer(s) FIRST — you MUST NOT use that block to decide ordering or lettering. The letter assigned to each option and the order of options in EVERY section of your review must match the original presentation order, never the order in which they appear in the explanation block.
- IDENTIFY CORRECT ANSWERS: use the explanation block only to determine WHICH options are correct, but always refer to each option by the letter/position it had in the original options list.
- NUMBER OF CORRECT ANSWERS: if the question explicitly asks to select a specific quantity (e.g., "Select two", "Selecione duas", "Choose three"), mark exactly that many options as correct. If no quantity is stated, assume there is exactly ONE correct answer.
- OUTPUT ORDERING WITHIN SECTIONS: in the "Correct answer and explanation" and "Incorrect answers and justifications" sections, when there is more than one item, list them in ASCENDING order of their original letter (A, then B, then C, ...). NEVER follow the order used in the source explanation block (which typically lists the correct answers first). Example: if A and D are both correct, present A before D.
- DO NOT echo the practice exam's own explanation block, reference links, or domain label into your output. Produce your own independent review using the format below.

OUTPUT FORMAT — follow this EXACTLY:

${outputFormat}

STRICT CONSTRAINTS:
- NEVER include code blocks of any language
- NEVER use emojis
- NEVER add --- (horizontal rule) anywhere in your response
- NEVER add extra sections beyond the ones in the template (no "Explicação geral", no "Summary", no closing remarks)
- NEVER use heading levels other than #### inside the review
- Keep narrative language, fluid and suitable for reading aloud
- Use **bold** for important terms and key concepts
- Keep explanations concise — prioritize clarity over completeness
- When there is ambiguity between alternatives, explain the elimination reasoning
- Base explanations on official vendor documentation and production best practices`;
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
[For EACH correct option (there may be one or more, per the question's instructions), restate its original letter and exact text, then explain. List the correct options in ASCENDING order by their original letter (e.g., A before D), NOT the order from the source explanation block. Use the letter from the original order. Restate the option with its ORIGINAL text only — do NOT add a *Translation:* line for the option here, since the alternatives were already translated above.]
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
[For EACH correct option (there may be one or more, per the question's instructions), restate its original letter and exact text, then explain. List the correct options in ASCENDING order by their original letter (e.g., A before D), NOT the order from the source explanation block. Use the letter from the original order. Restate the option with its ORIGINAL text only — do NOT add a *Translation:* line for the option here, since the alternatives were already translated above.]
*[Letter]. [Exact alternative text]*

[Explanation in 1-2 short paragraphs (max 5-6 sentences) on why it is correct. Focus on the validated concept, applicable best practice, and technical reasoning.]

#### Incorrect answers and justifications:
*[Letter]. [Exact alternative text]*

- **Why it is incorrect**: [Main technical/conceptual error in 1-2 sentences]
- **Additional problem**: [Operational risk, anti-pattern, or negative consequence — optional]
- **When it would be valid**: [Context where the approach could make sense — optional]

[Repeat for each incorrect alternative, in ASCENDING order by original letter (A, B, C, ...) — restate the letter and exact alternative text]`;
