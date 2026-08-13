// Deliberately dependency-free, in-memory, fixed-window rate limiting: this is
// a single-instance pilot app, so a Map is sufficient and Redis would be
// unwarranted infrastructure. It is a basic deterrent against credential
// stuffing and identity-verification hammering, NOT a production-grade limiter
// (it resets on restart and does not coordinate across instances — see the
// spec's Non-goals).

export const RATE_LIMIT_MAX_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 60_000;

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/** Records an attempt against `key` and reports whether it is allowed. */
export function checkRateLimit(
  key: string,
  maxAttempts: number = RATE_LIMIT_MAX_ATTEMPTS,
  windowMs: number = RATE_LIMIT_WINDOW_MS
): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > maxAttempts) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Builds a limiter key, preferring a stable identifier over the client IP. */
export function rateLimitKey(req: Request, scope: string, identifier?: string): string {
  if (identifier) return `${scope}:${identifier}`;
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `${scope}:${forwarded || req.headers.get('x-real-ip') || 'unknown'}`;
}

/** Test-only: clears all counters so suites don't leak state into each other. */
export function resetRateLimits(): void {
  windows.clear();
}
