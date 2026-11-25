// Rule-based checks that run before any search or model call.
// Order in the API route: personal data -> advice -> returns -> follow-up -> search.

const PII_PATTERNS: { kind: string; re: RegExp }[] = [
  // PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)
  { kind: "PAN", re: /\b[A-Za-z]{5}\s?[0-9]{4}\s?[A-Za-z]\b/ },
  // Aadhaar: 12 digits, often grouped 4-4-4
  { kind: "Aadhaar", re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },
  // Email address
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  // Indian mobile number, with or without +91
  { kind: "phone", re: /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/ },
  // OTP mentioned together with a 4-8 digit code
  { kind: "OTP", re: /\b(?:otp|one[\s-]time[\s-]password|verification code)\b[^0-9]{0,20}\d{4,8}\b|\b\d{4,8}\b[^0-9]{0,20}\b(?:otp|one[\s-]time[\s-]password)\b/i },
  // Account or folio number given with a label
  { kind: "account number", re: /\b(?:a\/c|acct|account|folio|bank)\s*(?:no\.?|number|num|#)?\s*(?:is|:|-)?\s*[A-Za-z]{0,4}\d{5,18}\b/i },
  // Any long run of digits (9+) is treated as an account-like number
  { kind: "account number", re: /\b\d{9,18}\b/ },
];

export function findPersonalData(text: string): string | null {
  for (const p of PII_PATTERNS) if (p.re.test(text)) return p.kind;
  return null;
}

// Advice and opinion, including disguised forms such as "Is this expense ratio too high?".
const ADVICE_PATTERNS: RegExp[] = [
  /\bshould\s+(i|we|one|my)\b/i,
  /\b(can|could|would)\s+you\s+(recommend|suggest|advise)\b/i,
  /\b(recommend|recommendation|suggest|advice|advise|advisable)\b/i,
  /\bis\s+(it|this|that|now)\s+(a\s+)?(good|bad|wise|safe|right|smart|great|ideal)\b/i,
  /\b(good|bad|right|best|ideal)\s+(time|fund|scheme|investment|option|choice|pick)\b/i,
  /\bworth\s+(it|investing|buying|holding)\b/i,
  /\b(better|best|safer|riskier|worse)\b.*\b(fund|scheme|option|than|choice|for me)\b/i,
  /\bwhich\s+(fund|scheme|one|plan)\b.*\b(better|best|choose|pick|go\s+for|buy|invest)\b/i,
  /\b(vs\.?|versus|compare|comparison)\b/i,
  /\btoo\s+(high|low|expensive|cheap|risky|much)\b/i,
  /\bis\s+(the|this|that|its|it)\b[^?]{0,40}\b(high|low|expensive|cheap|reasonable|fair|competitive|attractive|acceptable)\s*\??$/i,
  /\b(suitable|right)\s+for\s+(me|my|us|a\s+beginner|retirement)\b/i,
  /\b(my|our)\s+(portfolio|investments?|money|savings|goal)\b/i,
  /\bhow\s+much\s+(should|to|do\s+i\s+need\s+to)\s+invest\b/i,
  /\b(buy|sell|hold|exit|redeem|switch|stop|start)\s+(now|or\s+(sell|hold|buy|wait))\b/i,
  /\b(will|would)\s+(it|this\s+fund|the\s+fund|nav)\s+(go\s+up|rise|fall|grow|crash)\b/i,
  /\bsafe\s+to\s+invest\b/i,
  /\bgood\s+(for|to\s+(buy|invest|hold)|enough|choice|option|investment|idea|pick)\b/i,
  /^\s*(is|are)\s+(hdfc\s+)?[\w\s-]{0,40}\b(good|bad|safe|worth|wise|risky)\b/i,
];

export function isAdvice(text: string): boolean {
  return ADVICE_PATTERNS.some((re) => re.test(text));
}

const RETURNS_PATTERNS: RegExp[] = [
  /\breturns?\b(?!\s+(form|filing))/i,
  /\bperform(ance|ed|ing)?\b/i,
  /\b(cagr|xirr|irr|annuali[sz]ed|alpha|sharpe)\b/i,
  /\bnav\b.*\b(growth|grew|history|change|increase|went|movement|trend)\b/i,
  /\bhow\s+much\b.*\b(grow|grew|grown|earn|earned|make|made|gain|gained|give|gave|return)\b/i,
  /\b(beat|beaten|outperform|underperform)\w*\b/i,
  /\b(profit|gains?)\b.*\b(year|month|since|last)\b/i,
  /\b\d+\s*(%|percent)?\s*(per\s+annum|p\.?a\.?)\b.*\b(fund|scheme)\b/i,
];

export function isReturnsQuestion(text: string): boolean {
  return RETURNS_PATTERNS.some((re) => re.test(text));
}

// A follow-up leans on the previous question: it uses "it/its/this/that", starts with
// "and/what about", or is too short to stand on its own.
export function looksLikeFollowUp(text: string): boolean {
  const t = text.trim();
  const words = t.split(/\s+/).length;
  if (/^(and|also|what\s+about|how\s+about|same\s+for|and\s+the|what\s+of)\b/i.test(t)) return true;
  if (/\b(it|its|it's|this\s+fund|that\s+fund|the\s+same|this\s+one|that\s+one|this\s+scheme|that\s+scheme)\b/i.test(t)) return true;
  if (words <= 4) return true;
  return false;
}
