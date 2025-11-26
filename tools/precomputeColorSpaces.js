// Precompute CAM16-UCS and OKLCH for dataset entries to speed cold start
// Outputs a new file: android/app/src/main/assets/colormodel_precomputed.json

const fs = require('fs');
const path = require('path');
const Color = require('colorjs.io');

const inputPath = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'colormodel.json');
const outputPath = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'colormodel_precomputed.json');

function normalizeHex(hex) {
  if (!hex) return '#000000';
  hex = String(hex).trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (hex.length === 4) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex.toLowerCase();
}

function roundArray(arr, digits = 6) {
  const f = Math.pow(10, digits);
  return arr.map((v) => {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.round(n * f) / f;
  });
}

function main() {
  let raw = fs.readFileSync(inputPath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) {
    raw = raw.slice(1);
  }
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('Input dataset must be a JSON array');
  }

  const out = data.map((row) => {
    try {
      const hex = normalizeHex(row.hex || '#000000');
      // Compute CAM16-UCS and OKLCH if missing or invalid
      let cam = row.cam16ucs;
      let oklch = row.oklch;

      if (!Array.isArray(cam) || cam.length < 3 || cam.some((v) => !isFinite(Number(v)))) {
        try {
          const c = new Color(hex).to('cam16ucs');
          const coords = Array.isArray(c.coords) ? c.coords : [0, 0, 0];
          cam = roundArray(coords, 6);
        } catch (_) {
          cam = [0, 0, 0];
        }
      } else {
        cam = roundArray(cam, 6);
      }

      if (!Array.isArray(oklch) || oklch.length < 3 || oklch.some((v) => !isFinite(Number(v)))) {
        try {
          const c2 = new Color(hex).to('oklch');
          const coords2 = Array.isArray(c2.coords) ? c2.coords : [0, 0, 0];
          oklch = roundArray(coords2, 6);
        } catch (_) {
          oklch = [0, 0, 0];
        }
      } else {
        oklch = roundArray(oklch, 6);
      }

      return { ...row, cam16ucs: cam, oklch };
    } catch (e) {
      return { ...row, cam16ucs: [0, 0, 0], oklch: [0, 0, 0] };
    }
  });

  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote precomputed dataset to:', outputPath);
}

main();
