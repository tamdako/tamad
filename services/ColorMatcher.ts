import Color from 'colorjs.io';
let dataset: any;
try {
  // Prefer precomputed for faster cold start
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  dataset = require('../android/app/src/main/assets/colormodel_precomputed.json');
} catch (_e) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  dataset = require('../android/app/src/main/assets/colormodel.json');
}

export type ColorRow = {
  name: string;
  hex: string;
  family?: string;
  lab?: number[];
  cam16ucs?: number[];
  oklch?: number[];
};

export type MatchResult = {
  detected_color_rgb: number[];
  detected_color_hex: string;
  closest_match: {
    name: string;
    hex: string;
    family?: string;
    deltaE: number;
    confidence?: number;
  };
  alternatives: Array<{
    name: string;
    hex: string;
    family?: string;
    deltaE: number;
    confidence?: number;
  }>;
};

function normalizeHex(hex: string): string {
  if (!hex) return '#000000';
  hex = hex.trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (hex.length === 4) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex.toLowerCase();
}

type PrecomputedRow = ColorRow & { labColor: any };
type PrecomputedRowRGB = PrecomputedRow & { rgb: [number, number, number]; cam16ucsCoords: [number, number, number]; oklchCoords: [number, number, number] };
const PRECOMPUTED_DATASET: PrecomputedRowRGB[] = (dataset as ColorRow[]).map((row) => {
  try {
    let labColor: any = null;
    if (row.lab && Array.isArray(row.lab) && row.lab.length >= 3) {
      labColor = new (Color as any)('lab', row.lab);
    } else {
      labColor = new (Color as any)(normalizeHex(row.hex)).to('lab');
    }
    const hx = normalizeHex(row.hex).slice(1);
    const r = parseInt(hx.slice(0, 2), 16) || 0;
    const g = parseInt(hx.slice(2, 4), 16) || 0;
    const b = parseInt(hx.slice(4, 6), 16) || 0;
    let cam16ucsCoords: [number, number, number] = [0, 0, 0];
    let oklchCoords: [number, number, number] = [0, 0, 0];
    try {
      if (row.cam16ucs && row.cam16ucs.length >= 3) {
        cam16ucsCoords = [row.cam16ucs[0], row.cam16ucs[1], row.cam16ucs[2]] as [number, number, number];
      } else {
        const c = new (Color as any)(normalizeHex(row.hex)).to('cam16ucs');
        const cc = (c as any).coords || [];
        cam16ucsCoords = [cc[0] || 0, cc[1] || 0, cc[2] || 0];
      }
    } catch (_e) {}
    try {
      if (row.oklch && row.oklch.length >= 3) {
        oklchCoords = [row.oklch[0], row.oklch[1], row.oklch[2]] as [number, number, number];
      } else {
        const c = new (Color as any)(normalizeHex(row.hex)).to('oklch');
        const cc = (c as any).coords || [];
        oklchCoords = [cc[0] || 0, cc[1] || 0, cc[2] || 0];
      }
    } catch (_e2) {}
    return { ...row, labColor, rgb: [r, g, b], cam16ucsCoords, oklchCoords };
  } catch (e) {
    const labColor = new (Color as any)('lab', [0, 0, 0]);
    return { ...row, labColor, rgb: [0, 0, 0], cam16ucsCoords: [0, 0, 0], oklchCoords: [0, 0, 0] };
  }
});

