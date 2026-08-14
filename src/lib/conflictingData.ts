export type WageRecordForConflictCheck = {
  id: string;
  lastDayWorked: Date | null;
  recallDate: Date | null;
};

export type ConflictFlag = { wageRecordId: string; message: string };

/**
 * Flags a wage record as conflicting with a certification's self-report when
 * the claimant reported no work/earnings for the week, but the wage record
 * indicates the job was still active during that week — no separation on
 * file, and either no recall date or one that has already passed (an
 * approved-layoff recall date still in the future is NOT a conflict: the
 * claimant isn't due back yet).
 */
export function findConflictingWageRecords(
  certification: { workedThisWeek: boolean; earnings: number; weekEndingDate: Date },
  wageRecords: WageRecordForConflictCheck[]
): ConflictFlag[] {
  if (certification.workedThisWeek || certification.earnings > 0) return [];

  const flags: ConflictFlag[] = [];
  for (const record of wageRecords) {
    const stillActive =
      record.lastDayWorked === null || record.lastDayWorked >= certification.weekEndingDate;
    const onApprovedLayoffThisWeek =
      record.recallDate !== null && record.recallDate > certification.weekEndingDate;
    if (stillActive && !onApprovedLayoffThisWeek) {
      flags.push({
        wageRecordId: record.id,
        message:
          'Claimant reported no work or earnings this week, but this employer record shows an active job with no approved layoff covering this week.',
      });
    }
  }
  return flags;
}
