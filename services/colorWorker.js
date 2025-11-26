const Color = require('colorjs.io');
let dataset;
try {
  dataset = require('../android/app/src/main/assets/colormodel_precomputed.json');
} catch (_e) {
  dataset = require('../android/app/src/main/assets/colormodel.json');
}

function normalizeHex(hex) {
  if (!hex) return '#000000';
  hex = String(hex).trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (hex.length === 4) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex.toLowerCase();
}

function rgbToLab(rgb) {
  const srgb = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  const c = new (Color)('srgb', srgb);
  return c.to('lab');
}

const PRE = (dataset || []).map((row) => {
  try {
    let labColor = null;
    if (row.lab && Array.isArray(row.lab) && row.lab.length >= 3) {
      labColor = new (Color)('lab', row.lab);
    } else {
      labColor = new (Color)(normalizeHex(row.hex)).to('lab');
    }
    const hx = normalizeHex(row.hex).slice(1);
    const r = parseInt(hx.slice(0, 2), 16) || 0;
    const g = parseInt(hx.slice(2, 4), 16) || 0;
    const b = parseInt(hx.slice(4, 6), 16) || 0;
    let cam16ucsCoords = [0, 0, 0];
    let oklchCoords = [0, 0, 0];
    try {
      if (row.cam16ucs && row.cam16ucs.length >= 3) {
        cam16ucsCoords = [row.cam16ucs[0], row.cam16ucs[1], row.cam16ucs[2]];
      } else {
        const c = new (Color)(normalizeHex(row.hex)).to('cam16ucs');
        const cc = c.coords || [];
        cam16ucsCoords = [cc[0] || 0, cc[1] || 0, cc[2] || 0];
      }
    } catch (_e) {}
    try {
      if (row.oklch && row.oklch.length >= 3) {
        oklchCoords = [row.oklch[0], row.oklch[1], row.oklch[2]];
      } else {
        const c2 = new (Color)(normalizeHex(row.hex)).to('oklch');
        const cc2 = c2.coords || [];
        oklchCoords = [cc2[0] || 0, cc2[1] || 0, cc2[2] || 0];
      }
    } catch (_e2) {}
    return { ...row, labColor, rgb: [r, g, b], cam16ucsCoords, oklchCoords };
  } catch (e) {
    return { ...row, labColor: new (Color)('lab', [0, 0, 0]), rgb: [0, 0, 0], cam16ucsCoords: [0, 0, 0], oklchCoords: [0, 0, 0] };
  }
});

