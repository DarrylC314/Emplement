// One-time backfill: computes ssnHash for every ClaimantProfile that has an
// encrypted SSN on file but no hash yet (rows verified before this feature
// shipped). Decrypts each SSN once, in memory, only long enough to hash it —
// never logged, never written back in plaintext.
import { prisma } from '../src/lib/prisma';
import { decryptSSN } from '../src/lib/encryption';
import { hashSSN } from '../src/lib/ssnHash';

async function main() {
  const profiles = await prisma.claimantProfile.findMany({
    where: { ssnEncrypted: { not: null }, ssnHash: null },
  });
  console.log(`Backfilling ssnHash for ${profiles.length} claimant profile(s)...`);

  for (const profile of profiles) {
    const plain = decryptSSN(profile.ssnEncrypted!);
    const hash = hashSSN(plain);
    await prisma.claimantProfile.update({ where: { id: profile.id }, data: { ssnHash: hash } });
  }

  console.log('Backfill complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