export function findClosestColor(detectedRGB: number[], topN = 3): MatchResult {
  if (!Array.isArray(detectedRGB) || detectedRGB.length < 3) {
    throw new Error('detectedRGB must be an array of three numbers [r,g,b]');
  }

  const srgb: [number, number, number] = [detectedRGB[0] / 255, detectedRGB[1] / 255, detectedRGB[2] / 255];
  const detectedColor = new (Color as any)('srgb', srgb as any);
  let detectedCam: any;
  let detectedOKLCH: any;
  let detectedIPT: any;
  let detectedICtCp: any;
  try { detectedCam = detectedColor.to('cam16ucs'); } catch (_e) { detectedCam = detectedColor; }
  try { detectedOKLCH = detectedColor.to('oklch'); } catch (_e2) { detectedOKLCH = detectedColor.to('lab'); }
  try { detectedIPT = detectedColor.to('ipt'); } catch (_e3) { detectedIPT = detectedColor; }
  try { detectedICtCp = detectedColor.to('ictcp'); } catch (_e4) { detectedICtCp = detectedColor; }
  const camCoords = ((detectedCam as any).coords || [0, 0, 0]) as number[];
  const oklchCoords = ((detectedOKLCH as any).coords || [0, 0, 0]) as number[];
  const iptCoords = ((detectedIPT as any).coords || [0, 0, 0]) as number[];
  const ictcpCoords = ((detectedICtCp as any).coords || [0, 0, 0]) as number[];

  const prefilterCount = Math.min(40, PRECOMPUTED_DATASET.length);
  const rgbCandidates = PRECOMPUTED_DATASET
    .map((row) => {
      const dr = detectedRGB[0] - row.rgb[0];
      const dg = detectedRGB[1] - row.rgb[1];
      const db = detectedRGB[2] - row.rgb[2];
      const dist2 = dr * dr + dg * dg + db * db;
      return { row, dist2 };
    })
    .sort((a, b) => a.dist2 - b.dist2)
    .slice(0, prefilterCount)
    .map((r) => r.row);

  const results = rgbCandidates.map((row) => {
    let d = 9999;
    try {
      const [j1, a1, b1] = camCoords as [number, number, number];
      const [j2, a2, b2] = row.cam16ucsCoords as [number, number, number];
      const dj = (j1 - j2); const da = (a1 - a2); const dbb = (b1 - b2);
      d = Math.sqrt(dj * dj + da * da + dbb * dbb);
    } catch (_e) {
      d = 9999;
    }
    // Map CAM16-UCS distance to confidence (exponential falloff)
    const confidence = Math.round(100 * Math.exp(-Math.pow(d / 15, 2)));
    return {
      name: row.name,
      hex: normalizeHex(row.hex),
      family: row.family,
      deltaE: Number((isFinite(d) ? Number(d) : 9999).toFixed(2)),
      confidence,
    };
  });

  results.sort((a, b) => a.deltaE - b.deltaE);

  type ClassificationMeta = {
    ictcpBrightness: number;
    effectiveChroma: number;
    normalizedHue: number;
    hueStable: boolean;
    hueNearNeutral: boolean;
    allowNeutralClassification: boolean;
    lightColorGuard: boolean;
  };

  function getClassificationMeta(L: number, C: number, h: number, I_ictcp: number, Ct: number): ClassificationMeta {
    const ictcpBrightness = I_ictcp || L;
    const effectiveChroma = Math.max(C, Math.abs(Ct || 0) * 0.3);
    const normalizedHue = Number.isFinite(h) ? ((h % 360) + 360) % 360 : NaN;
    const hueStable = effectiveChroma >= 0.02 && Number.isFinite(normalizedHue);
    const hueNearNeutral = !Number.isFinite(normalizedHue) || normalizedHue < 15 || normalizedHue > 345;
    const allowNeutralClassification = !hueStable || hueNearNeutral || effectiveChroma < 0.02;
    const lightColorGuard = L > 0.75 && effectiveChroma >= 0.02;
    return { ictcpBrightness, effectiveChroma, normalizedHue, hueStable, hueNearNeutral, allowNeutralClassification, lightColorGuard };
  }

  // OKLCH + IPT + ICtCp based family classification rules
  // ICtCp provides brightness-robust detection for White/Black/Brown/Gray
  // IPT provides excellent skin-tone classification (light pink, peach, beige, pale violet)
  // OKLCH.h provides precise hue-based classification (red vs orange, pink vs red, blue vs violet, green vs yellow)
  function classifyFamily(meta: ClassificationMeta, L: number, h: number, Ipt: number, P: number, T: number, Cp: number): string {
    const { ictcpBrightness, effectiveChroma, normalizedHue, allowNeutralClassification, lightColorGuard } = meta;

    if (ictcpBrightness <= 0.2 || L <= 0.2) return 'Black';

    if (L > 0.92 && effectiveChroma < 0.02 && allowNeutralClassification) return 'White';

    if (!lightColorGuard) {
      const grayChromaLimit = L > 0.75 ? 0.015 : 0.03;
      const withinGrayLightness = L >= 0.2 && L <= 0.9;
      if (allowNeutralClassification && effectiveChroma < grayChromaLimit && withinGrayLightness && Math.abs(Cp || 0) < 0.015) {
        return 'Gray';
      }
    }

    const ptMag = Math.hypot(P || 0, T || 0);
    const isWarmHue = Number.isFinite(normalizedHue) && normalizedHue >= 20 && normalizedHue <= 80;
    if (isWarmHue && L >= 0.25 && L <= 0.55 && effectiveChroma < 0.14) return 'Brown';

    if ((normalizedHue >= 345 || normalizedHue < 20) && L >= 0.65 && L <= 0.95 && effectiveChroma < 0.2) {
      if (ptMag < 0.05 || Ipt > 0.6) return 'Pink';
    }

    if (normalizedHue >= 345 || normalizedHue < 20) return 'Red';
    if (normalizedHue >= 20 && normalizedHue < 50) return 'Orange';
    if (normalizedHue >= 50 && normalizedHue < 70) return effectiveChroma > 0.12 ? 'Orange' : 'Yellow';
    if (normalizedHue >= 70 && normalizedHue < 100) return 'Yellow';
    if (normalizedHue >= 100 && normalizedHue < 180) return 'Green';
    if (normalizedHue >= 180 && normalizedHue < 250) return 'Blue';
    if (normalizedHue >= 250 && normalizedHue < 260) return Math.abs(Cp || 0) > 0.08 ? 'Blue' : 'Violet';
    if (normalizedHue >= 260 && normalizedHue < 320) return 'Violet';
    if (normalizedHue >= 320 && normalizedHue < 345) {
      if ((L > 0.65 && effectiveChroma < 0.12) || (ptMag < 0.04 && Ipt > 0.65)) return 'Pink';
      return 'Violet';
    }

    if (allowNeutralClassification && effectiveChroma < 0.05) return 'Gray';
    return 'Gray';
  }

  const L = Number(oklchCoords[0] || 0);
  const C = Number(oklchCoords[1] || 0);
  const h = Number(oklchCoords[2] || 0);
  const Ipt = Number(iptCoords[0] || 0);
  const P = Number(iptCoords[1] || 0);
  const T = Number(iptCoords[2] || 0);
  const I_ictcp = Number(ictcpCoords[0] || 0);
  const Ct = Number(ictcpCoords[1] || 0);
  const Cp = Number(ictcpCoords[2] || 0);
  const classificationMeta = getClassificationMeta(L, C, h, I_ictcp, Ct);
  const classifiedFamily = classifyFamily(classificationMeta, L, h, Ipt, P, T, Cp);

  const detectedHex = normalizeHex(
    detectedRGB.map((v) => v.toString(16).padStart(2, '0')).join('')
  );
  const normalizeFamilyLabel = (value?: string) => (value || '').trim().toLowerCase();
  const classifiedFamilyKey = normalizeFamilyLabel(classifiedFamily);
  const topMatch = results[0];
  let displayMatch = topMatch;

  if (classifiedFamilyKey && topMatch) {
    const topFamilyKey = normalizeFamilyLabel(topMatch.family || topMatch.name);
    if (topFamilyKey !== classifiedFamilyKey) {
      const aligned = results.find(
        (row) => normalizeFamilyLabel(row.family || row.name) === classifiedFamilyKey
      );
      if (aligned) {
        displayMatch = aligned;
      } else {
        displayMatch = {
          ...topMatch,
          name: classifiedFamily,
          hex: detectedHex,
        };
      }
    }
  }

  const displayFamilyKey = normalizeFamilyLabel(displayMatch?.family || displayMatch?.name);
  const baseConfidence = displayMatch?.confidence ?? topMatch?.confidence ?? 0;
  const displayDelta = displayMatch?.deltaE ?? topMatch?.deltaE ?? 0;
  const deltaConfidence = Math.max(0, Math.min(100, Math.round(100 - Math.min(displayDelta, 40) * 2.2)));
  const classifierConfidence = Math.min(
    95,
    Math.max(
      40,
      (classificationMeta.hueStable ? 70 : 50) +
        (classificationMeta.lightColorGuard ? 10 : 0) +
        (displayFamilyKey === classifiedFamilyKey ? 5 : 0)
    )
  );
  const blendedConfidence = Math.round((baseConfidence + deltaConfidence + classifierConfidence) / 3);
  const finalConfidence = Math.max(baseConfidence, blendedConfidence, deltaConfidence, classifierConfidence);

  const output: MatchResult = {
    detected_color_rgb: detectedRGB,
    detected_color_hex: detectedHex,
    closest_match: displayMatch
      ? {
          ...displayMatch,
          hex: normalizeHex(displayMatch.hex),
          family: classifiedFamily,
          confidence: finalConfidence,
        }
      : {
          name: classifiedFamily,
          hex: detectedHex,
          family: classifiedFamily,
          deltaE: 0,
          confidence: finalConfidence || 100,
        },
    alternatives: results.slice(1, topN),
  };

  return output;
}
