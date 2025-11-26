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

  // OKLCH + IPT + ICtCp based family classification rules
  // ICtCp provides brightness-robust detection for White/Black/Brown/Gray
  // IPT provides excellent skin-tone classification (light pink, peach, beige, pale violet)
  // OKLCH.h provides precise hue-based classification (red vs orange, pink vs red, blue vs violet, green vs yellow)
  function classifyFamily(L: number, C: number, h: number, Ipt: number, P: number, T: number, I_ictcp: number, Ct: number, Cp: number): string {
    // Use ICtCp I (brightness) for robust White/Black detection (immune to shadows/overexposure)
    const ictcpBrightness = I_ictcp || L; // Fallback to OKLCH L if ICtCp unavailable
    
    // Extremes - ICtCp I is more stable under varying lighting
    if (ictcpBrightness >= 0.92 || L >= 0.92) return 'White';
    if (ictcpBrightness <= 0.18 || L <= 0.18) return 'Black';

    // Use ICtCp Ct for chroma to better handle brightness variations (shadows, dim lighting, blue-tinted LEDs)
    const effectiveChroma = Math.max(C, Math.abs(Ct || 0) * 0.3); // Combine OKLCH C with ICtCp Ct
    
    // Desaturated gray - ICtCp helps identify grays under varied lighting
    if (effectiveChroma <= 0.02 && Math.abs(Cp || 0) < 0.01) return 'Gray';

    // Brown (dark/desaturated warm) and Beige/Peach (skin-like) using IPT + ICtCp
    const chromaLow = effectiveChroma < 0.08;
    const warmHue = h >= 20 && h <= 100;
    const ptMag = Math.hypot(P || 0, T || 0);
    
    // IPT excels at detecting skin-like colors: light pink, peach, beige, pale violet
    // Low P/T magnitude indicates muted, skin-like tones
    if (chromaLow && warmHue) {
      // Beige/Peach: medium-high lightness, low chroma, low PT -> Brown family (skin-like beige)
      // ICtCp helps maintain accuracy under shadows/dim lighting
      if ((ictcpBrightness >= 0.55 || L >= 0.55) && (ictcpBrightness <= 0.9 || L <= 0.9) && ptMag < 0.06) return 'Brown';
      // Dark warm desaturated -> Brown (ICtCp ensures accuracy in shadows)
      if (ictcpBrightness < 0.55 || L < 0.55) return 'Brown';
    }

    // Pink vs Red using OKLCH.h + IPT for light pink detection
    // Pink: higher lightness, lower chroma, IPT helps identify pastels
    if ((h >= 345 || h < 20)) {
      // IPT helps detect light pink, peach - low P/T with high I
      if ((L > 0.65 && effectiveChroma < 0.15) || (ptMag < 0.05 && Ipt > 0.6)) return 'Pink';
      return 'Red';
    }

    // Orange vs Yellow using OKLCH.h precision
    // Refined boundaries: Orange (20-50), Yellow transition (50-70), Yellow (70-100)
    if (h >= 20 && h < 50) return 'Orange';
    if (h >= 50 && h < 70) {
      // Transition zone: use chroma to distinguish (Orange is more saturated)
      return effectiveChroma > 0.12 ? 'Orange' : 'Yellow';
    }
    if (h >= 70 && h < 100) return 'Yellow';

    // Green vs Yellow - OKLCH.h boundary
    if (h >= 100 && h < 180) return 'Green';

    // Blue vs Violet - OKLCH.h precision
    // Blue (180-250), Violet transition (250-260), Violet (260-320)
    if (h >= 180 && h < 250) return 'Blue';
    if (h >= 250 && h < 260) {
      // Transition: use ICtCp for better discrimination under varied lighting
      return Math.abs(Ct || 0) > 0.08 ? 'Blue' : 'Violet';
    }
    if (h >= 260 && h < 320) return 'Violet';
    
    // Pink vs Violet for pastels (320-345) - IPT excels here for light pink, pale violet
    if (h >= 320 && h < 345) {
      // IPT helps identify light pink and pale violet pastels
      if ((L > 0.65 && effectiveChroma < 0.12) || (ptMag < 0.04 && Ipt > 0.65)) return 'Pink';
      return 'Violet';
    }

    // Default to Gray if nothing matches (with ICtCp validation)
    if (effectiveChroma <= 0.05 && Math.abs(Cp || 0) < 0.02) return 'Gray';
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
  const classifiedFamily = classifyFamily(L, C, h, Ipt, P, T, I_ictcp, Ct, Cp);

  const output: MatchResult = {
    detected_color_rgb: detectedRGB,
    detected_color_hex: normalizeHex(
      detectedRGB.map((v) => v.toString(16).padStart(2, '0')).join('')
    ),
    closest_match: { ...results[0], family: classifiedFamily },
    alternatives: results.slice(1, topN),
  };

  return output;
}
