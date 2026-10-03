/** Router commands for the certification workspace, so the URL shape lives in one place. */
export const ALL_BANKS = 'all';

export function examPath(packId: string, ...segments: string[]): string[] {
  return ['/exam', packId, ...segments];
}

/** A question inside the workspace's question browser. `bankId` = ALL_BANKS for the unified view. */
export function questionPath(packId: string, bankId: string, questionId?: string): string[] {
  return questionId ? examPath(packId, 'banks', bankId, questionId) : examPath(packId, 'banks', bankId);
}
