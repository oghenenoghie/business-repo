/** "2026-03" -> { start: "2026-03-01", end: "2026-03-31" } */
export function periodBounds(period: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`period must be YYYY-MM, got ${period}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = `${period}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${period}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}
