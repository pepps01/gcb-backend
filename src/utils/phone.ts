/**
 * Normalises Nigerian numbers to E.164 so "0801…", "234801…" and "+234801…"
 * all map to the same user. Other numbers are kept as-is (with a leading +).
 */
export function normalizePhone(raw: string): string {
    const p = raw.replace(/[\s()-]/g, '');
    if (/^0\d{10}$/.test(p)) return `+234${p.slice(1)}`;
    if (/^234\d{10}$/.test(p)) return `+${p}`;
    return p.startsWith('+') ? p : `+${p}`;
}
