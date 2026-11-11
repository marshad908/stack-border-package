// First-pass EU AI Act inventory hints. This is a checklist, not a legal classification.

export const HIGH_RISK_AREAS = [
  { id: 'biometrics', label: 'Biometric identification or emotion recognition' },
  { id: 'critical-infrastructure', label: 'Safety parts of critical infrastructure (energy, water, traffic, digital infrastructure)' },
  { id: 'education', label: 'Admission, grading or proctoring in education' },
  { id: 'employment', label: 'Hiring, screening CVs, promotion, task allocation or monitoring workers' },
  { id: 'essential-services', label: 'Credit scoring, life or health insurance pricing, access to public benefits' },
  { id: 'law-enforcement', label: 'Law enforcement' },
  { id: 'migration', label: 'Migration, asylum or border control' },
  { id: 'justice', label: 'Courts, elections or democratic processes' },
];

export const RISK_TIERS = {
  unclassified: 'Not reviewed yet',
  minimal: 'Minimal risk',
  limited: 'Limited risk (transparency duties)',
  high: 'High risk',
  prohibited: 'Prohibited practice',
};

export const TRANSPARENCY_DUTIES = [
  'Tell people when they are talking to an AI system, unless it is obvious (Art. 50(1)).',
  'Mark AI-generated audio, image, video or text in a machine-readable way (Art. 50(2)).',
  'Disclose deepfakes and AI-generated text published to inform the public (Art. 50(4)).',
];

/**
 * Builds suggested inventory entries from detected AI vendors.
 * @param {Array<{id:string,name:string,ai?:{generative:boolean},evidence?:any[]}>} vendors
 */
export function suggestAiSystems(vendors) {
  return vendors
    .filter((v) => v.category === 'ai')
    .map((v) => ({
      vendorId: v.id,
      name: `Feature using ${v.name}`,
      generative: Boolean(v.ai?.generative),
      suggestedTier: v.ai?.generative ? 'limited' : 'minimal',
      reason: v.ai?.generative
        ? 'Generative model in use: transparency duties under Art. 50 probably apply. Check the use case against the high-risk list.'
        : 'Supporting AI infrastructure (vector store or tracing). Usually minimal risk on its own; classify the feature it powers.',
      evidence: v.evidence || [],
    }));
}
