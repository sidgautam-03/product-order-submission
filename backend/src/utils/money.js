// Money is integer paise everywhere; these helpers never do float math on it.

// "499.99" | 499.99 -> 49999. Returns null for anything that isn't a plain amount with <= 2 decimals.
export function rupeesToPaise(input) {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(input).trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

// 49999 -> 499.99
export function paiseToRupees(paise) {
  const rem = paise % 100;
  return Number(`${(paise - rem) / 100}.${String(rem).padStart(2, '0')}`);
}
