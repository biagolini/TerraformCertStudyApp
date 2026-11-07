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

export function formatBuildTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: BUILD_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}
