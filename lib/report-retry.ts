/** Accept the API delay or the HTTP fallback; never turn an invalid delay into a retry loop. */
export function reportRetrySeconds(value: unknown, header: string | null, now = Date.now()) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.ceil(value);
  if (header) {
    const seconds = /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
    if (Number.isFinite(seconds)) return seconds > 0 ? Math.ceil(seconds) : 60;
    const date = Date.parse(header);
    if (Number.isFinite(date) && date > now) return Math.ceil((date - now) / 1000);
  }
  return 60;
}

/** Clock notation stays compact for both minute and daily quotas. */
export function reportRetryClock(seconds: number) {
  const remaining = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const tail = String(remaining % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`;
}
