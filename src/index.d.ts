/** Version of this package, for example "0.1.0". */
export const VERSION: string;

export type Region = 'eu' | 'eea' | 'adequate' | 'us' | 'other' | 'unknown';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E';

export interface Evidence {
  source: string;
  value: string;
}

export interface Alternative {
  id: string;
  name: string;
  country: string;
  region: Region;
}

export interface Vendor {
  id: string;
  name: string;
  category: string;
  hq: string;
  country: string;
  region: Region;
  cloudAct: boolean;
  euRegion: boolean;
  recommend: boolean;
  subprocessors: string | null;
  ai?: { generative: boolean };
  euSignals?: string[];
  detect: Record<string, string[]>;
}

export interface VendorRow {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  hq: string;
  country: string;
  region: Region;
  cloudAct: boolean;
  euRegion: boolean;
  euRegionInUse: boolean;
  confidence: 'confirmed' | 'likely';
  subprocessors: string | null;
  ai: { generative: boolean } | null;
  evidence: Evidence[];
  alternatives: Alternative[];
}

export interface Score {
  score: number | null;
  grade: Grade | null;
  eu: number;
  nonEu: number;
  cloudAct: number;
  total: number;
}

export interface AiSystemSuggestion {
  vendorId: string;
  name: string;
  generative: boolean;
  suggestedTier: 'minimal' | 'limited';
  reason: string;
  evidence: Evidence[];
}

export interface Report {
  target: string;
  kind: 'domain' | 'repo';
  scannedAt: string;
  databaseVersion: string;
  score: Score;
  vendors: VendorRow[];
  aiSystems: AiSystemSuggestion[];
  /** Third-party domains the site loads from that match no vendor in the database. */
  unrecognized: UnrecognizedDomain[];
  /** What was checked, so readers can judge how complete the report is. */
  coverage: Coverage;
  notes: string[];
  meta: Record<string, unknown>;
  disclaimer: string;
}

export interface ProgressStep {
  id: string;
  label: string;
  status: 'running' | 'done' | 'skipped';
  detail?: string;
}

export interface FetchResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** True when the body was cut off at `maxBytes`. */
  truncated: boolean;
  /** Final URL after redirects. */
  url: string;
  /** The IP address the connection was pinned to. */
  address: string;
  tls: boolean;
  redirects: { url: string; status: number }[];
}

export interface SafeFetchOptions {
  /** Total time for the request including redirects. Default 10000. */
  timeoutMs?: number;
  /** Body size cap in bytes. Default 2000000. */
  maxBytes?: number;
  /** Default 4. */
  maxRedirects?: number;
  headers?: Record<string, string>;
  /** For tests only. Never enable for user-supplied URLs. */
  allowPrivate?: boolean;
}

export type FetchErrorCode = 'INPUT' | 'DNS' | 'PRIVATE' | 'PORT' | 'PROTOCOL' | 'TIMEOUT' | 'REDIRECTS' | 'NETWORK';

export class FetchError extends Error {
  constructor(message: string, code: FetchErrorCode);
  name: 'FetchError';
  code: FetchErrorCode;
}

/** Raw observations that vendor detection runs on. Every field is optional. */
export interface UnrecognizedDomain {
  domain: string;
  hosts: string[];
  source: string;
}

export interface RepoCoverage {
  manifests: number;
  sourceFiles: number;
  envFiles: number;
  /** True when the repository was too large to read completely. */
  truncated: boolean;
}

export interface Coverage {
  dns?: boolean;
  homepage?: 'ok' | 'blocked' | 'unreachable';
  /** Number of the site's own script files that were read. */
  scripts?: number;
  /** True when the site sends a Content-Security-Policy header. */
  csp?: boolean;
  repo?: RepoCoverage;
}

export interface HostSignal {
  host: string;
  /** Where the host was seen, e.g. "CSP header", "Page resource", "Source code". */
  source: string;
  /** File the host appears in, for source code. */
  where?: string;
  /** True for CSP wildcards such as *.stripe.com. */
  wildcard?: boolean;
}

