export type MarketplaceApplication = {
  id: string;
  createdAt: string;
  jobPosting: {
    title: string;
    employer: { companyName: string | null };
  };
};

export function filterApplicationsInWeek(
  applications: MarketplaceApplication[],
  weekEndingDate: string
): MarketplaceApplication[] {
  // weekEndingDate comes straight from a native <input type="date">
  // ("YYYY-MM-DD"), which is timezone-naive by design — it names a calendar
  // date, not an instant. This function only ever runs client-side, in the
  // claimant's own browser, so interpreting it (and the createdAt instants
  // it's compared against) in local time means "local" is genuinely the
  // claimant's own local time, not an arbitrary server/CI timezone. An
  // earlier UTC-explicit version avoided this by fixing both sides to UTC,
  // but that meant a late-evening local application could get UTC-rolled
  // into the next calendar day and silently miss the week it was actually
  // made in.
  const [year, month, day] = weekEndingDate.split('-').map(Number);
  if (!year || !month || !day) return [];

  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (isNaN(end.getTime())) return [];

  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  return applications.filter((a) => {
    const created = new Date(a.createdAt);
    return created >= start && created <= end;
  });
}
