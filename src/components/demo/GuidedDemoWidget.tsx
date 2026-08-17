'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import {
  DEMO_STEPS,
  DEMO_ACCOUNT_CREDENTIALS,
  DEMO_ROLE_SESSION_VALUE,
  type ScenarioLinks,
  type DemoStep,
} from '@/lib/demoScenario';

// After signIn() resolves, next-auth's client-side session context can take
// a beat to actually propagate to every useSession() consumer — the
// signIn() promise resolving only means the credentials were accepted, not
// that every already-rendered page has re-rendered under the new session
// yet. Navigating immediately on that assumption is exactly the race that
// produced a real bug: switching to the caseworker from step 4 sometimes
// left the still-mounted /claim/dashboard (a CLAIMANT-only page) rendering
// its "wrong role" error under the stale session, without ever completing
// the navigation away from it. getSession() bypasses the client cache
// entirely and asks the server directly, so waiting on it — rather than on
// signIn()'s own promise — is a genuine confirmation the new role is live
// before router.push() is called.
async function waitForSessionRole(expectedRole: string, maxAttempts = 10, delayMs = 300): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const session = await getSession();
    if (session?.user && (session.user as { role?: string }).role === expectedRole) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

// Steps 1 and 3 each require a real action on the underlying page (Accept,
// Hire) before the story that step's "Next" button promises is actually
// true. Checked once, at click time, against the same data the relevant
// page itself reads — not continuously polled. A failed check here (e.g. a
// transient network error) never blocks advancing: verification is a
// courtesy that catches the common case of clicking ahead of the actual
// action, not a hard gate this demo tool depends on.
async function findIncompleteStepMessage(step: DemoStep, links: ScenarioLinks | null): Promise<string | null> {
  if (step.step === 1) {
    const res = await fetch('/api/job-applications');
    if (!res.ok) return null;
    const applications: { jobPosting: { title: string }; interview: { status: string } | null }[] =
      await res.json();
    const warehouseApplication = applications.find((a) => a.jobPosting.title === 'Warehouse Associate');
    if (warehouseApplication?.interview?.status !== 'CONFIRMED') {
      return 'Not yet — accept one of the proposed interview times above before continuing.';
    }
    return null;
  }
  if (step.step === 3) {
    if (!links) return null;
    const res = await fetch(`/api/employer/job-postings/${links.warehousePostingId}/applications`);
    if (!res.ok) return null;
    const applications: { status: string }[] = await res.json();
    if (!applications.some((a) => a.status === 'HIRED')) {
      return 'Not yet — click Hire above before continuing.';
    }
    return null;
  }
  return null;
}

const STORAGE_KEY = 'emplement-guided-demo-step';

