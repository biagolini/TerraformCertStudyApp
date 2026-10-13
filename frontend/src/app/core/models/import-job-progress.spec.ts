import { importJobProgressPct, importJobProgressTotal } from './import-job.model';

describe('import job progress', () => {
  it('counts AI explanations against the drafts sent for explanation', () => {
    const job = { status: 'GENERATING' as const, totalQuestions: 75, explainTotal: 40, processedCount: 10 };
    expect(importJobProgressTotal(job)).toBe(40);
    expect(importJobProgressPct(job)).toBe(25);
  });

  it('counts extraction against the detected questions, 0 while still detecting', () => {
    expect(importJobProgressPct({ status: 'EXTRACTING', totalQuestions: 20, explainTotal: null, processedCount: 5 })).toBe(25);
    expect(importJobProgressPct({ status: 'EXTRACTING', totalQuestions: null, explainTotal: null, processedCount: 0 })).toBe(0);
  });
});
