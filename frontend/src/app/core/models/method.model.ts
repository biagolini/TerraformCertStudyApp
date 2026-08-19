export type StudyMethod = 'question' | 'transcript' | 'chat';

export interface StudyMethodEntry {
  id: StudyMethod;
  name: string;
  description: string;
  status: 'ready' | 'preview';
}

export const STUDY_METHODS: StudyMethodEntry[] = [
  {
    id: 'question',
    name: 'Question reviews',
    description:
      'Paste an exam question and get a structured review with the correct answer and reasoning for every alternative.',
    status: 'ready',
  },
  {
    id: 'transcript',
    name: 'Transcript scripts',
    description:
      'Turn one or many video-lesson transcripts into a layered technical summary that another AI (NotebookLM) can read aloud as a podcast.',
    status: 'ready',
  },
  {
    id: 'chat',
    name: 'Open chat',
    description:
      'Free-form tutor conversation focused on your active certification. Persist multiple sessions and generate or update a NotebookLM-style summary at any point.',
    status: 'ready',
  },
];

export function isStudyMethod(value: string): value is StudyMethod {
  return value === 'question' || value === 'transcript' || value === 'chat';
}
