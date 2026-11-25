// Scheme names, loose-name aliases, and the documents each scheme links to in fixed replies.
export type SchemeId = "flexi-cap" | "mid-cap" | "balanced-advantage" | "general";

export interface SchemeInfo {
  id: SchemeId;
  name: string;
  aliases: RegExp[];
  directPageDoc?: string;
  regularPageDoc?: string;
  fundFactsDoc?: string;
}

export const SCHEMES: Record<SchemeId, SchemeInfo> = {
  "flexi-cap": {
    id: "flexi-cap",
    name: "HDFC Flexi Cap Fund",
    aliases: [/flexi\s*-?\s*cap/i, /flexicap/i, /\bhdfc\s+equity\s+fund\b/i],
    directPageDoc: "flexi-page-direct",
    regularPageDoc: "flexi-page-regular",
    fundFactsDoc: "flexi-fund-facts",
  },
  "mid-cap": {
    id: "mid-cap",
    name: "HDFC Mid Cap Fund",
    aliases: [/mid\s*-?\s*cap/i, /midcap/i, /mid\s*cap\s*opportunities/i],
    directPageDoc: "mid-page-direct",
    regularPageDoc: "mid-page-regular",
    fundFactsDoc: "mid-fund-facts",
  },
  "balanced-advantage": {
    id: "balanced-advantage",
    name: "HDFC Balanced Advantage Fund",
    aliases: [/balanced\s*-?\s*advantage/i, /\bbaf\b/i, /\bbalanced\s+fund\b/i, /\bhdfc\s+balanced\b/i],
    directPageDoc: "baf-page-direct",
    regularPageDoc: "baf-page-regular",
    fundFactsDoc: "baf-fund-facts",
  },
  general: { id: "general", name: "General question", aliases: [] },
};

export const SELECTABLE: SchemeId[] = ["flexi-cap", "mid-cap", "balanced-advantage", "general"];

export function isSchemeId(x: unknown): x is SchemeId {
  return typeof x === "string" && (SELECTABLE as string[]).includes(x);
}

/** Return the scheme named in the text, if exactly one scheme is named. */
export function detectScheme(text: string): SchemeId | null {
  const hits = (Object.values(SCHEMES) as SchemeInfo[]).filter((s) => s.aliases.some((re) => re.test(text)));
  return hits.length === 1 ? hits[0].id : null;
}

/** Return the plan the user named, if any. */
export function detectPlan(text: string): "direct" | "regular" | null {
  const d = /\bdirect\b/i.test(text);
  const r = /\bregular\b/i.test(text);
  if (d && !r) return "direct";
  if (r && !d) return "regular";
  return null;
}
