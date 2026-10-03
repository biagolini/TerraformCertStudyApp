# Anthropic Study Assistant

A mobile-first study app for any IT certification exam (AWS, GCP, Azure, MongoDB, Anthropic CCAF, and others). Paste raw exam questions, receive AI-generated structured reviews via the Anthropic API, accumulate reviewed questions across sessions, and export selections as Markdown files ready for Google NotebookLM podcast generation.

**Live demo:** [https://biagolini.github.io/AngularAnthropicStudyAssistant/](https://biagolini.github.io/AngularAnthropicStudyAssistant/)

**Author:** Carlos Biagolini-Jr.
**LinkedIn:** [linkedin.com/in/biagolini](https://www.linkedin.com/in/biagolini/)
**Medium:** [medium.com/@biagolini](https://medium.com/@biagolini)

---

## What it does

You bring the questions and your Anthropic API key. The app turns each raw question into a structured review (key concepts, context, correct answer with reasoning, why each wrong alternative is wrong, and optional translations when an output language is selected), keeps every review in your browser, and lets you export grouped Markdown bundles you can hand to NotebookLM to generate study podcasts.

There is no backend. Everything is in your browser: questions, settings, and API key all live in `localStorage`. Closing the tab does not lose your work; clearing site data does.

---

## Getting an Anthropic API key

The app calls Claude on your behalf, so you need your own Anthropic API key before anything works.

1. **Create an account** at [console.anthropic.com](https://console.anthropic.com/). A Google or email sign-up works.
2. **Add billing credit.** Anthropic uses prepaid usage: open **Plans & Billing → Billing** and top up at least a few dollars. A typical review costs a few cents, so a small initial credit goes a long way.
3. **Create the key.** Go to **API Keys → Create Key**, give it a name like `study-assistant`, and copy the value. The key is shown only once and starts with `sk-ant-`. If you lose it, create a new one and revoke the old one.
4. **Optional but recommended:** set a monthly **usage limit** on the key so a runaway loop cannot drain your credit.

> Treat the key like a password. Anyone who has it can spend on your account. If the device is shared, revoke the key when you are done.

### Alternative: get the key through your AWS account

If you already run on AWS and prefer to consolidate billing there, you can use **Claude Platform on AWS** instead of opening a personal Anthropic account. It is a native AWS integration where Anthropic still operates the inference, but AWS handles authentication (IAM/SigV4 or API key), Marketplace billing, and CloudTrail audit. The API key you get from the AWS-managed Claude Console works in this app exactly the same way as a personal-account key — paste it in the **Settings → API Key** field and you are done.

For a step-by-step walkthrough, see my articles:

- English: [Getting Started with Claude Platform on AWS](https://medium.com/@biagolini/getting-started-with-claude-platform-on-aws-9a2c1ed9b3bc)
- Português: [Primeiros passos com o Claude Platform na AWS](https://builder.aws.com/content/3Ek6QX9d8ea545kjglmS2UcBlsk/primeiros-passos-com-o-claude-platform-na-aws)

> Note: Claude Platform on AWS is not the same as **Amazon Bedrock**. This app talks to the public Anthropic Messages API (`api.anthropic.com`), so it works with API keys from either a first-party Anthropic Console account or an AWS-managed Claude Platform organization. It does **not** call Bedrock endpoints directly.

---

## Configuring the app

Once you have a key, the rest happens inside the app:

1. Open the live demo and tap the **gear icon** in the top-right of the header to open the **Settings drawer**.
2. Under **Quick import**, tap **Import file** or **Paste text** to load credentials from a `.env` file (see the import section below).
3. **API Key** — paste the key you copied from the Anthropic Console. The eye icon toggles visibility.
4. **Default model** — select which Claude model to use. Lighter tiers respond quicker and cost less.
5. **Output language** — optionally select a language for explanations and translations (see the output language section below).
6. Close the drawer. You are ready to generate reviews from the **Input** tab.

Settings persist across reloads. To wipe everything, use your browser's site data tools.

---

## Packs

A **pack** groups a set of questions under a named certification exam. Each pack stores:

- **Name** — the exam name, used as the title in exported files.
- **Description** — a free-text overview of the certification (target audience, exam structure, etc.). Injected into the AI prompt to improve classification and explanation quality.
- **Version** — optional label used in exported filenames and shown in the pack switcher. This is the key field for traceability: if you study using online practice platforms, set the version to something like `platform-a-set3` or `vendor-b-exam2`. Every exported file will carry that label in its name, so when you later review a question you had doubts about, the filename tells you exactly which practice exam it came from.
- **Color** — badge color in the header. Choose from 11 presets or pick any hex with the custom color swatch.
- **Knowledge domains** — up to 20 named domains, each with an optional description (tasks, weight, topics). The AI uses these to classify each question. With no domains defined, every question is filed under `General`.
- **MCP servers** — optional external knowledge sources the model can call during Generate and Refine.

You can have multiple packs and switch between them. Each pack is a separate question collection.

---

## Importing settings with a .env file

Instead of typing credentials manually every time you clear the browser cache, you can keep a local `.env` file and import it in one click — or paste the content directly (useful on mobile).

**`.env` format** (use `.env.example` as the template):

```
ANTHROPIC_API_KEY=sk-ant-api03-...
ANTHROPIC_AWS_WORKSPACE_ID=wrkspc_...      # only for AWS keys
ANTHROPIC_AWS_REGION=us-east-1             # only for AWS keys
ANTHROPIC_OUTPUT_LANGUAGE=pt-BR            # optional, see Output language section
```

**How to import:**

1. Open Settings (gear icon in the header).
2. Under **Quick import**, tap **Import file** to select a `.env` file, or **Paste text** to paste the content directly.
3. The app reads the variables above and applies them immediately.

The import never leaves your browser. Values go straight into `localStorage`. Nothing is uploaded.

---

## Importing a pack from JSON

You can pre-configure a pack — name, description, color, and domains — by importing a JSON file instead of typing everything by hand. Useful for sharing exam configurations across devices or teams.

**Format:**

```json
{
  "name": "Exam name",
  "version": "optional label",
  "color": "#D97757",
  "description": "Certification overview, target audience, exam structure...",
  "domains": [
    {
      "name": "Domain one",
      "description": "Optional — tasks, weight, topics..."
    },
    {
      "name": "Domain two",
      "description": ""
    }
  ]
}
```

All fields are optional. `domains` accepts either objects `{ name, description }` or plain strings for backward compatibility. `color` accepts any of the 11 preset swatch values or a custom hex code (`#RGB` or `#RRGGBB`).

**How to import:**

1. Open the pack switcher (the colored badge in the header) and tap **New pack** — or tap **Edit** on an existing pack.
2. Next to the **Knowledge Domains** label, tap **Import file** to select a `.json` file, or **Paste JSON** to paste the content directly.
3. Name, description, color, and domains are filled in automatically.
4. Adjust anything you want, then tap **Save**.

### Example: Claude Certified Architect — Foundations (CCAF)

A ready-to-use pack file for the CCAF certification is included in this repository:

```
public/examples/ccaf-pack.json
```

It contains the five official exam domains with task descriptions and weights, the certification overview, and the Claude Code brand coral color (`#D97757`). Import it via the pack editor to have everything pre-configured without typing.

---

## Output language

By default the app writes reviews and transcript summaries in the same language as the input. When a language is selected in **Settings → Output language**, the behavior changes:

- **Reviews:** the original question text and alternatives are preserved, followed by a translation line. All explanations (correct answer and incorrect alternatives) are written entirely in the selected language.
- **Transcript summaries:** the entire summary is written in the selected language.

The language setting is also supported in `.env` imports via `ANTHROPIC_OUTPUT_LANGUAGE`.

Supported languages: English, Portuguese (Brazilian), Spanish, French, German, Italian, Japanese, Korean, Chinese (Simplified), Arabic, Hindi, Dutch, Polish, Russian, Turkish, Vietnamese.

---

## Daily use

With a pack configured and an API key saved, the day-to-day loop is:

1. **Input tab** — paste a full question (stem + alternatives A/B/C/D) and tap **Generate Review**. The review streams into the viewer token by token.
2. **Questions tab** — every reviewed question is listed with its domain badge. Tap to read; tap the badge to change its domain; use the checkbox to mark it for export.
3. **Export tab** — choose how to download:
   - **Download selected** — one or more files, grouped by domain, with descriptions.
   - **By domain** — one file per domain that has selected questions.
   - **Download all** — a single file with every reviewed question.

Exported files are structured Markdown with the certification description, domain headers, domain descriptions, and questions grouped by domain — ready for NotebookLM or any Markdown reader.

Other controls:

- **Theme toggle** (sun/moon in the header) — switches light/dark. Choice persists.
- **Transcripts tab** — paste lesson transcripts and generate a structured technical summary for podcast generation.
- **Settings → Danger Zone → Clear questions in this pack** — wipes questions for the active pack only. Other packs and your API key are not affected.

---

## AI accuracy notice

Every review, refinement, and answer rationale is generated by a large language model. LLMs can produce **inaccurate, outdated, or entirely fabricated** technical content. Treat the output as a **study aid**, not as ground truth:

- Always cross-check explanations against **official vendor documentation** before relying on them.
- Be especially skeptical of API names, service limits, version numbers, and pricing — these are the most common categories of hallucination.
- The "correct answer" the AI picks can be **wrong**. Verify with the official answer key or vendor docs.
- Material exported for NotebookLM or shared with others inherits these caveats.

By using this app you accept that the author, contributors, and any model provider (Anthropic, AWS) are **not responsible** for incorrect study content, missed exam questions, or any consequence of acting on AI-generated information.

---

## Privacy & cost notes

- Authentication uses Amazon Cognito (email/password). No third-party AI API keys are stored in the browser.
- Each generated review is one streaming call to the selected Amazon Nova model (Micro/Lite/Pro) via Amazon Bedrock. `maxTokens` is not set, so Bedrock defaults to the model's maximum allowed output (10K tokens for Nova), avoiding truncation of long reviews.
- Requests go from your browser to the API Gateway endpoint, which invokes a Lambda that calls Bedrock. No third-party proxy and no telemetry.

---

## Tech stack

- **Angular 21** — standalone components, signals, no NgModules
- **TypeScript** strict mode
- **SCSS** with CSS custom properties for theming
- **Native `fetch`** — no `HttpClient`
- **`localStorage`** for all persistence
- **Custom Markdown renderer** — line-by-line parser, no `innerHTML`, no third-party library
- **Zero UI libraries** — no Material, no PrimeNG, no Bootstrap
- **GitHub Actions** — automated build and deploy to GitHub Pages on every push to `main`

---

## Local development

```bash
git clone git@github.com:biagolini/AngularAnthropicStudyAssistant.git
cd AngularAnthropicStudyAssistant
npm install
npm start
```

Open `http://localhost:4200/`. The dev server reloads on save. The `baseHref` is `/` in development so there is no path prefix.

### Build

```bash
npm run build
```

Outputs the static site into `docs/` with `baseHref="/AngularAnthropicStudyAssistant/"`. This folder is not committed — the GitHub Actions pipeline handles the build and deploy automatically on every push to `main`.

### Tests

```bash
npm test
```

---

## Repository

Source: [github.com/biagolini/AngularAnthropicStudyAssistant](https://github.com/biagolini/AngularAnthropicStudyAssistant)

Part of the Angular projects index: [github.com/biagolini/Angular](https://github.com/biagolini/Angular)
