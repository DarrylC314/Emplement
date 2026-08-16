import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { candidateProfileSchema } from '@/lib/validation/candidateProfile';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.claimantProfileId) {
    return apiError('Claimant profile not found', 404);
  }

  const profile = await prisma.candidateProfile.findUnique({
    where: { claimantProfileId: session!.user.claimantProfileId },
    select: {
      id: true,
      headline: true,
      skills: true,
      bio: true,
      availability: true,
      tags: true,
    },
  });
  if (!profile) {
    return apiError('Candidate profile not found', 404);
  }

  return Response.json(profile);
}

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.claimantProfileId) {
    return apiError('Claimant profile not found', 404);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = candidateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const claimantProfile = await prisma.claimantProfile.findUnique({
    where: { id: session!.user.claimantProfileId },
    select: { identityVerificationStatus: true },
  });
  if (!claimantProfile || claimantProfile.identityVerificationStatus !== 'VERIFIED') {
    return apiError('You must verify your identity before creating a candidate profile', 403);
  }

  let profile;
  try {
    profile = await prisma.candidateProfile.create({
      data: {
        claimantProfileId: session!.user.claimantProfileId,
        headline: parsed.data.headline,
        skills: parsed.data.skills,
        bio: parsed.data.bio,
        availability: parsed.data.availability,
        tags: parsed.data.tags,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return apiError('You already have a candidate profile', 409);
    }
    throw err;
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CANDIDATE_PROFILE_CREATED',
    targetEntity: 'CandidateProfile',
    targetId: profile.id,
  });

  return Response.json(profile, { status: 201 });
}
