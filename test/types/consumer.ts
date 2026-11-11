// Compiled by `npm run test:types`. It fails if index.d.ts stops describing
// how TypeScript users actually call the library.
import {
  VERSION,
  scanDomain,
  scanRepo,
  computeScore,
  detectVendors,
  safeFetch,
  FetchError,
  getVendor,
  type Report,
  type VendorRow,
  type Grade,
  type FetchErrorCode,
} from 'stackborder';
import vendorDb from 'stackborder/vendors.json' with { type: 'json' };

const version: string = VERSION;

async function example(): Promise<void> {
  const report: Report = await scanDomain('acme.eu', {
    onProgress: (step) => console.log(step.label, step.status satisfies 'running' | 'done' | 'skipped'),
  });
  const repo = await scanRepo('.');
  const grade: Grade | null = report.score.grade;
  const usVendors: VendorRow[] = [...report.vendors, ...repo.vendors].filter((v) => v.cloudAct);
  const tier: 'minimal' | 'limited' | undefined = report.aiSystems[0]?.suggestedTier;

  const score = computeScore([{ category: 'hosting', region: 'eu' }]);
  const found = detectVendors({ mx: ['aspmx.l.google.com'], npm: ['stripe'] });
  const evidence = found.get('stripe')?.[0]?.source;

  try {
    const res = await safeFetch('https://acme.eu', { timeoutMs: 5000 });
    console.log(res.status, res.address, res.redirects.length);
  } catch (err) {
    if (err instanceof FetchError) {
      const code: FetchErrorCode = err.code;
      console.log(code);
    }
  }

  console.log(version, grade, usVendors.length, tier, score.score, evidence, getVendor('hetzner')?.region, vendorDb);
}

void example;

// @ts-expect-error: detectVendors does not accept arbitrary keys
detectVendors({ unknownSignal: ['x'] });

// Coverage and unrecognized domains are part of every report.
async function coverageTypes(): Promise<void> {
  const report = await scanRepo('.');
  const files: number | undefined = report.coverage.repo?.sourceFiles;
  const homepage: 'ok' | 'blocked' | 'unreachable' | undefined = report.coverage.homepage;
  const domains: string[] = report.unrecognized.map((u) => u.domain);
  const found = detectVendors({ hosts: [{ host: 'api.openai.com', source: 'Source code' }], envKeys: [{ key: 'STRIPE_KEY', file: '.env.example' }] });
  void files; void homepage; void domains; void found;
}
void coverageTypes;
