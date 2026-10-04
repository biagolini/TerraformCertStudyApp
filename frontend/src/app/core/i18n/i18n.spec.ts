import { EN } from './en';
import { PT } from './pt';
import { ES } from './es';
import { IT } from './it';

// Literal keys used in templates/code are checked by scripts/check-i18n-keys.mjs
// (needs filesystem access, which the browser-like test environment lacks).
describe('i18n dictionaries', () => {
  for (const [name, dict] of Object.entries({ PT, ES, IT })) {
    it(`${name} has every English key`, () => {
      const missing = Object.keys(EN).filter((k) => !(k in dict));
      expect(missing).toEqual([]);
    });
  }

  it('dynamic enumeration keys exist', () => {
    const dynamic = [
      ...['aws', 'azure', 'gcp', 'kubernetes', 'terraform', 'linux', 'mongodb', 'anthropic', 'other'].map((p) => `provider.${p}`),
      ...['foundational', 'associate', 'professional', 'specialty'].map((l) => `level.${l}`),
      ...['backlog', 'in-progress', 'earned'].map((t) => `track.${t}`),
      ...['edit', 'split', 'preview'].map((m) => `notes.mode_${m}`),
      ...['beginner', 'intermediate', 'advanced', 'lead'].map((e) => `profile.exp_${e}`),
      ...['all', 'answered', 'unanswered', 'flagged'].map((f) => `quizRunner.filter_${f}`),
      ...['polish', 'summary', 'flashcards', 'quiz', 'explain', 'outline'].map((a) => `copilot.${a}`),
      ...['banks', 'quiz', 'performance', 'notes', 'transcripts', 'chat', 'export'].map((n) => `nav.${n}`),
    ];
    expect(dynamic.filter((k) => !(k in EN))).toEqual([]);
  });
});
