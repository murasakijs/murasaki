const ENGLISH_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Formats the calendar date encoded by git's ISO timestamp without converting
 * it through the server or browser timezone. The same HTML is therefore
 * rendered during SSR and hydration.
 *
 * @param {string} isoDate
 * @param {string} lang
 */
export function formatDocDate(isoDate, lang) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) throw new Error(`Invalid documentation date: ${isoDate}`);

  const [, year, month, day] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    throw new Error(`Invalid documentation date: ${isoDate}`);
  }

  return lang === "ja"
    ? `${year}年${monthNumber}月${dayNumber}日`
    : `${ENGLISH_MONTHS[monthNumber - 1]} ${dayNumber}, ${year}`;
}
