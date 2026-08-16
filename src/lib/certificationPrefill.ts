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
  const endDate = new Date(weekEndingDate + 'T00:00:00Z');
  if (isNaN(endDate.getTime())) return [];

  const end = new Date(endDate);
  end.setUTCHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  start.setUTCHours(0, 0, 0, 0);

  return applications.filter((a) => {
    const created = new Date(a.createdAt);
    return created >= start && created <= end;
  });
}
