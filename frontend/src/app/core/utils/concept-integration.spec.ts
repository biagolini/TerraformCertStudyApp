import { buildConceptProposalRequest, certContext, extractUpdatedNote } from './assistant-prompt.util';
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

  it('takes the updated note out of a fenced reply, or the whole reply without a fence', () => {
    expect(extractUpdatedNote('```markdown\n# Note\n\nText\n```')).toBe('# Note\n\nText');
    expect(extractUpdatedNote('# Note only')).toBe('# Note only');
    expect(extractUpdatedNote('```markdown\nTitle: My note\n\n## Section\n```')).toBe('## Section');
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
