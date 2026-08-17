import { z } from 'zod';

export const CREDENTIAL_TYPE_VALUES = [
  'EDUCATION',
  'MILITARY_SERVICE',
  'LAW_ENFORCEMENT',
  'CERTIFICATION',
  'OTHER',
] as const;

export type CredentialTypeValue = (typeof CREDENTIAL_TYPE_VALUES)[number];

const educationDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  major: z.string().optional(),
  degreeType: z.string().optional(),
  graduationDate: z.string().optional(),
});

const militaryServiceDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  branch: z.string().min(1, 'Branch is required'),
  rank: z.string().optional(),
  dischargeType: z.string().optional(),
});

const lawEnforcementDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  agency: z.string().min(1, 'Agency is required'),
  role: z.string().optional(),
});

const certificationDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  certificationName: z.string().min(1, 'Certification name is required'),
  expirationDate: z.string().optional(),
});

const otherDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().min(1, 'Description is required'),
});

// One schema per CredentialType, each validated against the request's own
// type — never trust a client-supplied type/details pairing without this.
// schemaVersion is a literal today (only version 1 exists); a future shape
// change adds schemaVersion: 2 alongside it rather than replacing it, so
// old CredentialRecord rows stay parseable by whichever schema matches
// their own stamped detailsSchemaVersion.
export function parseCredentialDetails(type: CredentialTypeValue, details: unknown) {
  switch (type) {
    case 'EDUCATION':
      return educationDetailsSchema.safeParse(details);
    case 'MILITARY_SERVICE':
      return militaryServiceDetailsSchema.safeParse(details);
    case 'LAW_ENFORCEMENT':
      return lawEnforcementDetailsSchema.safeParse(details);
    case 'CERTIFICATION':
      return certificationDetailsSchema.safeParse(details);
    case 'OTHER':
      return otherDetailsSchema.safeParse(details);
  }
}

export const credentialRequestCreateSchema = z.object({
  claimantProfileId: z.string().optional(),
  organizationId: z.string().min(1, 'Organization is required'),
  credentialType: z.enum(CREDENTIAL_TYPE_VALUES),
  requestedTitle: z.string().optional(),
});

const credentialResponseConfirmSchema = z.object({
  confirmed: z.literal(true),
  title: z.string().min(1, 'Title is required'),
  eventDate: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
  details: z.record(z.unknown()),
});

const credentialResponseDenySchema = z.object({
  confirmed: z.literal(false),
  responseNote: z.string().optional(),
});

export const credentialResponseSchema = z.discriminatedUnion('confirmed', [
  credentialResponseConfirmSchema,
  credentialResponseDenySchema,
]);

export const proactiveCredentialReportSchema = z.object({
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in 123-45-6789 format'),
  type: z.enum(CREDENTIAL_TYPE_VALUES),
  title: z.string().min(1, 'Title is required'),
  eventDate: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
  details: z.record(z.unknown()),
});