export function GuidedDemoWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const [stepNumber, setStepNumber] = useState<number | null>(null);
  const [links, setLinks] = useState<ScenarioLinks | null>(null);
  const [linksError, setLinksError] = useState(false);
  const [linksLoading, setLinksLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  // Not persisted to sessionStorage: the widget itself never unmounts across
  // client-side navigation (mounted once, globally, in providers.tsx), so
  // plain component state already survives every step transition on its
  // own — the same reason `collapsed` doesn't need the same pathname-driven
  // re-read `stepNumber` does.
  const [collapsed, setCollapsed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const linksRequestedRef = useRef(false);

  // Re-read on every client-side route change, not just on mount: this
  // widget is mounted once, globally, in providers.tsx and never remounts
  // across navigation (Next.js App Router persists layout-level components
  // across route changes). Without `pathname` as a dependency, a demo
  // started via sessionStorage.setItem() elsewhere (e.g. the homepage's
  // "Start Guided Demo" button) would never be noticed by an
  // already-mounted widget until a full page reload. Same pattern as
  // RouteFocusManager's "something changed, re-check" use of usePathname().
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) setStepNumber(Number(stored));
  }, [pathname]);

  // Fetch scenario-links once, the first time a guided demo is actually in
  // progress, and cache the result for the rest of the session — not on
  // every step transition. This effect still depends on [stepNumber] so it
  // fires promptly once a demo starts, but linksRequestedRef guards it so
  // the request itself only ever goes out once. Because at most one fetch
  // ever fires per component instance, there's nothing for a "cancelled"
  // flag to protect against — even if stepNumber changes (e.g. exiting the
  // demo) while the fetch is in flight, letting it land is harmless since
  // linksRequestedRef prevents any second request from ever being made.
  useEffect(() => {
    if (stepNumber === null) return;
    if (linksRequestedRef.current) return;
    linksRequestedRef.current = true;
    setLinksLoading(true);
    fetch('/api/demo/scenario-links')
      .then((res) => {
        if (!res.ok) throw new Error('scenario-links request failed');
        return res.json();
      })
      .then((data: ScenarioLinks) => {
        setLinks(data);
      })
      .catch(() => {
        setLinksError(true);
      })
      .finally(() => {
        setLinksLoading(false);
      });
  }, [stepNumber]);

  if (stepNumber === null) return null;

  const currentStep = DEMO_STEPS.find((s) => s.step === stepNumber);
  if (!currentStep) return null;

  async function goToStep(nextStepNumber: number) {
    const nextStep = DEMO_STEPS.find((s) => s.step === nextStepNumber);
    // stepNumber can't actually be null here — this function is only ever
    // invoked from the rendered JSX below, which itself only renders after
    // the component's own early `if (stepNumber === null) return null`
    // above — but that narrowing doesn't survive into a closure the
    // compiler can't prove runs synchronously with it.
    if (!nextStep || !currentStep || stepNumber === null) return;
    setTransitionError(null);
    setPending(true);
    try {
      // Only advancing forward requires the current step's own action to
      // have actually happened — going Back never depends on it.
      const movingForward = nextStepNumber > stepNumber;
      if (movingForward) {
        const incompleteMessage = await findIncompleteStepMessage(currentStep, links);
        if (incompleteMessage) {
          setTransitionError(incompleteMessage);
          return;
        }
      }
      const roleChanging = nextStep.role !== currentStep.role;
      if (roleChanging) {
        const { email, password } = DEMO_ACCOUNT_CREDENTIALS[nextStep.role];
        const result = await signIn('credentials', { redirect: false, email, password });
        if (result?.error) {
          setTransitionError('The demo login is temporarily unavailable. Please try again.');
          return;
        }
        const roleVerified = await waitForSessionRole(DEMO_ROLE_SESSION_VALUE[nextStep.role]);
        if (!roleVerified) {
          setTransitionError('Signed in, but the new session hasn’t taken effect yet. Please try again.');
          return;
        }
      }
      const path = links ? nextStep.targetPath(links) : null;
      sessionStorage.setItem(STORAGE_KEY, String(nextStepNumber));
      setStepNumber(nextStepNumber);
      if (path) {
        router.push(path);
      } else {
        // No navigation on this transition (same page as the previous
        // step) — RouteFocusManager only moves focus on a real route
        // change, so move it to this widget's own updated heading instead;
        // otherwise a screen-reader user gets no cue the instruction
        // changed.
        headingRef.current?.focus();
      }
    } finally {
      setPending(false);
    }
  }

  function exitDemo() {
    sessionStorage.removeItem(STORAGE_KEY);
    setStepNumber(null);
  }

  const isLastStep = stepNumber === DEMO_STEPS.length;
  const isFirstStep = stepNumber === 1;

  if (collapsed) {
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label={`Expand guided demo — step ${currentStep.step} of ${DEMO_STEPS.length}`}
          className="rounded-full bg-surface border border-border shadow-lg px-4 py-2 text-sm font-medium hover:bg-surface-alt focus-visible:outline focus-visible:outline-2"
        >
          Step {currentStep.step} of {DEMO_STEPS.length} — Guided demo
        </button>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Guided demo"
      className="fixed bottom-4 right-4 z-40 max-w-sm bg-surface border border-border rounded p-4 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-xs text-text-secondary">
          Step {currentStep.step} of {DEMO_STEPS.length} — Now viewing as: {currentStep.roleLabel}
        </p>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse guided demo"
          className="text-text-secondary hover:text-text-primary text-xs font-medium shrink-0 focus-visible:outline focus-visible:outline-2"
        >
          Collapse
        </button>
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="font-bold mb-2">
        {currentStep.title}
      </h2>
      {linksError ? (
        <p role="alert" className="text-error-text text-sm mb-3">
          Guided demo data isn&apos;t available in this environment.
        </p>
      ) : (
        <p className="text-sm mb-3">{currentStep.instruction}</p>
      )}
      {transitionError && (
        <p role="alert" className="text-error-text text-sm mb-3">
          {transitionError}
        </p>
      )}
      <div className="flex gap-3 flex-wrap">
        {!isFirstStep && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => goToStep(stepNumber - 1)}
            disabled={pending || linksError || linksLoading}
          >
            Back
          </Button>
        )}
        <Button
          type="button"
          onClick={() => (isLastStep ? exitDemo() : goToStep(stepNumber + 1))}
          disabled={pending || linksError || linksLoading}
        >
          {pending ? 'Working…' : linksLoading ? 'Loading…' : currentStep.buttonLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={exitDemo} disabled={pending}>
          Exit demo
        </Button>
      </div>
    </div>
  );
}
