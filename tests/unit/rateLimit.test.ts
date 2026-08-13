import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  RATE_LIMIT_MAX_ATTEMPTS,
  checkRateLimit,
  rateLimitKey,
  resetRateLimits,
} from '@/lib/rateLimit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows attempts up to the cap and blocks the one after it', () => {
    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      expect(checkRateLimit('login:someone@example.com').allowed).toBe(true);
    }
    const blocked = checkRateLimit('login:someone@example.com');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each key independently', () => {
    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS + 1; attempt += 1) {
      checkRateLimit('login:a@example.com');
    }
    expect(checkRateLimit('login:a@example.com').allowed).toBe(false);
    expect(checkRateLimit('login:b@example.com').allowed).toBe(true);
  });

  it('starts a fresh window once the old one expires', () => {
    vi.useFakeTimers();
    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS + 1; attempt += 1) {
      checkRateLimit('login:someone@example.com');
    }
    expect(checkRateLimit('login:someone@example.com').allowed).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit('login:someone@example.com').allowed).toBe(true);
  });
});

describe('rateLimitKey', () => {
  it('prefers an explicit identifier over the client IP', () => {
    const req = new Request('http://localhost', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    expect(rateLimitKey(req, 'idv-start', 'user-1')).toBe('idv-start:user-1');
  });

  it('falls back to the first forwarded IP', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    });
    expect(rateLimitKey(req, 'idv-start')).toBe('idv-start:1.2.3.4');
  });

  it('falls back to "unknown" when no client IP header is present', () => {
    expect(rateLimitKey(new Request('http://localhost'), 'idv-start')).toBe('idv-start:unknown');
  });
});
