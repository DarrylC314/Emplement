/**
 * Shared request/response boundary helpers for the API routes.
 *
 * Every route used to call `await req.json()` unguarded, so a malformed body
 * threw an unhandled exception and Next.js turned it into an opaque 500 —
 * violating the spec's "API errors return a consistent shape, mapped to
 * accessible, plain-language messages".
 *
 * Two error shapes remain, deliberately: Zod validation failures return
 * `{ errors: parsed.error.flatten() }` (field-level detail the client renders
 * per input), and everything else returns `{ error: string }` (a single
 * plain-language message). Only the malformed-JSON case is unified here.
 */

export const INVALID_BODY_MESSAGE = 'Invalid request body';

/** Parses a JSON request body, returning null instead of throwing on garbage. */
export async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    const parsed = await req.json();
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/** Builds the standard single-message error response. */
export function apiError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** The standard response for a body that could not be parsed as JSON. */
export function invalidBody(): Response {
  return apiError(INVALID_BODY_MESSAGE, 400);
}
