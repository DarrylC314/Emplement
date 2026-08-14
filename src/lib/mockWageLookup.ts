// A deterministic, simulated wage-record lookup — no real external call, no
// real payroll/wage integration (that's a later-phase subsystem). Follows
// the same shape of decision as the existing mocked identity verification
// (MockIDProof): stable output for a given input so demos and tests are
// reproducible, rather than random data that changes every run.

export type MockWageRecordResult = {
  employerName: string;
  fein: string;
  workLocation: string;
  jobTitle: string;
  wageRate: number;
  hoursPerWeek: number;
  separationReason: string;
  firstDayWorked: Date;
  lastDayWorked: Date | null;
  recallDate: Date | null;
};

type Template = {
  employerName: string;
  fein: string;
  workLocation: string;
  jobTitle: string;
  wageRate: number;
  hoursPerWeek: number;
  separationReason: string;
  daysAgoFirstWorked: number;
  daysAgoLastWorked: number | null; // null = no separation on file (still active)
  daysUntilRecall: number | null; // null = no recall date on file
};

const TEMPLATES: Template[] = [
  {
    employerName: 'Acme Manufacturing LLC',
    fein: '43-1234567',
    workLocation: 'Jefferson City, MO',
    jobTitle: 'Machinist',
    wageRate: 22.5,
    hoursPerWeek: 40,
    separationReason: 'Laid off — reduction in force',
    daysAgoFirstWorked: 730,
    daysAgoLastWorked: 14,
    daysUntilRecall: null,
  },
  {
    employerName: 'Riverbend Logistics Inc.',
    fein: '61-9876543',
    workLocation: 'Columbia, MO',
    jobTitle: 'Warehouse Associate',
    wageRate: 18.75,
    hoursPerWeek: 32,
    separationReason: 'Seasonal layoff',
    daysAgoFirstWorked: 400,
    daysAgoLastWorked: 21,
    daysUntilRecall: 60,
  },
];

/**
 * Simulated per-claim wage-record lookup. Roughly a third of claims (by hash
 * bucket) return no records at all — "no wage records found" is a real,
 * handled outcome the confirmation UI and review page must both cope with,
 * not just a theoretical edge case.
 */
export function generateMockWageRecords(claimId: string): MockWageRecordResult[] {
  const bucket = hashToIndex(claimId, 3);
  if (bucket === 2) return [];

  const template = TEMPLATES[bucket]!;
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

  return [
    {
      employerName: template.employerName,
      fein: template.fein,
      workLocation: template.workLocation,
      jobTitle: template.jobTitle,
      wageRate: template.wageRate,
      hoursPerWeek: template.hoursPerWeek,
      separationReason: template.separationReason,
      firstDayWorked: daysAgo(template.daysAgoFirstWorked),
      lastDayWorked: template.daysAgoLastWorked === null ? null : daysAgo(template.daysAgoLastWorked),
      recallDate: template.daysUntilRecall === null ? null : daysFromNow(template.daysUntilRecall),
    },
  ];
}

function hashToIndex(input: string, modulus: number): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % modulus;
}
