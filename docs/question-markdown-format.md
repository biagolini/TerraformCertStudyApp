# Bulk-import Markdown format (+ a copy-paste AI conversion prompt)

A practical reference for the plain-Markdown shape the [bulk import pipeline](./question-import-pipeline.md) expects — for when a practice-exam source comes from a platform whose export doesn't match any of the three natively-supported shapes (PDF, this Markdown format, or the `<span>Pergunta N</span>`-marked HTML). Rather than teaching the pipeline every possible export format, the fastest fix for a one-off or rare format is usually to **convert it to this Markdown shape yourself** (by hand, with a throwaway script, or by pasting it into an AI assistant — see the prompt template below) and upload that instead.

This document describes the *target* format only. For how the pipeline itself works (chunking, extraction, review, explanation generation), see [question-import-pipeline.md](./question-import-pipeline.md).

## The format

```markdown
#### 1. Question

A regional airline wants to reduce cancellations caused by crew scheduling conflicts. The airline already collects historical crew, weather, and maintenance data.

Which approach is the MOST appropriate first step?

A. Purchase a generic off-the-shelf scheduling tool with no historical data integration.

**Explanation:** A generic tool with no data integration cannot learn from the airline's own historical patterns, so it will not reduce the specific conflicts described.

B. Build a machine learning model trained on the airline's historical crew, weather, and maintenance data.

**Correct answer.**

**Explanation:** Training on the airline's own historical data lets the model learn the specific patterns behind past conflicts, directly addressing the stated cause.

C. Hire additional scheduling staff to manually cross-check every assignment.

**Explanation:** Manual cross-checking does not scale with data volume and does not use the historical data the airline already collects.

D. Delay any scheduling changes until a formal AI governance policy is approved.

**Explanation:** Governance is important but is not itself a scheduling solution — this does not address the stated problem at all.

---

#### 2. Question

...
```

Rules, in order of how strictly the pipeline enforces them:

1. **One heading per question, `#### N. `** (or any `#`-`######` depth — only the leading `N. ` after the hashes matters). `N` must increase by one each time; the extraction model reads everything from one heading up to the next as a single question's material, so anything between two headings — including something you didn't mean to include — is treated as belonging to that question.
2. **The stem is everything between the heading and the first lettered alternative.** Copy it in full — a real exam stem is very often 2-4 paragraphs (scenario/context, constraints, what's already been tried, *then* the actual question sentence). Never trim it down to just the final sentence.
3. **Alternatives are `A. `, `B. `, `C. `, ...** — one per line/paragraph start, in order. The pipeline does not require exactly 4; use however many the source has.
4. **Mark the correct answer with explicit prose**, not color, bold-only emphasis, or position. `**Correct answer.**` (as in the example above) is the convention this doc recommends, but any unambiguous sentence works ("Correct option: B", "Resposta correta: B"). For a "select TWO/THREE" question, mark every correct option this same way — say so in the stem too (e.g. "(Select TWO.)").
5. **Explanations are optional, per-alternative or overall, or both** — whatever the source actually provides:
   - Per-alternative: a `**Explanation:**` paragraph directly after that option (shown above) — use this when the source explains *why each option specifically* is right or wrong.
   - Overall: a single explanation paragraph after all alternatives, covering the question as a whole, when the source doesn't break it down per option.
   - If the source has no explanation at all for a question, just omit it — never invent one. A later step (not this file) generates the final, student-facing explanation via AI regardless of what's captured here; what you provide here is reference material for that step, not the final text.
6. **Images**: reference an image with plain Markdown syntax, `![alt text](filename.png)`, using the same basename as an image file bundled in the ZIP alongside this `.md`. Don't nest images inside a `.zip`-relative path — just the filename.
7. **Separate questions with a line containing only `---`** (not required by the parser, but keeps a hand-edited or AI-generated file readable — every example in this doc uses it).
8. **Leave out anything that isn't the question itself**: a previous test-taker's own answer/status ("Incorrect", "Correto", "Ignored" — this describes what *someone else* answered before, not the right answer), trailing "References:" or "Check out these Cheat Sheets:" link dumps, nav chrome, or unrelated reference articles the export happened to include.

## Converting a non-standard export with an AI assistant

If you have a `.zip`/export from some other tool that doesn't match the format above, the prompt below is meant to be **copied as-is into an AI chat assistant** (Claude.ai, ChatGPT, Gemini, or similar) alongside the source file — the assistant does the conversion for you, and you save its Markdown output as a `.md` file, zip it (with any images) exactly like a normal bulk-import ZIP, and upload it through **Import exam file** as usual.

> I'm attaching an exam/quiz export file that does not follow the Markdown format my app's bulk importer expects. Please convert its content into that exact format and give me the result as a single Markdown code block I can copy, with no other commentary before or after it.
>
> Target format rules:
>
> 1. One heading per question: `#### N. Question` (N = 1, 2, 3, ... in order, matching the source's question order).
> 2. Immediately after the heading, the full question stem — copy it completely, including every scenario/context paragraph, not just the final question sentence. Do not summarize or shorten it.
> 3. Then every alternative, one per paragraph, formatted as `A. <text>`, `B. <text>`, etc., in the source's original order — however many the source has.
> 4. Immediately after the ONE correct alternative (or every correct one, if the question allows selecting more than one), add a line that says exactly: `**Correct answer.**`. Identify the correct answer only from the source's own explicit marking of it (an explanation that says it's correct, a "correct answer" label, a checkmark/highlighted box) — never guess.
> 5. If the question allows selecting more than one correct option, say so in the stem, e.g. append "(Select TWO.)", and mark every correct option per rule 4.
> 6. If the source provides an explanation for an alternative, add it directly after that alternative (and after its `**Correct answer.**` line, if any) as: `**Explanation:** <text>`. If the source instead gives one overall explanation for the whole question (not tied to a specific option), put that as a single `**Explanation:**` paragraph after all the alternatives instead. If the source gives no explanation at all for a question, add none — never invent one.
> 7. Do NOT include: any previous test-taker's own answer or result label (e.g. "Incorrect", "Correct", "Skipped", "Ignorado" shown next to an option — this reflects someone's past attempt, not the answer key), trailing "References" / "Learn more" / "Cheat sheet" link lists, navigation text, ads, or anything else that isn't part of the question itself. You may keep the visible text of an inline "learn more" link if it's part of an explanation sentence, but drop the link/URL itself.
> 8. Separate each question block from the next with a line containing only `---`.
> 9. If the source includes an image that is necessary to answer the question or understand an explanation, reference it as `![short description](original-filename.png)` at the point it belongs, using its original filename — do not invent a filename.
>
> Here is the source file / its content:
> [paste or attach the source file here]

## Related docs

- [Bulk import pipeline](./question-import-pipeline.md) — how a Markdown file in this format actually gets processed (chunking, extraction, review, explanation generation)
- [Question ingestion pipeline](./question-ingestion.md) — the single-question, "Add ready-made" flow, which accepts a similar but less strict Markdown review shape
