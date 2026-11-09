/**
 * When the deployed bundle was compiled, so a phone can tell whether it runs the
 * latest deploy or a stale copy (CDN or browser cache, a tab restored from memory).
 *
 * `BUILD_TIME` is replaced at build time by `ng build --define` in
 * `backend/infrastructure/scripts/deploy_frontend.sh` with a UTC ISO timestamp.
 * `ng serve`, tests and a plain `ng build` do not define it, and `typeof` on an
 * undeclared global is safe, so those builds report null.
 */
declare const BUILD_TIME: string | undefined;

export const BUILD_TIME_ISO: string | null = typeof BUILD_TIME === 'string' && BUILD_TIME ? BUILD_TIME : null;

/** Brasília time regardless of the phone's own time zone, so two devices show the same value. */
export const BUILD_TIME_ZONE = 'America/Sao_Paulo';

/** Fixed English, not translated: "Built on 2026-11-09 at 10:26 (Brasília time)". */
export function formatBuildTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUILD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `Built on ${part('year')}-${part('month')}-${part('day')} at ${part('hour')}:${part('minute')} (Brasília time)`;
}
