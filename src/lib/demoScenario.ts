export type DemoRole = 'claimant' | 'employer' | 'caseworker';

export type ScenarioLinks = {
  warehousePostingId: string;
  claimantProfileId: string;
};

export type DemoStep = {
  step: number;
  role: DemoRole;
  roleLabel: string;
  title: string;
  instruction: string;
  /** The page to navigate to for this step. Returns null for a step that
   * stays on the same page as the previous one (no navigation needed). */
  targetPath: (links: ScenarioLinks) => string | null;
  buttonLabel: string;
};

export const DEMO_ACCOUNT_CREDENTIALS: Record<DemoRole, { email: string; password: string }> = {
  claimant: { email: 'claimant@example.com', password: 'ClaimantPass123' },
  employer: { email: 'employer@example.com', password: 'EmployerPass123' },
  caseworker: { email: 'caseworker@example.com', password: 'CaseworkerPass123' },
};

// The session's own role field, distinct from DemoRole: NextAuth stores
// roles uppercase (matching the Prisma enum), while DemoRole is this
// module's own lowercase step-authoring vocabulary.
export const DEMO_ROLE_SESSION_VALUE: Record<DemoRole, 'CLAIMANT' | 'EMPLOYER' | 'CASEWORKER'> = {
  claimant: 'CLAIMANT',
  employer: 'EMPLOYER',
  caseworker: 'CASEWORKER',
};

export const DEMO_STEPS: DemoStep[] = [
  {
    step: 1,
    role: 'claimant',
    roleLabel: 'Seed Claimant, claimant@example.com',
    title: 'Accept a proposed interview time',
    instruction:
      "Seed Claimant applied to Warehouse Associate at Riverbend Logistics. The employer has proposed two interview times below — accept one (or note it's already confirmed if you're replaying this demo).",
    targetPath: () => '/claim/applications',
    buttonLabel: 'Next: switch to the employer',
  },
  {
    step: 2,
    role: 'employer',
    roleLabel: 'Riverbend Logistics Inc., employer@example.com',
    title: 'See the interview confirmed',
    instruction: 'See the interview status reflect what the claimant just chose.',
    targetPath: (links) => `/employer/job-postings/${links.warehousePostingId}`,
    buttonLabel: 'Next: hire the candidate',
  },
  {
    step: 3,
    role: 'employer',
    roleLabel: 'Riverbend Logistics Inc., employer@example.com',
    title: 'Hire the candidate',
    instruction: "Click Hire below to complete the process — watch what happens to Seed Claimant's benefit claim next.",
    targetPath: () => null,
    buttonLabel: 'Next: switch back to the claimant',
  },
  {
    step: 4,
    role: 'claimant',
    roleLabel: 'Seed Claimant, claimant@example.com',
    title: 'See the benefit claim change',
    instruction: "Seed Claimant's claim was Active — see it flip to Restricted the moment they were hired.",
    targetPath: () => '/claim/dashboard',
    buttonLabel: 'Next: switch to the caseworker',
  },
  {
    step: 5,
    role: 'caseworker',
    roleLabel: 'Caseworker, caseworker@example.com',
    title: 'Review the resulting case',
    instruction:
      'See how a caseworker reviews the resulting record: the hire event, claim status, wage records, certifications, and the audit trail behind every automated decision.',
    targetPath: (links) => `/staff/claimants/${links.claimantProfileId}`,
    buttonLabel: 'Finish',
  },
];
