// Generate training features for ML: CAM16-UCS, JzAzBz, OKLab, RGB linear, XYZ, ICtCp, IPT
// Input: android/app/src/main/assets/colormodel_precomputed.json (preferred) or colormodel.json
// Output: data/training_features.csv

const fs = require('fs');
const path = require('path');
const Color = require('colorjs.io');

const assetsDir = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'assets');
const precomputedPath = path.join(assetsDir, 'colormodel_precomputed.json');
const fallbackPath = path.join(assetsDir, 'colormodel.json');
const outputDir = path.resolve(__dirname, '..', 'data');
const outputPath = path.join(outputDir, 'training_features.csv');

function normalizeHex(hex) {
  if (!hex) return '#000000';
  hex = String(hex).trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (hex.length === 4) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex.toLowerCase();
}

function safeReadJSON(p) {
  try {
    let raw = fs.readFileSync(p, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function toLinear01(u) {
  // sRGB -> linear
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

function extractFeatures(hex) {
  try {
    const c = new Color(normalizeHex(hex));
    // Spaces
    let cam = [0, 0, 0], jz = [0, 0, 0], oklab = [0, 0, 0], xyz = [0, 0, 0], ictcp = [0, 0, 0], ipt = [0, 0, 0];
    try { const s = c.to('cam16ucs'); cam = s.coords.slice(0, 3); } catch (_) {}
    try { const s = c.to('jzazbz'); jz = s.coords.slice(0, 3); } catch (_) {}
    try { const s = c.to('oklab'); oklab = s.coords.slice(0, 3); } catch (_) {}
    try { const s = c.to('xyz'); xyz = s.coords.slice(0, 3); } catch (_) {}
    try { const s = c.to('ictcp'); ictcp = s.coords.slice(0, 3); } catch (_) {}
    try { const s = c.to('ipt'); ipt = s.coords.slice(0, 3); } catch (_) {}

    // RGB linear (0..1)
    let rlin = 0, glin = 0, blin = 0;
    try { const sr = c.to('srgb').coords; rlin = toLinear01(sr[0]); glin = toLinear01(sr[1]); blin = toLinear01(sr[2]); } catch (_) {}

    function fix(n) { const x = Number(n); return isFinite(x) ? x : 0; }

    return {
      cam_j: fix(cam[0]), cam_a: fix(cam[1]), cam_b: fix(cam[2]),
      jz_j: fix(jz[0]), jz_a: fix(jz[1]), jz_b: fix(jz[2]),
      okl_l: fix(oklab[0]), okl_a: fix(oklab[1]), okl_b: fix(oklab[2]),
      rgb_lin_r: fix(rlin), rgb_lin_g: fix(glin), rgb_lin_b: fix(blin),
      xyz_x: fix(xyz[0]), xyz_y: fix(xyz[1]), xyz_z: fix(xyz[2]),
      ict_i: fix(ictcp[0]), ict_ct: fix(ictcp[1]), ict_cp: fix(ictcp[2]),
      ipt_i: fix(ipt[0]), ipt_p: fix(ipt[1]), ipt_t: fix(ipt[2]),
    };
  } catch (_) {
    return {
      cam_j: 0, cam_a: 0, cam_b: 0,
      jz_j: 0, jz_a: 0, jz_b: 0,
      okl_l: 0, okl_a: 0, okl_b: 0,
      rgb_lin_r: 0, rgb_lin_g: 0, rgb_lin_b: 0,
      xyz_x: 0, xyz_y: 0, xyz_z: 0,
      ict_i: 0, ict_ct: 0, ict_cp: 0,
      ipt_i: 0, ipt_p: 0, ipt_t: 0,
    };
  }
}

function main() {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const data = safeReadJSON(precomputedPath) || safeReadJSON(fallbackPath);
  if (!Array.isArray(data)) throw new Error('Dataset not found or invalid');

  const headers = [
    'name','hex','family',
    'cam_j','cam_a','cam_b',
    'jz_j','jz_a','jz_b',
    'okl_l','okl_a','okl_b',
    'rgb_lin_r','rgb_lin_g','rgb_lin_b',
    'xyz_x','xyz_y','xyz_z',
    'ict_i','ict_ct','ict_cp',
    'ipt_i','ipt_p','ipt_t'
  ];
  const lines = [headers.join(',')];

  let written = 0;
  for (const row of data) {
    const f = extractFeatures(row.hex);
    const rec = [
      (row.name||'').replaceAll(',', ' '),
      normalizeHex(row.hex||'#000000'),
      (row.family||'').replaceAll(',', ' '),
      f.cam_j, f.cam_a, f.cam_b,
      f.jz_j, f.jz_a, f.jz_b,
      f.okl_l, f.okl_a, f.okl_b,
      f.rgb_lin_r, f.rgb_lin_g, f.rgb_lin_b,
      f.xyz_x, f.xyz_y, f.xyz_z,
      f.ict_i, f.ict_ct, f.ict_cp,
      f.ipt_i, f.ipt_p, f.ipt_t,
    ];
    lines.push(rec.join(','));
    written++;
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log('Wrote training features to:', outputPath, 'rows:', written);
}

main();
