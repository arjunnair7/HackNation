// BUILD_PLAN Phase 5: regex redaction of IBANs, emails and phone numbers. Runs on vision output,
// transcript lines and answers before they are stored (and before screen events reach the agent).
// Must leave ERP data alone: amounts, invoice ids, PO numbers, cost centers, asset numbers, dates.

// IBAN shape: country code, 2 check digits, then 4-character groups ("DE89 3704 0044 0532 0130 00",
// also unspaced), or spelled out one character at a time ("D E 8 9 3 7 0 4 …").
const IBAN_GROUPED = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/gi;
const IBAN_SPELLED = /\b[A-Z] [A-Z] \d \d(?: [A-Z0-9]){11,30}\b/gi;
const MIN_IBAN_DIGITS = 8; // keeps product codes like "AB12 CDEF GHIJ" out
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Candidates start with +, 00 or a leading 0 / "(0"; counted afterwards so 4-digit codes never match.
const PHONE = /(?:\+|\b00|\(0|\b0)[\d\s\-/()]{7,}\d/g;

const MIN_PHONE_DIGITS = 9;
const MAX_PHONE_DIGITS = 15;

const iban = (m: string) => (m.replace(/\D/g, '').length >= MIN_IBAN_DIGITS ? '[IBAN]' : m);

export function redactText(text: string): string {
  return text
    .replace(EMAIL, '[EMAIL]')
    .replace(IBAN_SPELLED, iban)
    .replace(IBAN_GROUPED, iban)
    .replace(PHONE, (m) => {
      const digits = m.replace(/\D/g, '').length;
      return digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS ? '[PHONE]' : m;
    });
}

/** Redacts every string inside a JSON-like value (vision state, events). */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}
