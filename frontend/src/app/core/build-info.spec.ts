import { describe, expect, it } from 'vitest';
import { BUILD_TIME_ISO, formatBuildTime } from './build-info';

describe('build info', () => {
  it('is null when the build did not define BUILD_TIME', () => {
    expect(BUILD_TIME_ISO).toBeNull();
  });

  it('formats in Brasília time, not the machine time zone', () => {
    // 16:05:09 UTC is 13:05:09 in Brasília (UTC-3, no daylight saving time).
    expect(formatBuildTime('2026-11-07T16:05:09Z', 'pt-BR')).toBe('07/11/2026, 13:05:09');
  });
});
