// Interview times are always Central-time slots in this app's demo data
// (the seeded employer and postings are all Missouri-based) — fixed to
// America/Chicago explicitly rather than the viewer's own browser timezone,
// with a plain "CT" label rather than surfacing the CST/CDT distinction,
// which is more consistent for a pilot/demo than technically precise.
export function formatInterviewTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const formatted = date.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${formatted} CT`;
}