function findClosest(rgb, topN) {
  try {
    const srgb = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
    const detectedColor = new (Color)('srgb', srgb);
    let detectedCam, detectedOKLCH, detectedIPT, detectedICtCp;
    try { detectedCam = detectedColor.to('cam16ucs'); } catch (_e) { detectedCam = detectedColor; }
    try { detectedOKLCH = detectedColor.to('oklch'); } catch (_e2) { detectedOKLCH = detectedColor.to('lab'); }
    try { detectedIPT = detectedColor.to('ipt'); } catch (_e3) { detectedIPT = detectedColor; }
    try { detectedICtCp = detectedColor.to('ictcp'); } catch (_e4) { detectedICtCp = detectedColor; }
    const camCoords = (detectedCam && detectedCam.coords) ? detectedCam.coords : [0, 0, 0];
    const oklchCoords = (detectedOKLCH && detectedOKLCH.coords) ? detectedOKLCH.coords : [0, 0, 0];
    const iptCoords = (detectedIPT && detectedIPT.coords) ? detectedIPT.coords : [0, 0, 0];
    const ictcpCoords = (detectedICtCp && detectedICtCp.coords) ? detectedICtCp.coords : [0, 0, 0];

    const prefilterCount = Math.min(40, PRE.length);
    const rgbCandidates = PRE
      .map((row) => {
        const dr = rgb[0] - row.rgb[0];
        const dg = rgb[1] - row.rgb[1];
        const db = rgb[2] - row.rgb[2];
        const dist2 = dr * dr + dg * dg + db * db;
        return { row, dist2 };
      })
      .sort((a, b) => a.dist2 - b.dist2)
      .slice(0, prefilterCount)
      .map((r) => r.row);

    const results = rgbCandidates.map((row) => {
      let d = 9999;
      try {
        const j1 = camCoords[0], a1 = camCoords[1], b1 = camCoords[2];
        const j2 = row.cam16ucsCoords[0], a2 = row.cam16ucsCoords[1], b2 = row.cam16ucsCoords[2];
        const dj = (j1 - j2), da = (a1 - a2), dbb = (b1 - b2);
        d = Math.sqrt(dj * dj + da * da + dbb * dbb);
      } catch (_e3) {
        d = 9999;
      }
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
    function classifyFamily(L, C, h, Ipt, P, T, I_ictcp, Ct, Cp) {
      const ictcpBrightness = I_ictcp || L;
      if (ictcpBrightness >= 0.92 || L >= 0.92) return 'White';
      if (ictcpBrightness <= 0.18 || L <= 0.18) return 'Black';
      const effectiveChroma = Math.max(C, Math.abs(Ct || 0) * 0.3);
      if (effectiveChroma <= 0.02 && Math.abs(Cp || 0) < 0.01) return 'Gray';
      const chromaLow = effectiveChroma < 0.08;
      const warmHue = h >= 20 && h <= 100;
      const ptMag = Math.hypot(P || 0, T || 0);
      if (chromaLow && warmHue) {
        if ((ictcpBrightness >= 0.55 || L >= 0.55) && (ictcpBrightness <= 0.9 || L <= 0.9) && ptMag < 0.06) return 'Brown';
        if (ictcpBrightness < 0.55 || L < 0.55) return 'Brown';
      }
      if ((h >= 345 || h < 20)) {
        if ((L > 0.65 && effectiveChroma < 0.15) || (ptMag < 0.05 && Ipt > 0.6)) return 'Pink';
        return 'Red';
      }
      if (h >= 20 && h < 50) return 'Orange';
      if (h >= 50 && h < 70) return effectiveChroma > 0.12 ? 'Orange' : 'Yellow';
      if (h >= 70 && h < 100) return 'Yellow';
      if (h >= 100 && h < 180) return 'Green';
      if (h >= 180 && h < 250) return 'Blue';
      if (h >= 250 && h < 260) return Math.abs(Ct || 0) > 0.08 ? 'Blue' : 'Violet';
      if (h >= 260 && h < 320) return 'Violet';
      if (h >= 320 && h < 345) {
        if ((L > 0.65 && effectiveChroma < 0.12) || (ptMag < 0.04 && Ipt > 0.65)) return 'Pink';
        return 'Violet';
      }
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
    const out = {
      detected_color_rgb: rgb,
      detected_color_hex: normalizeHex(rgb.map((v) => v.toString(16).padStart(2, '0')).join('')),
      closest_match: { ...results[0], family: classifiedFamily },
      alternatives: results.slice(1, topN),
    };
    return out;
  } catch (e) {
    return null;
  }
}


const handleMessage = (raw) => {
  try {
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!msg || !msg.type) return;
    if (msg.type === 'match') {
      const res = findClosest(msg.rgb || [0, 0, 0], msg.topN || 3);
      const out = { type: 'result', id: msg.id, result: res };
      try {
        if (typeof postMessage === 'function') postMessage(JSON.stringify(out));
        else if (typeof global?.postMessage === 'function') global.postMessage(JSON.stringify(out));
      } catch (e) {
      }
    }
  } catch (e) {
  }
};

if (typeof self !== 'undefined' && typeof self.onmessage !== 'undefined') {
  self.onmessage = (ev) => handleMessage(ev.data);
} else if (typeof onmessage !== 'undefined') {
  onmessage = (ev) => handleMessage(ev.data);
} else if (typeof global !== 'undefined') {
  global.onmessage = (ev) => handleMessage(ev.data);
}


