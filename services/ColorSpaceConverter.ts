import Color from 'colorjs.io';

// This file contains the logic to convert an RGB color to the 21-feature vector
// required by the TensorFlow Lite model. The logic mirrors the Python implementation.

function toLinearRGB(srgb: number): number {
  return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

export function extractFeaturesFromRGB(rgb: { r: number; g: number; b: number }): number[] {
  const srgb = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const detectedColor = new (Color as any)('srgb', srgb as any);

  let cam = [0, 0, 0], jz = [0, 0, 0], oklab = [0, 0, 0], xyz = [0, 0, 0], ictcp = [0, 0, 0], ipt = [0, 0, 0];
  try { const s = detectedColor.to('cam16ucs'); cam = s.coords.slice(0, 3); } catch (_) {}
  try { const s = detectedColor.to('jzazbz'); jz = s.coords.slice(0, 3); } catch (_) {}
  try { const s = detectedColor.to('oklab'); oklab = s.coords.slice(0, 3); } catch (_) {}
  try { const s = detectedColor.to('xyz-d65'); xyz = s.coords.slice(0, 3); } catch (_) {}
  try { const s = detectedColor.to('ictcp'); ictcp = s.coords.slice(0, 3); } catch (_) {}
  try { const s = detectedColor.to('ipt'); ipt = s.coords.slice(0, 3); } catch (_) {}

  const r_lin = toLinearRGB(srgb[0]);
  const g_lin = toLinearRGB(srgb[1]);
  const b_lin = toLinearRGB(srgb[2]);

  const fix = (n: any) => (isFinite(n) ? n : 0);

  return [
    fix(cam[0]), fix(cam[1]), fix(cam[2]),
    fix(jz[0]), fix(jz[1]), fix(jz[2]),
    fix(oklab[0]), fix(oklab[1]), fix(oklab[2]),
    fix(r_lin), fix(g_lin), fix(b_lin),
    fix(xyz[0]), fix(xyz[1]), fix(xyz[2]),
    fix(ictcp[0]), fix(ictcp[1]), fix(ictcp[2]),
    fix(ipt[0]), fix(ipt[1]), fix(ipt[2]),
  ];
}

export function scaleFeatures(features: number[], scalingParams: { mean: number[], std: number[] }): number[] {
  if (features.length !== scalingParams.mean.length) {
    return features;
  }
  return features.map((val, i) => (val - scalingParams.mean[i]) / (scalingParams.std[i] + 1e-8));
}
