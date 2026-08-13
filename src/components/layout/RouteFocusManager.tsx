'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Moves keyboard focus to the new page's heading (or the <main> landmark, if
 * no heading exists yet) on every client-side route change.
 *
 * Without this, a focused element that unmounts as part of a route change
 * (e.g. a submit button whose page is swapped out) falls back to
 * document.body, but the browser's *next* sequential Tab continues roughly
 * from that removed element's old position in the document rather than
 * restarting at the top — so wherever a nav bar happens to newly appear
 * (e.g. right after login) can end up unreachable by forward Tab entirely.
 * This isn't specific to that one case; without a deliberate target, focus
 * after a route change is undefined and varies by what happened to be
 * focused before.
 *
 * The fix follows the standard SPA-accessibility pattern (used by Gatsby,
 * Reach Router, and Next.js community solutions alike): put focus on the new
 * page's <h1> — or <main> if no heading is present yet — so a keyboard/
 * screen-reader user always lands somewhere predictable and gets a real cue
 * that navigation happened, without being forced back through the nav on
 * every single route change (Shift+Tab or the screen reader's own landmark
 * navigation reaches it from there, same as most accessible SPAs). Next.js's
 * built-in route announcer already covers the *audible* "page changed"
 * signal; this covers focus, which it doesn't.
 *
 * Skips the very first render: on an initial page load the browser already
 * places focus correctly (at the top of the document, so the skip link is
 * reachable), and forcing focus into main content there would fight that.
 *
 * Compares the previous pathname to the current one, rather than a boolean
 * "have I run yet" flag: React 18 Strict Mode double-invokes effects once in
 * development (mount, cleanup, mount again) specifically to catch state that
 * doesn't tolerate being re-run, and a plain boolean ref flips to "already
 * ran" on that throwaway first invocation, so the *real* one no longer sees
 * itself as the first render and fires immediately on initial load — which
 * is invisible in production (Strict Mode's double-invoke is dev-only) but
 * is still a leftover in the underlying logic worth not having. Comparing
 * pathnames survives the double-invoke correctly either way, since a
 * pathname compared to itself is always "no navigation happened."
 */
export function RouteFocusManager() {
  const pathname = usePathname();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    const isRealNavigation =
      previousPathname.current !== null && previousPathname.current !== pathname;
    previousPathname.current = pathname;
    if (!isRealNavigation) return;

    const main = document.getElementById('main-content');
    const heading = main?.querySelector('h1');
    const target = heading ?? main;
    if (!target) return;

    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus();
  }, [pathname]);

  return null;
}
