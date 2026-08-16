'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';

type NavLink = { href: string; label: string };

const CLAIMANT_LINKS: NavLink[] = [
  { href: '/claim/dashboard', label: 'Dashboard' },
  { href: '/claim/new', label: 'File a claim' },
  { href: '/claim/verify-identity', label: 'Verify your identity' },
  { href: '/claim/messages', label: 'Messages' },
  { href: '/claim/candidate-profile', label: 'Candidate profile' },
  { href: '/claim/browse-postings', label: 'Job postings' },
];

const STAFF_LINKS: NavLink[] = [
  { href: '/staff/dashboard', label: 'Staff dashboard' },
  { href: '/staff/unmatched-events', label: 'Unmatched events' },
];

const EMPLOYER_LINKS: NavLink[] = [
  { href: '/employer/dashboard', label: 'Dashboard' },
  { href: '/employer/verify-fein', label: 'Verify your company' },
  { href: '/employer/job-postings', label: 'Job postings' },
];

/**
 * The application's only navigation. Before this, no page linked to any other:
 * /claim/messages and /claim/verify-identity were unreachable except by typing
 * the URL, and the only sign-out control in the whole app lived inside the
 * session-timeout dialog.
 *
 * Deliberately minimal for the pilot: a flat, always-visible link list with no
 * dropdowns, no mobile hamburger and no active-route highlighting. It renders
 * only for an authenticated session, so public pages are untouched.
 *
 * There is no generic "Certify" link: /claim/certify requires a claimId, and
 * the dashboard already links to certification per claim.
 */
export function AppNav() {
  const { data, status } = useSession();

  if (status !== 'authenticated' || !data?.user) return null;

  const links =
    data.user.role === 'CLAIMANT'
      ? CLAIMANT_LINKS
      : data.user.role === 'EMPLOYER'
        ? EMPLOYER_LINKS
        : STAFF_LINKS;

  return (
    <nav aria-label="Main" className="border-b border-border bg-surface-alt">
      <div className="max-w-4xl mx-auto flex flex-wrap items-center gap-4 px-8 py-3">
        <ul className="flex flex-wrap items-center gap-4">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="text-link underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => signOut({ callbackUrl: '/' })}
        >
          Sign out
        </Button>
      </div>
    </nav>
  );
}
