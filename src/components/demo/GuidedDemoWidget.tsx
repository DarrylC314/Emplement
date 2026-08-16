'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { DEMO_STEPS, DEMO_ACCOUNT_CREDENTIALS, type ScenarioLinks } from '@/lib/demoScenario';

const STORAGE_KEY = 'emplement-guided-demo-step';

export function GuidedDemoWidget() {
  const router = useRouter();
  const [stepNumber, setStepNumber] = useState<number | null>(null);
  const [links, setLinks] = useState<ScenarioLinks | null>(null);
  const [linksError, setLinksError] = useState(false);
  const [pending, setPending] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) setStepNumber(Number(stored));
  }, []);

  useEffect(() => {
    if (stepNumber === null) return;
    let cancelled = false;
    fetch('/api/demo/scenario-links')
      .then((res) => {
        if (!res.ok) throw new Error('scenario-links request failed');
        return res.json();
      })
      .then((data: ScenarioLinks) => {
        if (!cancelled) setLinks(data);
      })
      .catch(() => {
        if (!cancelled) setLinksError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [stepNumber]);

  if (stepNumber === null) return null;

  const currentStep = DEMO_STEPS.find((s) => s.step === stepNumber);
  if (!currentStep) return null;

  async function goToStep(nextStepNumber: number) {
    const nextStep = DEMO_STEPS.find((s) => s.step === nextStepNumber);
    if (!nextStep || !currentStep) return;
    setTransitionError(null);
    setPending(true);
    try {
      const roleChanging = nextStep.role !== currentStep.role;
      if (roleChanging) {
        const { email, password } = DEMO_ACCOUNT_CREDENTIALS[nextStep.role];
        const result = await signIn('credentials', { redirect: false, email, password });
        if (result?.error) {
          setTransitionError('The demo login is temporarily unavailable. Please try again.');
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

  return (
    <div
      role="region"
      aria-label="Guided demo"
      className="fixed bottom-4 right-4 z-40 max-w-sm bg-surface border border-border rounded p-4 shadow-lg"
    >
      <p className="text-xs text-text-secondary mb-1">
        Step {currentStep.step} of {DEMO_STEPS.length} — Now viewing as: {currentStep.roleLabel}
      </p>
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
      <div className="flex gap-3">
        <Button
          type="button"
          onClick={() => (isLastStep ? exitDemo() : goToStep(stepNumber + 1))}
          disabled={pending || linksError}
        >
          {pending ? 'Working…' : currentStep.buttonLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={exitDemo} disabled={pending}>
          Exit demo
        </Button>
      </div>
    </div>
  );
}
