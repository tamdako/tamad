import ColorTFLite from './ColorTFLiteNative';
import { findClosestColor } from './ColorMatcher';
import { extractFeaturesFromRGB, scaleFeatures } from './ColorSpaceConverter';

let featureScalingParams: { mean: number[], std: number[] } | null = null;
try {
  featureScalingParams = require('../python_ai/output/feature_scaling.json');
  console.log('ColorDetectorInference: Feature scaling parameters loaded successfully');
} catch (e) {
  console.warn('ColorDetectorInference: feature_scaling.json not found. Model will use fallback ColorMatcher. Run training script to generate this file.');
}

export type InferenceResult = { family: string; hex: string; realName: string; score?: number; confidence?: number }

async function ensureModelLoaded() {
  try {
    console.log("ColorDetectorInference: Attempting to load TensorFlow Lite model...");
    await ColorTFLite.loadModel();
    console.log("ColorDetectorInference: TensorFlow Lite model loaded successfully!");
    return true;
  } catch (e) {
    console.log("ColorDetectorInference: Failed to load TensorFlow Lite model:", e);
    return false;
  }
}


export async function inferColorFromRGB(rgb: { r: number; g: number; b: number }, confidenceThreshold = 0.6): Promise<InferenceResult | null> {
  try {
    console.log("ColorDetectorInference: Starting color inference for RGB:", rgb);
    const loaded = await ensureModelLoaded();
    
    if (!loaded) {
      console.log("ColorDetectorInference: Model not loaded, using fallback ColorMatcher");
      const match = findClosestColor([rgb.r, rgb.g, rgb.b], 3);
      return { family: match.closest_match.family || match.closest_match.name, hex: match.closest_match.hex, realName: match.closest_match.name };
    }

    console.log("ColorDetectorInference: Using TensorFlow Lite model for inference");
    if (!featureScalingParams) {
      console.warn('ColorDetectorInference: feature_scaling.json not loaded, using fallback ColorMatcher. Please run the training script to generate feature_scaling.json.');
      const match = findClosestColor([rgb.r, rgb.g, rgb.b], 3);
      return { family: match.closest_match.family || match.closest_match.name, hex: match.closest_match.hex, realName: match.closest_match.name };
    }

    const features = extractFeaturesFromRGB(rgb);
    const scaledFeatures = scaleFeatures(features, featureScalingParams);

    const res = await ColorTFLite.predict(scaledFeatures);
    console.log("ColorDetectorInference: TensorFlow Lite prediction result:", res);
    
    if (!res) {
      console.log("ColorDetectorInference: TensorFlow Lite prediction failed, using fallback");
      const match = findClosestColor([rgb.r, rgb.g, rgb.b], 3);
      return { family: match.closest_match.family || match.closest_match.name, hex: match.closest_match.hex, realName: match.closest_match.name };
    }
    
    const score = res.score ?? 0;
    const confidence = Math.max(0, Math.min(100, Math.round(score * 100)));
    const idx = res.index;
    console.log("ColorDetectorInference: Final prediction - Index:", idx, "Score:", score, "Conf%:", confidence, "Threshold:", confidenceThreshold);
    
    if (score >= confidenceThreshold) {
      const labels = require('../android/app/src/main/assets/labels.json') as string[];
      const label = labels[idx] || '';
      const match = findClosestColor([rgb.r, rgb.g, rgb.b], 3);
      const datasetFamily = (match.closest_match.family || '').trim();
      const chosenFamily = datasetFamily || label || match.closest_match.name;
      return { family: chosenFamily, hex: match.closest_match.hex, realName: match.closest_match.name, score, confidence };
    }
    
    const match = findClosestColor([rgb.r, rgb.g, rgb.b], 3);
    const datasetFamily = (match.closest_match.family || '').trim();
    const fallbackFamily = datasetFamily || match.closest_match.name;
    return { family: fallbackFamily, hex: match.closest_match.hex, realName: match.closest_match.name, score, confidence };
  } catch (e) {
    console.log("ColorDetectorInference: Error during inference:", e);
    try { const match = findClosestColor([rgb.r, rgb.g, rgb.b], 3); return { family: match.closest_match.family || match.closest_match.name, hex: match.closest_match.hex, realName: match.closest_match.name } } catch (_e2) { return null }
  }
}

export default { inferColorFromRGB }
