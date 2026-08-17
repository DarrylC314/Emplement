// Run on a schedule by the Render Cron Job defined in render.yaml — see
// npm script "check:employment-expirations". Never invoked by any page
// load; this is the real, unattended trigger the design spec requires for
// legally consequential claim-status changes. The manual staff route
// (src/app/api/staff/employment-expirations/run-check/route.ts) calls the
// same underlying function for demos and administrative recovery.
import { prisma } from '../src/lib/prisma';
import { runEmploymentExpirationCheck } from '../src/lib/employmentExpiration';

async function main() {
  const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
  console.log(`Employment expiration check complete: ${JSON.stringify(summary)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
