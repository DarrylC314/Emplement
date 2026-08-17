import { describe, it, expect } from 'vitest';
import { buildClaimantTimeline } from '@/lib/claimantTimeline';

describe('buildClaimantTimeline', () => {
  const application = {
    id: 'app-1',
    jobPosting: { title: 'Warehouse Associate', employer: { companyName: 'Riverbend Logistics Inc.' } },
  };

  it('builds the full apply -> interview -> hire -> claim-restricted story in chronological order', () => {
    const events = buildClaimantTimeline(
      [application],
      [
        { action: 'JOB_APPLICATION_SUBMITTED', targetId: 'app-1', timestamp: '2026-08-10T00:00:00Z', metadata: null },
        { action: 'INTERVIEW_PROPOSED', targetId: 'app-1', timestamp: '2026-08-11T00:00:00Z', metadata: null },
        { action: 'INTERVIEW_ACCEPTED', targetId: 'app-1', timestamp: '2026-08-12T00:00:00Z', metadata: null },
        {
          action: 'JOB_APPLICATION_HIRED',
          targetId: 'app-1',
          timestamp: '2026-08-16T00:00:00Z',
          metadata: { restrictedClaimCount: 1 },
        },
      ],
      [{ type: 'HIRE', eventDate: '2026-08-16T00:00:00Z', employer: { companyName: 'Riverbend Logistics Inc.' } }]
    );

    expect(events.map((e) => e.title)).toEqual([
      'Applied',
      'Interview proposed',
      'Interview accepted',
      'Hired',
      'Claim automatically restricted',
    ]);
    expect(events[0]?.detail).toBe('Warehouse Associate at Riverbend Logistics Inc.');
    expect(events[3]?.detail).toBe('Riverbend Logistics Inc.');
    expect(events[4]?.detail).toBe('Triggered by the hire at Riverbend Logistics Inc. — no manual review required.');
  });

  it('does not synthesize a "claim restricted" entry when the hire did not restrict a claim', () => {
    const events = buildClaimantTimeline(
      [application],
      [
        {
          action: 'JOB_APPLICATION_HIRED',
          targetId: 'app-1',
          timestamp: '2026-08-16T00:00:00Z',
          metadata: { restrictedClaimCount: 0 },
        },
      ],
      []
    );
    expect(events).toEqual([]);
  });

  it('ignores audit entries for applications not in the provided list', () => {
    const events = buildClaimantTimeline(
      [application],
      [{ action: 'JOB_APPLICATION_SUBMITTED', targetId: 'some-other-app', timestamp: '2026-08-10T00:00:00Z', metadata: null }],
      []
    );
    expect(events).toEqual([]);
  });

  it('ignores unrecognized audit actions', () => {
    const events = buildClaimantTimeline(
      [application],
      [{ action: 'JOB_APPLICATION_REJECTED', targetId: 'app-1', timestamp: '2026-08-10T00:00:00Z', metadata: null }],
      []
    );
    expect(events).toEqual([]);
  });

  it('falls back to "an employer" when companyName is null', () => {
    const events = buildClaimantTimeline(
      [],
      [],
      [{ type: 'SEPARATION', eventDate: '2026-08-16T00:00:00Z', employer: { companyName: null } }]
    );
    expect(events[0]?.title).toBe('Separated');
    expect(events[0]?.detail).toBe('an employer');
  });

  it('appends the separation reason to the "Separated" entry when present', () => {
    const events = buildClaimantTimeline(
      [],
      [],
      [
        {
          type: 'SEPARATION',
          eventDate: '2026-12-01T05:59:59.999Z',
          employer: { companyName: 'Seasonal Co' },
          reason: 'Fixed-term/seasonal employment concluded',
        },
      ]
    );
    expect(events[0]?.detail).toBe('Seasonal Co — Fixed-term/seasonal employment concluded');
  });

  it('synthesizes a "Claim reactivated" entry from an EMPLOYMENT_EXPIRATION_PROCESSED audit entry', () => {
    const events = buildClaimantTimeline(
      [],
      [
        {
          action: 'EMPLOYMENT_EXPIRATION_PROCESSED',
          targetId: 'sep-event-1',
          timestamp: '2026-12-05T09:00:00Z',
          metadata: { outcome: 'REACTIVATED', reasons: [] },
        },
      ],
      [
        {
          type: 'SEPARATION',
          eventDate: '2026-12-01T05:59:59.999Z',
          employer: { companyName: 'Seasonal Co' },
          reason: 'Fixed-term/seasonal employment concluded',
        },
      ]
    );
    expect(events.map((e) => e.title)).toEqual(['Separated', 'Claim reactivated']);
  });

  it('synthesizes a "Reevaluation required" entry with its failing checks, and a "Claim remains restricted" entry with its reason', () => {
    const reevalEvents = buildClaimantTimeline(
      [],
      [
        {
          action: 'EMPLOYMENT_EXPIRATION_PROCESSED',
          targetId: 'sep-event-2',
          timestamp: '2026-12-05T09:00:00Z',
          metadata: { outcome: 'REEVALUATION_REQUIRED', reasons: ['Benefit year has ended'] },
        },
      ],
      [{ type: 'SEPARATION', eventDate: '2026-12-01T05:59:59.999Z', employer: { companyName: 'Seasonal Co' } }]
    );
    expect(reevalEvents[1]?.title).toBe('Reevaluation required');
    expect(reevalEvents[1]?.detail).toBe('Benefit year has ended');

    const retainedEvents = buildClaimantTimeline(
      [],
      [
        {
          action: 'EMPLOYMENT_EXPIRATION_PROCESSED',
          targetId: 'sep-event-3',
          timestamp: '2026-12-05T09:00:00Z',
          metadata: { outcome: 'RETAINED_RESTRICTED', reasons: ['Still employed at Other Co'] },
        },
      ],
      [{ type: 'SEPARATION', eventDate: '2026-12-01T05:59:59.999Z', employer: { companyName: 'Seasonal Co' } }]
    );
    expect(retainedEvents[1]?.title).toBe('Claim remains restricted');
    expect(retainedEvents[1]?.detail).toBe('Still employed at Other Co');
  });

  it('deduplicates repeated audit entries for the same action, keeping only the latest', () => {
    // Simulates a demo application accepted/reset/re-accepted across
    // several replays: three INTERVIEW_ACCEPTED entries for the same
    // application, at different times.
    const events = buildClaimantTimeline(
      [application],
      [
        { action: 'INTERVIEW_ACCEPTED', targetId: 'app-1', timestamp: '2026-08-10T00:00:00Z', metadata: null },
        { action: 'INTERVIEW_ACCEPTED', targetId: 'app-1', timestamp: '2026-08-16T00:00:00Z', metadata: null },
        { action: 'INTERVIEW_ACCEPTED', targetId: 'app-1', timestamp: '2026-08-12T00:00:00Z', metadata: null },
      ],
      []
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.timestamp).toBe('2026-08-16T00:00:00.000Z');
  });

  it('deduplicates independently per action, not collapsing different actions on the same application', () => {
    const events = buildClaimantTimeline(
      [application],
      [
        { action: 'JOB_APPLICATION_SUBMITTED', targetId: 'app-1', timestamp: '2026-08-10T00:00:00Z', metadata: null },
        { action: 'JOB_APPLICATION_SUBMITTED', targetId: 'app-1', timestamp: '2026-08-11T00:00:00Z', metadata: null },
        { action: 'INTERVIEW_ACCEPTED', targetId: 'app-1', timestamp: '2026-08-12T00:00:00Z', metadata: null },
      ],
      []
    );
    expect(events.map((e) => e.title)).toEqual(['Applied', 'Interview accepted']);
  });

  it('sorts events from all sources into one chronological order regardless of input order', () => {
    const events = buildClaimantTimeline(
      [application],
      [{ action: 'JOB_APPLICATION_SUBMITTED', targetId: 'app-1', timestamp: '2026-08-10T00:00:00Z', metadata: null }],
      [{ type: 'HIRE', eventDate: '2026-08-05T00:00:00Z', employer: { companyName: 'Earlier Corp' } }]
    );
    expect(events.map((e) => e.title)).toEqual(['Hired', 'Applied']);
  });

  it('returns an empty array for a claimant with no applications, audit entries, or employment events', () => {
    expect(buildClaimantTimeline([], [], [])).toEqual([]);
  });
});