export interface ScanSignals {
  ns?: string[];
  mx?: string[];
  spf?: string[];
  txt?: string[];
  cname?: string[];
  ptr?: string[];
  headers?: Record<string, string | string[] | undefined>;
  urls?: string[];
  html?: string;
  hosts?: HostSignal[];
  /** Full URLs written in source code, with the first file each appears in. */
  sourceUrls?: Array<{ url: string; where: string }>;
  npm?: string[];
  pypi?: string[];
  /** Variable names from .env.example style files. */
  envKeys?: Array<{ key: string; file: string }>;
}

export function scanDomain(domain: string, opts?: { onProgress?: (step: ProgressStep) => void }): Promise<Report>;
export function scanRepo(dir: string): Promise<Report>;
export function safeFetch(url: string | URL, opts?: SafeFetchOptions): Promise<FetchResult>;
export function normalizeDomain(input: string): string;
export function isPrivateAddress(ip: string): boolean;

export function loadVendorDb(): { version: string; vendors: Vendor[]; byId: Map<string, Vendor> };
export function listVendors(): Vendor[];
export function getVendor(id: string): Vendor | null;
export function alternativesFor(vendor: string | Vendor, limit?: number): Alternative[];
export function categoryLabel(category: string): string;
export const CATEGORY_LABELS: Record<string, string>;

export function regionOf(countryCode: string): Region;
export function countryName(countryCode: string): string;
export function cloudActExposed(countryCode: string): boolean;
export const REGION_LABELS: Record<Region, string>;
export const EU_MEMBERS: Set<string>;

export function computeScore(vendors: Array<Pick<VendorRow, 'category' | 'region'> & { euRegion?: boolean; euRegionInUse?: boolean }>): Score;
export function jurisdictionFactor(v: { region: Region | string; euRegion?: boolean; euRegionInUse?: boolean }): number;
export function categoryWeight(category: string): number;
export function gradeFor(score: number): Grade;
export const CATEGORY_WEIGHTS: Record<string, number>;

export function detectVendors(signals: ScanSignals): Map<string, Evidence[]>;
export function containsToken(haystack: string, needle: string): boolean;
export function buildReport(input: {
  target: string;
  kind: 'domain' | 'repo';
  vendors: VendorRow[];
  notes?: string[];
  meta?: Record<string, unknown>;
  coverage?: Coverage;
  unrecognized?: UnrecognizedDomain[];
}): Report;
export function unrecognizedDomains(
  seen: Array<{ host: string; source: string }>,
  isOwn: (host: string) => boolean,
  detected: Map<string, Evidence[]>,
): UnrecognizedDomain[];
export function mergeVendorRows(...lists: VendorRow[][]): VendorRow[];
export function toVendorRows(found: Map<string, Evidence[]>, extraText?: string): VendorRow[];
export const DISCLAIMER: string;

export function suggestAiSystems(vendors: VendorRow[]): AiSystemSuggestion[];
export const HIGH_RISK_AREAS: { id: string; label: string }[];
export const RISK_TIERS: Record<'unclassified' | 'minimal' | 'limited' | 'high' | 'prohibited', string>;
export const TRANSPARENCY_DUTIES: string[];

export function snapshotPage(url: string): Promise<{ url: string; status: number; lines: string[]; hash: string; fetchedAt: string }>;
export function htmlToLines(html: string): string[];
export function hashLines(lines: string[]): string;
export function diffLines(before: string[], after: string[]): { added: string[]; removed: string[] };
export function extractUrls(text: string): string[];
export function resourceUrls(html: string, pageUrl: string): Array<{ url: string; tag: string }>;
export function cspHosts(headers: Record<string, string | string[] | undefined>): Array<{ host: string; wildcard: boolean }>;
export function registrableDomain(host: string): string;
export function hostnameCandidates(text: string): Set<string>;
export function looksBlocked(res: { status: number; body: string; headers: Record<string, string | string[] | undefined> }): boolean;
