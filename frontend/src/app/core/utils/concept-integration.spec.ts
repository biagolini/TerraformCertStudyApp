import { CONCEPT_APPLY_REQUEST, buildConceptProposalRequest, certContext } from './assistant-prompt.util';
import { parseNoteEdits } from './note-edit.util';
import { Question } from '../models/question.model';

const question: Question = {
  id: 'q', packId: 'p', bankId: 'b', title: 'Lifecycle', domain: 'Storage', stem: 'Which tier?',
  alternatives: [
    { letter: 'A', text: 'Glacier', isCorrect: false, comment: 'too slow' },
    { letter: 'B', text: 'Intelligent-Tiering', isCorrect: true, comment: 'automatic' },
  ],
  metadata: { topics: [], relatedServices: [] }, createdAt: 0, updatedAt: 0,
};

describe('concept integration prompts', () => {
  it('asks for a proposal first and carries the question, the answer and the tutor doubts', () => {
    const text = buildConceptProposalRequest(question, ['A'], [{ role: 'user', content: 'Why not Glacier?' }]);
    expect(text).toContain('WITHOUT rewriting the note');
    expect(text).toContain('[KEY: correct]');
    expect(text).toContain('Student: Why not Glacier?');
  });

  it('asks for targeted edits in the format the app parses, never the whole note', () => {
    expect(CONCEPT_APPLY_REQUEST).toContain('Do NOT rewrite or repeat the rest of the note');
    const examples = CONCEPT_APPLY_REQUEST.slice(CONCEPT_APPLY_REQUEST.indexOf('=== EDIT ==='), CONCEPT_APPLY_REQUEST.lastIndexOf('=== END EDIT ===') + 16)
      .replace(/<the exact passage[^>]*>/, 'Old line.')
      .replace('<the new text that replaces it>', 'New line.')
      .replace(/<a heading line[^>]*>/, '## Storage')
      .replace('<only the new Markdown>', 'Added line.');
    expect(parseNoteEdits(examples)).toEqual([
      { action: 'replace_text', section: null, old: 'Old line.', content: 'New line.' },
      { action: 'insert_after', section: '## Storage', content: 'Added line.' },
    ]);
  });

  it('describes the exam from the certification data', () => {
    const text = certContext({
      name: 'Example Certification', code: 'EX-101', description: 'Validates storage skills.',
      domains: [{ name: 'Storage', description: 'Tiers and lifecycle', order: 1 }],
      examTotalQuestions: 65, examDurationMinutes: 130, passingScorePercent: 72,
    });
    expect(text).toContain('Example Certification (EX-101)');
    expect(text).toContain('Validates storage skills.');
    expect(text).toContain('65 questions, 130 minutes, pass mark 72%');
    expect(text).toContain('Storage — Tiers and lifecycle');
  });
});
