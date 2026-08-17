// Converts a YYYY-MM-DD calendar date into the UTC instant corresponding to
// 23:59:59.999 in America/Chicago on that date — correctly accounting for
// whichever of CST (UTC-6) / CDT (UTC-5) applies. The lookup is evaluated at
// UTC noon on the given date specifically because noon is never ambiguous
// across a DST transition (which always happens at 2am local), so the
// offset this reads is always the one in effect for that date's night.
//
// This is the only place in the codebase that reasons about Central Time —
// everything downstream (storage, comparison, the expiration check's "is
// this due" test) works in plain UTC against the instant this returns.
export function centralTimeEndOfDayToUtc(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const noonGuess = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset',
  });
  const offsetPart = offsetFormatter
    .formatToParts(noonGuess)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (!offsetPart) {
    throw new Error(`Could not determine America/Chicago UTC offset for ${dateOnly}`);
  }
  // e.g. "GMT-6" -> -6, "GMT-5" -> -5
  const offsetHours = Number(offsetPart.replace('GMT', ''));

  const endOfDayAsIfUtc = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  return new Date(endOfDayAsIfUtc - offsetHours * 60 * 60 * 1000);
}
