// The source manifest. data/manifest.json is written by `npm run ingest` from sources.csv,
// and adds the collected_on date for every document. Links and dates in answers come only from here.
import manifest from "../data/manifest.json";

export interface SourceDoc {
  doc_id: string;
  scheme: string;
  plan: string;
  doc_type: string;
  title: string;
  publisher: string;
  url: string;
  collected_on: string | null;
  fetch_ok: boolean;
}

const DOCS = manifest as SourceDoc[];
const BY_ID = new Map(DOCS.map((d) => [d.doc_id, d]));

export function getDoc(docId: string): SourceDoc | undefined {
  return BY_ID.get(docId);
}

export function allDocs(): SourceDoc[] {
  return DOCS;
}
