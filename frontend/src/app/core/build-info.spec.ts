import { describe, expect, it } from 'vitest';
import { BUILD_TIME_ISO, formatBuildTime } from './build-info';

describe('build info', () => {
  it('is null when the build did not define BUILD_TIME', () => {
    expect(BUILD_TIME_ISO).toBeNull();
  });

  it('formats in Brasília time, not the machine time zone', () => {
    // 16:05:09 UTC is 13:05 in Brasília (UTC-3, no daylight saving time).
    expect(formatBuildTime('2026-11-07T16:05:09Z')).toBe('Built on 2026-11-07 at 13:05 (Brasília time)');
  });

  it('uses 24-hour time and rolls the date over in Brasília', () => {
    expect(formatBuildTime('2026-11-09T02:30:00Z')).toBe('Built on 2026-11-08 at 23:30 (Brasília time)');
    expect(formatBuildTime('2026-11-09T03:00:00Z')).toBe('Built on 2026-11-09 at 00:00 (Brasília time)');
  });
});
