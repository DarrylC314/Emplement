import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { proposeInterviewSchema } from '@/lib/validation/interview';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = proposeInterviewSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: params.id },
    select: {
      status: true,
      jobPosting: { select: { employerId: true } },
      candidateProfile: { select: { claimantProfileId: true } },
      interview: { select: { id: true, status: true } },
    },
  });
  if (!application) {
    return apiError('Application not found', 404);
  }
  if (application.jobPosting.employerId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }
  if (application.status !== 'PENDING') {
    return apiError('This application is no longer open', 409);
  }
  if (application.interview && application.interview.status !== 'DECLINED') {
    return apiError('This application already has an active interview', 409);
  }

  const slotDates = parsed.data.slots.map((s) => new Date(s));

  let interview;
  if (application.interview) {
    await prisma.interviewSlot.deleteMany({ where: { interviewId: application.interview.id } });
    interview = await prisma.interview.update({
      where: { id: application.interview.id },
      data: {
        status: 'PROPOSED',
        location: parsed.data.location ?? null,
        confirmedSlot: null,
        slots: { create: slotDates.map((startTime) => ({ startTime })) },
      },
    });
  } else {
    try {
      interview = await prisma.interview.create({
        data: {
          jobApplicationId: params.id,
          location: parsed.data.location ?? null,
          slots: { create: slotDates.map((startTime) => ({ startTime })) },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return apiError('This application already has an active interview', 409);
      }
      throw err;
    }
  }

  await prisma.message.create({
    data: {
      claimantId: application.candidateProfile.claimantProfileId,
      caseworkerId: null,
      subject: 'An employer proposed interview times',
      body: 'An employer has proposed interview times for one of your applications. Visit My Applications to respond.',
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'INTERVIEW_PROPOSED',
    targetEntity: 'JobApplication',
    targetId: params.id,
    metadata: { interviewId: interview.id, slotCount: slotDates.length },
  });

  return Response.json({ id: interview.id, status: interview.status }, { status: 201 });
}
