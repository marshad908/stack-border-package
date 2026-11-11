// Sovereignty score: how much of the stack stays under EU law.
// Published methodology (also shown on the website):
//   score = sum(weight(category) * factor(jurisdiction)) / sum(weight) * 100

export const CATEGORY_WEIGHTS = {
  hosting: 3, database: 3, storage: 3, email: 3, auth: 3,
  payments: 2, 'transactional-email': 2, 'marketing-email': 2, crm: 2, analytics: 2,
  monitoring: 2, support: 2, ai: 2, cdn: 2, communications: 2, search: 2, collaboration: 2,
  'email-security': 2, ecommerce: 2,
};

export function categoryWeight(category) {
  return CATEGORY_WEIGHTS[category] ?? 1;
}

/**
 * @param {{region:string, euRegionInUse?:boolean, euRegion?:boolean}} v
 * @returns {number} 0..1
 */
export function jurisdictionFactor(v) {
  switch (v.region) {
    case 'eu':
    case 'eea':
      return 1;
    case 'adequate':
      return 0.75;
    case 'us':
      if (v.euRegionInUse) return 0.4;
      return v.euRegion ? 0.3 : 0.2;
    case 'other':
      return 0.3;
    default:
      return 0.5;
  }
}

export function gradeFor(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'E';
}

/**
 * @param {Array<{category:string, region:string, euRegionInUse?:boolean, euRegion?:boolean}>} vendors
 */
export function computeScore(vendors) {
  if (!vendors.length) return { score: null, grade: null, eu: 0, nonEu: 0, cloudAct: 0, total: 0 };
  let weighted = 0;
  let weights = 0;
  for (const v of vendors) {
    const w = categoryWeight(v.category);
    weights += w;
    weighted += w * jurisdictionFactor(v);
  }
  const score = Math.round((weighted / weights) * 100);
  const eu = vendors.filter((v) => v.region === 'eu' || v.region === 'eea').length;
  return {
    score,
    grade: gradeFor(score),
    eu,
    nonEu: vendors.length - eu,
    cloudAct: vendors.filter((v) => v.region === 'us').length,
    total: vendors.length,
  };
}
