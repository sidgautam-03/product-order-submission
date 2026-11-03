// Calendar days in this API are Asia/Kolkata (IST, UTC+05:30, no DST) days.
const IST_OFFSET = '+05:30';

export const isValidYmd = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// instant at which the IST day `ymd` begins
export const istDayStart = (ymd) => new Date(`${ymd}T00:00:00${IST_OFFSET}`);

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
