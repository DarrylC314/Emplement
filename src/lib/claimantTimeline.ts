export type TimelineEvent = {
  timestamp: string;
  title: string;
  detail: string;
};

export type TimelineApplication = {
  id: string;
  jobPosting: { title: string; employer: { companyName: string | null } };
};

export type TimelineAuditEntry = {
  action: string;
  targetId: string;
  timestamp: string | Date;
  metadata: unknown;
};

export type TimelineEmploymentEvent = {
  type: 'HIRE' | 'SEPARATION';
  eventDate: string | Date;
  employer: { companyName: string | null };
};

// Audit actions written against a JobApplication's own id, in the order
// they'd naturally occur — see src/app/api/job-applications/route.ts,
// src/app/api/employer/job-applications/[id]/interview/route.ts, and
// src/app/api/job-applications/[id]/interview/{accept,decline}/route.ts.
// JOB_APPLICATION_HIRED is handled separately below: its own "Hired" fact
// is represented by the matching EmploymentEvent instead (both marketplace
// hires and manually-reported ones produce one, so that's the single
// consistent source for "hired"/"separated" — this map only derives the
// "claim automatically restricted" side effect from its audit metadata),
// so it's deliberately absent from this title map to avoid a duplicate
// "Hired" entry alongside the EmploymentEvent-sourced one.
const APPLICATION_AUDIT_TITLES: Record<string, string> = {
  JOB_APPLICATION_SUBMITTED: 'Applied',
  INTERVIEW_PROPOSED: 'Interview proposed',
  INTERVIEW_ACCEPTED: 'Interview accepted',
  INTERVIEW_DECLINED: 'Interview declined',
};

// Builds one clean, chronological story for a claimant's case page from
// three otherwise-separate data sources: the audit trail (application/
// interview lifecycle actions), and employer-reported events (the
// authoritative "hired"/"separated" fact, unified across both the
// marketplace hire flow and manually-reported employer events).
export function buildClaimantTimeline(
  applications: TimelineApplication[],
  auditEntries: TimelineAuditEntry[],
  employmentEvents: TimelineEmploymentEvent[]
): TimelineEvent[] {
  const applicationById = new Map(applications.map((a) => [a.id, a]));
  const events: TimelineEvent[] = [];

  // Employment events pushed before the audit-derived "claim restricted"
  // entry below: a hire and its automatic claim restriction happen in the
  // same transaction and share the exact same timestamp, so Array.sort's
  // stability (guaranteed since ES2019) preserves push order for that tie —
  // "Hired" reads as the cause, immediately followed by its consequence,
  // rather than the reverse.
  for (const event of employmentEvents) {
    events.push({
      timestamp: new Date(event.eventDate).toISOString(),
      title: event.type === 'HIRE' ? 'Hired' : 'Separated',
      detail: event.employer.companyName ?? 'an employer',
    });
  }

  // Keep only the most recent occurrence of each (action, application) pair.
  // A demo application gets accepted/hired/reset across repeated replays,
  // and the audit trail is deliberately never cleared by
  // POST /api/demo/reset (an appropriate permanent record even in a demo —
  // see that route's own comments), so it accumulates one entry per
  // replay. A real claimant's case wouldn't normally repeat the same
  // action this way, but the timeline should read as one clean story
  // regardless of how many times a demo application has been replayed.
  const latestByActionAndApplication = new Map<string, TimelineAuditEntry>();
  for (const entry of auditEntries) {
    const key = `${entry.action}:${entry.targetId}`;
    const existing = latestByActionAndApplication.get(key);
    if (!existing || new Date(entry.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
      latestByActionAndApplication.set(key, entry);
    }
  }
  const dedupedAuditEntries = [...latestByActionAndApplication.values()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const entry of dedupedAuditEntries) {
    const application = applicationById.get(entry.targetId);
    if (!application) continue;
    const employerName = application.jobPosting.employer.companyName ?? 'an employer';

    const timestamp = new Date(entry.timestamp).toISOString();
    const title = APPLICATION_AUDIT_TITLES[entry.action];
    if (title) {
      events.push({
        timestamp,
        title,
        detail: `${application.jobPosting.title} at ${employerName}`,
      });
    }

    if (entry.action === 'JOB_APPLICATION_HIRED') {
      const metadata = entry.metadata as { restrictedClaimCount?: number } | null;
      if (metadata?.restrictedClaimCount && metadata.restrictedClaimCount > 0) {
        events.push({
          timestamp,
          title: 'Claim automatically restricted',
          detail: `Triggered by the hire at ${employerName} — no manual review required.`,
        });
      }
    }
  }

  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
