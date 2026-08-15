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

  let succeeded = 0;
  let failed = 0;

  for (const profile of profiles) {
    // One corrupt row (e.g. ssnEncrypted that fails to decrypt) must not
    // abort the whole batch and leave every subsequent row un-backfilled.
    // Log only the profile id and the error — never the decrypted SSN or
    // any other PII — and move on.
    try {
      const plain = decryptSSN(profile.ssnEncrypted!);
      const hash = hashSSN(plain);
      await prisma.claimantProfile.update({ where: { id: profile.id }, data: { ssnHash: hash } });
      succeeded += 1;
    } catch (e) {
      failed += 1;
      console.error(`Failed to backfill ssnHash for claimant profile ${profile.id}:`, e);
    }
  }

  console.log(
    `Backfilled ${succeeded} of ${profiles.length} profile(s)` +
      (failed > 0 ? ` (${failed} failed — see log above).` : '.')
  );
  // Still fail the run (non-zero exit) if anything failed, so a CI/ops
  // invocation surfaces the problem — but only after every other row got its
  // chance to be processed.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
