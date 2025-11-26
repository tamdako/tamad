import React, { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, TouchableOpacity, TouchableWithoutFeedback, Platform, PermissionsAndroid, Image, PanResponder, Animated, ActivityIndicator, Alert, BackHandler } from 'react-native';
let RNExitApp: any = null;
try {
  const maybe = require('react-native-exit-app');
  RNExitApp = maybe?.default ?? maybe;
} catch (_e) {
  RNExitApp = null;
}
let captureRef: any = null;
try { captureRef = require('react-native-view-shot').captureRef; } catch (_e) { captureRef = null; }
import { ICONS } from '../../Images';
import { styles } from './ColorDetector.styles';
import { getFallbackColor, getJpegUtils, getJpegOrientation, decodeJpegAndSampleCenter as _decodeCenter, decodeJpegAndSampleAt as _decodeAt, hexToRgb, processWithIndicator, mapPressToPreviewCoords, mapLocalPressToPreviewCoords, normalizeBrightnessICtCp } from './ColorDetectorLogic';
import { findClosestColor, type MatchResult } from '../../services/ColorMatcher';
import { findClosestColorAsync } from '../../services/ColorMatcherWorker';
import { inferColorFromRGB } from '../../services/ColorDetectorInference';
import { speak, initTts, stop as stopTts } from '../../utils/tts';

let RNCamera: any = null;
let VisionCamera: any = null;
try { RNCamera = require('react-native-camera').RNCamera; } catch (err) { RNCamera = null; }
try { VisionCamera = require('react-native-vision-camera'); } catch (err) { VisionCamera = null; }
let runOnJS: any = null;
try { runOnJS = require('react-native-reanimated').runOnJS; } catch (_e) { runOnJS = null; }
let workletsCoreAvailable = false;
try {
  const wc = require('react-native-worklets-core');
  if (wc && typeof runOnJS === 'function') workletsCoreAvailable = true;
} catch (_e) { workletsCoreAvailable = false; }
import { CROSSHAIR_LENGTH_FACTOR, CROSSHAIR_LENGTH_FACTOR_FROZEN, CROSSHAIR_THICKNESS, CROSSHAIR_DOT_SIZE, CROSSHAIR_CONTAINER_SIZE } from './ColorDetector.styles';


interface ColorDetectorProps {
  onBack: () => void;
  openSettings: () => void;
  voiceEnabled?: boolean;
  colorCodesVisible?: boolean;
  voiceMode?: 'family' | 'real' | 'disable';
  showFamily?: boolean;
  showRealName?: boolean;
}

type DetectedColor = { family: string; hex: string; realName: string; confidence?: number };
type MatchLike = MatchResult | { closest_match?: { family?: string; name: string; hex: string; confidence?: number } | null } | null;
const SAMPLE_RADIUS_RATIO = 0.08;
const MIN_SAMPLE_RADIUS = 4;
const computeSampleHalf = (w: number, h: number): number => {
  if (!w || !h) return MIN_SAMPLE_RADIUS;
  const minDim = Math.min(w, h);
  if (!isFinite(minDim) || minDim <= 0) return MIN_SAMPLE_RADIUS;
  return Math.max(MIN_SAMPLE_RADIUS, Math.round(minDim * SAMPLE_RADIUS_RATIO));
};
const clampConfidence = (value?: number | null): number | undefined => {
  if (typeof value !== 'number' || !isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
};
const detectedFromMatch = (match: MatchLike): DetectedColor | null => {
  if (!match || !match.closest_match) return null;
  const { closest_match } = match;
  return {
    family: (closest_match.family || closest_match.name || '').trim() || closest_match.name,
    hex: closest_match.hex,
    realName: closest_match.name,
    confidence: clampConfidence(closest_match.confidence),
  };
};
const datasetFallbackDetected = (): DetectedColor => {
  const base = getFallbackColor();
  try {
    const rgb = hexToRgb(base.hex);
    const match = findClosestColor(rgb, 3);
    return detectedFromMatch(match) ?? base;
  } catch (_err) {
    return base;
  }
};

const ColorDetector: React.FC<ColorDetectorProps> = ({ onBack, openSettings, voiceEnabled=true, colorCodesVisible=true, voiceMode='family', showFamily=true, showRealName=true }) => {
  const insets = useSafeAreaInsets();
  const [detected, setDetected] = useState<DetectedColor | null>(null);
  const [liveDetected, setLiveDetected] = useState<DetectedColor | null>(null);
  const [frozenSnapshot, setFrozenSnapshot] = useState<DetectedColor | null>(null);
  const [freeze, setFreeze] = useState(false);
  const freezeRef = useRef<boolean>(false);
  const [crosshairPos, setCrosshairPos] = useState<{x:number,y:number}|null>(null);
  const intervalRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const previewLayout = useRef<{x:number,y:number,width:number,height:number}>({ x:0,y:0,width:0,height:0 });
  const previewRef = useRef<any>(null);
  
  const frozenImageUriRef = useRef<string | null>(null);
  const [previewSize, setPreviewSize] = useState<{width:number,height:number} | null>(null);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [tapMarker, setTapMarker] = useState<{ x:number, y:number, id:number } | null>(null);
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panResponder = useRef<any>(null);
  const [imageNaturalSize, setImageNaturalSize] = useState<{w:number,h:number} | null>(null);
  const [imageScaledSize, setImageScaledSize] = useState<{w:number,h:number} | null>(null);
  
  const suppressSpeechRef = useRef<boolean>(false);
  const freezeSpeakTimersRef = useRef<number[]>([]);
  const lastSpokenRef = useRef<number>(0);
  const LIVE_SPEAK_COOLDOWN = 1200;
  const [cameraPermission, setCameraPermission] = useState<string | null>(null);
  const [availableDevices, setAvailableDevices] = useState<any[] | null>(null);
  const availableDevice = availableDevices ? availableDevices.find((d:any) => d.position === 'back') ?? availableDevices[0] : null;
  const permissionInitializedRef = useRef(false);
  const exitAppPendingRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const processingFrameRef = useRef(false);

  const safeSpeak = (text: string, opts?: { force?: boolean }) => {
    try { if (suppressSpeechRef.current && !(opts && opts.force)) return false; } catch (_e) {}
    try {
      const res = speak(text);
      return res;
    } catch (err) {
      return false;
    }
  };

  useEffect(() => { try { initTts(); } catch (_e) {} }, []);
  useEffect(() => { exitAppPendingRef.current = false; }, []);

  const processSnapshotAndSample = async (): Promise<boolean> => {
    try {
      if (cameraPermission !== 'authorized') return false;
      if (cameraError) return false; // Don't process if camera has an error
      if (processingFrameRef.current) return false;
      if (freeze) return false;
      processingFrameRef.current = true;
      const ref = cameraRef.current as any;
      if (!ref) { processingFrameRef.current = false; return false; }
      let blobLike: any = null;
      try {
        if (ref.takeSnapshot) {
          blobLike = await ref.takeSnapshot({ quality: 0.25, skipMetadata: true, width: 320 });
        } else if (ref.takePhoto) {
          blobLike = await ref.takePhoto({ qualityPrioritization: 'speed', skipMetadata: true, width: 320 });
        } else if (ref.takePictureAsync) {
          blobLike = await ref.takePictureAsync({ quality: 0.3, base64: true, width: 320, doNotSave: true });
        }
      } catch (err) { blobLike = null; }
      if (!blobLike) { processingFrameRef.current = false; return false; }
      let base64: string | null = null;
      let uri: string | undefined = blobLike?.path || blobLike?.uri || blobLike?.localUri || blobLike?.filePath || blobLike?.file;
      try { if (uri && typeof uri === 'string' && uri.startsWith('/')) uri = 'file://' + uri; } catch (_e) {}
      try {
        if (uri && typeof uri === 'string' && (uri.startsWith('file://') || uri.startsWith('content://'))) {
          try {
            const normalizedUri = (uri.startsWith('/') ? ('file://' + uri) : uri);
            const { decodeScaledRegion } = require('../../services/ImageDecoder');
            if (typeof decodeScaledRegion === 'function') {
              const pw = previewLayout.current?.width || 0;
              const ph = previewLayout.current?.height || 0;
              const cx = pw ? Math.round(pw / 2) : 0;
              const cy = ph ? Math.round(ph / 2) : 0;
              const nativeSample = await decodeScaledRegion(normalizedUri, cx, cy, pw, ph);
              if (nativeSample && typeof nativeSample.r === 'number') {
                const adj = normalizeBrightnessICtCp({ r: nativeSample.r, g: nativeSample.g, b: nativeSample.b });
                const inferred = await inferColorFromRGB({ r: adj.r, g: adj.g, b: adj.b }).catch(() => null);
                if (inferred) {
                  const live: DetectedColor = { family: inferred.family, hex: inferred.hex, realName: inferred.realName, confidence: inferred.confidence };
                  if (!freeze) setLiveDetected(live);
                  processingFrameRef.current = false;
                  return true;
                }
              }
            }
          } catch (nativeErr) {}
        }
      } catch (_e) {}
      if (blobLike?.base64) base64 = blobLike.base64;
      if (!base64 && uri && typeof uri === 'string' && uri.startsWith('file://')) {
        try { const RNFS = require('react-native-fs'); base64 = await RNFS.readFile(uri.replace('file://',''), 'base64'); } catch (_e) {}
      }
      if (!base64) { processingFrameRef.current = false; return false; }
      try {
        const { jpegjs: _jpegjs, BufferShim: _BufferShim } = getJpegUtils();
        if (!_jpegjs || !_BufferShim) { processingFrameRef.current = false; return false; }
        if (base64.length > 5_000_000) { processingFrameRef.current = false; return false; }
        const buffer = _BufferShim.from(base64, 'base64');
        const decoded = _jpegjs.decode(buffer, { useTArray: true });
        if (!decoded || !decoded.width || !decoded.data) { processingFrameRef.current = false; return false; }
        const w = decoded.width; const h = decoded.height; const data = decoded.data;
        const cx = Math.floor(w/2); const cy = Math.floor(h/2);
        let rSum=0,gSum=0,bSum=0,count=0;
        for (let yy = Math.max(0, cy-1); yy <= Math.min(h-1, cy+1); yy++) {
          for (let xx = Math.max(0, cx-1); xx <= Math.min(w-1, cx+1); xx++) {
            const idx = (yy * w + xx) * 4;
            rSum += data[idx]; gSum += data[idx+1]; bSum += data[idx+2]; count++;
          }
        }
        if (count === 0) { processingFrameRef.current = false; return false; }
        const sampled = { r: Math.round(rSum/count), g: Math.round(gSum/count), b: Math.round(bSum/count) };
        const adj = normalizeBrightnessICtCp(sampled);
        try {
          const inferred = await inferColorFromRGB({ r: adj.r, g: adj.g, b: adj.b }).catch(() => null);
          if (inferred) {
            const live: DetectedColor = { family: inferred.family, hex: inferred.hex, realName: inferred.realName, confidence: inferred.confidence };
            if (!freeze) setLiveDetected(live);
            processingFrameRef.current = false;
            return true;
          }
        } catch (err) {}
      } catch (err) {}
      processingFrameRef.current = false;
      return false;
    } catch (err) { processingFrameRef.current = false; return false; }
  };

  const sampleFromPreviewSnapshot = async (relX: number, relY: number): Promise<{r:number,g:number,b:number}|null> => {
    try {
      if (!captureRef) return null;
      if (!previewRef.current) return null;
      const pw = previewLayout.current.width || 0;
      const ph = previewLayout.current.height || 0;
      if (!pw || !ph) return null;
      const tmp = await captureRef(previewRef.current, { format: 'png', quality: 0.9, result: 'tmpfile', width: Math.round(pw), height: Math.round(ph) });
      if (!tmp) return null;
      const normalized = (typeof tmp === 'string' && tmp.startsWith('/')) ? ('file://' + tmp) : tmp;
      try {
        const { decodeScaledRegion } = require('../../services/ImageDecoder');
        if (typeof decodeScaledRegion === 'function') {
          const nativeSample = await decodeScaledRegion(normalized, relX, relY, pw, ph);
          if (nativeSample && typeof nativeSample.r === 'number') return { r: nativeSample.r, g: nativeSample.g, b: nativeSample.b };
        }
      } catch (err) {}
      return null;
    } catch (err) { return null; }
  };

  let frameProcessor: any = null;
  try {
    if (workletsCoreAvailable && VisionCamera && (VisionCamera as any).useFrameProcessor) {
      const useFP = (VisionCamera as any).useFrameProcessor;
      frameProcessor = useFP((frame: any) => {
        'worklet';
        if ((globalThis as any).__clFPCount == null) (globalThis as any).__clFPCount = 0;
        (globalThis as any).__clFPCount = ((globalThis as any).__clFPCount + 1) | 0;
        if (((globalThis as any).__clFPCount % 20) !== 0) return;
        try { if (typeof runOnJS === 'function') runOnJS(processSnapshotAndSample)(); } catch (_e) {}
      }, []);
    }
  } catch (_e) { frameProcessor = null; }

  useEffect(() => {
    const checkPermission = async () => {
      try {
        if (Platform.OS === 'android') {
          const has = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
          setCameraPermission(has ? 'authorized' : 'denied');
        } else if (VisionCamera) {
          if (VisionCamera.getCameraPermissionStatus) {
            const status = await VisionCamera.getCameraPermissionStatus();
            setCameraPermission(status);
          } else if (VisionCamera.Camera && VisionCamera.Camera.getCameraPermissionStatus) {
            const status = await VisionCamera.Camera.getCameraPermissionStatus();
            setCameraPermission(status);
          } else setCameraPermission(null);
        }
      } catch (err) { setCameraPermission(null); }
      permissionInitializedRef.current = true;
    };
    checkPermission();
    try {
      const probe = async () => {
        try { const { pingWorker } = require('../../services/ColorMatcherWorker'); if (typeof pingWorker === 'function') await pingWorker(500); } catch (_e) {}
      };
      probe();
    } catch (_e) {}
    return () => {
      stopDetection();
      try {
        const ref = cameraRef.current as any;
        if (ref) {
          // Stop any active camera preview
          if (typeof ref.stopPreview === 'function') try { ref.stopPreview(); } catch (_e) {}
          if (typeof ref.pausePreview === 'function') try { ref.pausePreview(); } catch (_e) {}
          // Release camera device for VisionCamera
          if (VisionCamera && typeof ref.destroy === 'function') {
            try { ref.destroy(); } catch (_e) {}
          }
          try { cameraRef.current = null; } catch (_e) {}
        }
      } catch (_e) {}
      // Clear camera error state on cleanup
      setCameraError(null);
    };
  }, []);

  useEffect(() => {
    const discover = async () => {
      if (!VisionCamera) return;
      if (cameraPermission !== 'authorized') {
        // Clear camera error when permission is not authorized
        setCameraError(null);
        return;
      }
      try {
        // Clear previous error before discovering devices
        setCameraError(null);
        if (VisionCamera.getAvailableCameraDevices) {
          const list = await VisionCamera.getAvailableCameraDevices(); setAvailableDevices(list ?? null); return;
        }
        if (VisionCamera.Camera && VisionCamera.Camera.getAvailableCameraDevices) {
          const list = await VisionCamera.Camera.getAvailableCameraDevices(); setAvailableDevices(list ?? null); return;
        }
      } catch (err) {
        console.warn('Failed to discover camera devices:', err);
      }
    };
    discover();
    if (cameraPermission === 'authorized') startDetection();
    else stopDetection();
  }, [cameraPermission]);

  useEffect(() => {
    if (!liveDetected || !voiceEnabled || freeze) return;
    if (voiceMode === 'disable') return;
    try {
      const now = Date.now();
      if (now - lastSpokenRef.current < LIVE_SPEAK_COOLDOWN) return;
      const textToSpeak = voiceMode === 'real' ? liveDetected.realName : liveDetected.family;
      const ok = safeSpeak(textToSpeak);
      lastSpokenRef.current = now;
    } catch (err) {}
  }, [liveDetected, voiceEnabled, freeze, voiceMode]);

  const startDetection = () => {
    stopDetection();
    intervalRef.current = setInterval(() => {
      if (!freezeRef.current) {
        processSnapshotAndSample().then((ok) => {
          if (!ok) {
            setLiveDetected(datasetFallbackDetected());
          }
        }).catch(() => {
          setLiveDetected(datasetFallbackDetected());
        });
      }
    }, 800);
  };

  const stopDetection = () => { if (intervalRef.current) clearInterval(intervalRef.current); intervalRef.current = null; };

  const toggleFreeze = () => {
    const next = !freeze; setFreeze(next); freezeRef.current = next; if (next) suppressSpeechRef.current = true;
    if (!next) { setCrosshairPos(null); setFrozenSnapshot(null); frozenImageUriRef.current = null; setSelectedImageUri(null); }
    else {
      setTimeout(() => {
        try {
          if (previewRef.current && previewRef.current.measureInWindow) {
            previewRef.current.measureInWindow((px: number, py: number, pw: number, ph: number) => {
              previewLayout.current = { x: px, y: py, width: pw, height: ph };
              const center = { x: pw / 2, y: ph / 2 };
              setCrosshairPos(center);
              setFrozenSnapshot(liveDetected as DetectedColor | null);
              (async () => {
                try {
                  const ref: any = cameraRef.current;
                  if (ref && (ref.takeSnapshot || ref.takePhoto || ref.takePicture || ref.takePictureAsync || ref.capture)) {
                    const take = ref.takeSnapshot ? 'takeSnapshot' : ref.takePhoto ? 'takePhoto' : ref.takePicture ? 'takePicture' : ref.takePictureAsync ? 'takePictureAsync' : 'capture';
                    try {
                      const out = await (ref as any)[take]({ qualityPrioritization: 'speed', skipMetadata: true, width: 640, base64: false });
                      const uri = out?.path || out?.uri || out?.localUri || out?.file || null;
                      if (uri) { const normalized = (typeof uri === 'string' && uri.startsWith('/')) ? ('file://' + uri) : uri; frozenImageUriRef.current = normalized; }
                    } catch (_e) { frozenImageUriRef.current = null; }
                  }
                } catch (_e) { frozenImageUriRef.current = null; }
              })();
              try {
                if (voiceEnabled && voiceMode !== 'disable' && liveDetected) {
                    try { freezeSpeakTimersRef.current.forEach((tid) => { try { clearTimeout(tid as any); } catch (_e) {} }); } catch (_e) {}
                    freezeSpeakTimersRef.current = [];
                    const textToSpeak = voiceMode === 'real' ? liveDetected.realName : liveDetected.family;
                    const tid = setTimeout(() => { try { const maybe = safeSpeak(textToSpeak, { force: true }); Promise.resolve(maybe).catch(() => {}); } catch (err) {} }, 600) as unknown as number;
                    try { freezeSpeakTimersRef.current.push(tid); } catch (_e) {}
                    setTimeout(() => { try { suppressSpeechRef.current = false; } catch (_e) {} }, 800);
                  } else if (voiceEnabled && voiceMode !== 'disable' && !liveDetected) {
                    (async () => { try { const c = await captureAndSampleCenter(); if (c) { setFrozenSnapshot(c);
                          try { freezeSpeakTimersRef.current.forEach((tid) => { try { clearTimeout(tid as any); } catch (_e) {} }); } catch (_e) {}
                          freezeSpeakTimersRef.current = [];
                          const textToSpeak = voiceMode === 'real' ? c.realName : c.family;
                          const tid2 = setTimeout(() => { try { const maybe2 = safeSpeak(textToSpeak, { force: true }); Promise.resolve(maybe2).catch(() => {}); } catch (err) {} }, 600) as unknown as number;
                          try { freezeSpeakTimersRef.current.push(tid2); } catch (_e) {}
                          setTimeout(() => { try { suppressSpeechRef.current = false; } catch (_e) {} }, 800);
                      } } catch (_e) {} })();
                  }
              } catch (_e) {}
            });
          }
        } catch (err) { setCrosshairPos(null); }
      }, 50);
    }
  };

  const onScreenPress = async (e: any) => {
    if (!freeze) return;
    try {
      const { relX, relY } = await mapPressToPreviewCoords(e, previewRef, previewLayout);
      try {
        const markerId = Date.now();
        setTapMarker({ x: Math.round(relX), y: Math.round(relY), id: markerId });
        try { setTimeout(() => { try { setTapMarker((cur) => cur && cur.id === markerId ? null : cur); } catch (_e) {} }, 5000); } catch (_e) {}
      } catch (_e) {}
      try {
        if (selectedImageUri && imageScaledSize && previewLayout.current) {
          let panX = 0, panY = 0; try { panX = (pan.x as any).__getValue ? (pan.x as any).__getValue() : 0; } catch (_e) { panX = 0; } try { panY = (pan.y as any).__getValue ? (pan.y as any).__getValue() : 0; } catch (_e) { panY = 0; }
          const pw = previewLayout.current.width || 0; const ph = previewLayout.current.height || 0;
          const imageLeft = Math.round((pw - imageScaledSize.w) / 2) + panX; const imageTop = Math.round((ph - imageScaledSize.h) / 2) + panY;
          if (relX < imageLeft || relY < imageTop || relX > imageLeft + imageScaledSize.w || relY > imageTop + imageScaledSize.h) return;
          try { setCrosshairPos({ x: relX, y: relY }); } catch (_e) {}
        } else { try { setCrosshairPos({ x: relX, y: relY }); } catch (_e) {} }
      } catch (_e) { try { setCrosshairPos({ x: relX, y: relY }); } catch (_e2) {} }
      let selectedSample: any = null;
      const trySampleUploadedImage = async () => { try { if (selectedImageUri) { const res = await sampleUploadedImageAt(relX, relY); if (res) return res; } } catch (_e) {} return null; };
      try {
        const uploadedRes = await trySampleUploadedImage();
        if (uploadedRes && (uploadedRes as any).offImage) return;
        if (uploadedRes) { selectedSample = uploadedRes; setDetected(selectedSample); setFrozenSnapshot(selectedSample); }
        else {
          if (frozenImageUriRef.current) {
            try {
              const uri = frozenImageUriRef.current;
              try {
                const { decodeScaledRegion } = require('../../services/ImageDecoder');
                const nativeSample = await decodeScaledRegion(uri, relX, relY, previewLayout.current.width || 0, previewLayout.current.height || 0);
                if (nativeSample) { const adj = normalizeBrightnessICtCp({ r: nativeSample.r, g: nativeSample.g, b: nativeSample.b }); const match = await findClosestColorAsync([adj.r, adj.g, adj.b], 3).catch(() => null); if (match) { const mapped = detectedFromMatch(match); if (mapped) { selectedSample = mapped; setDetected(mapped); setFrozenSnapshot(mapped); } } }
              } catch (_e) {
                try { const RNFS = require('react-native-fs'); const base64 = await RNFS.readFile(uri.replace('file://',''), 'base64'); const sample = _decodeAt(base64, relX, relY, previewLayout.current.width || 0, previewLayout.current.height || 0); if (sample) { const adj = normalizeBrightnessICtCp(sample); const match = await findClosestColorAsync([adj.r, adj.g, adj.b], 3).catch(() => null); if (match) { const mapped = detectedFromMatch(match); if (mapped) { selectedSample = mapped; setDetected(mapped); setFrozenSnapshot(mapped); } } } } catch (_e2) {}
              }
            } catch (_e) {}
          }
          if (!selectedSample) {
            try {
              const res:any = await captureAndSampleAt(relX, relY);
              if (res) {
                selectedSample = res;
                setDetected(res);
                setFrozenSnapshot(res);
              } else {
                const fallbackDetected = datasetFallbackDetected();
                setDetected(fallbackDetected);
                setFrozenSnapshot(fallbackDetected);
                selectedSample = fallbackDetected;
              }
            } catch (_err) {
              const fallbackDetected = datasetFallbackDetected();
              setDetected(fallbackDetected);
              setFrozenSnapshot(fallbackDetected);
              selectedSample = fallbackDetected;
            }
          }
        }
        if (selectedSample) try { setCrosshairPos({ x: relX, y: relY }); } catch (_e) {}
        if (voiceEnabled && voiceMode !== 'disable' && selectedSample) {
          try { const textToSpeak = voiceMode === 'real' ? selectedSample.realName : selectedSample.family; try { freezeSpeakTimersRef.current.forEach((tid) => { try { clearTimeout(tid as any); } catch (_e) {} }); } catch (_e) {}; freezeSpeakTimersRef.current = []; try { stopTts(); } catch (_e) {}; const ok = safeSpeak(textToSpeak); lastSpokenRef.current = Date.now(); } catch (err) {}
        }
      } catch (_err) {
        try { const sampled = getFallbackColor(); setDetected(sampled); setFrozenSnapshot(sampled); if (voiceEnabled && voiceMode !== 'disable') try { safeSpeak(voiceMode === 'real' ? sampled.realName : sampled.family); } catch (_e) {} } catch (_e) {}
      }
    } catch (err) {}
  };

  const handleTapAt = async (relX: number, relY: number) => {
    try {
      let selectedSample: any = null;
      try {
        if (selectedImageUri && imageScaledSize && previewLayout.current) {
          let panX = 0, panY = 0; try { panX = (pan.x as any).__getValue ? (pan.x as any).__getValue() : 0; } catch (_e) { panX = 0; } try { panY = (pan.y as any).__getValue ? (pan.y as any).__getValue() : 0; } catch (_e) { panY = 0; }
          const pw = previewLayout.current.width || 0; const ph = previewLayout.current.height || 0;
          const imageLeft = Math.round((pw - imageScaledSize.w) / 2) + panX; const imageTop = Math.round((ph - imageScaledSize.h) / 2) + panY;
          if (relX < imageLeft || relY < imageTop || relX > imageLeft + imageScaledSize.w || relY > imageTop + imageScaledSize.h) return;
          try { setCrosshairPos({ x: relX, y: relY }); } catch (_e) {}
        } else { try { setCrosshairPos({ x: relX, y: relY }); } catch (_e) {} }
      } catch (_e) { try { setCrosshairPos({ x: relX, y: relY }); } catch (_e2) {} }
      const trySampleUploadedImage = async () => { try { if (selectedImageUri) { const res = await sampleUploadedImageAt(relX, relY); if (res) return res; } } catch (_e) {} return null; };
      try {
        const uploadedRes = await trySampleUploadedImage();
        if (uploadedRes && (uploadedRes as any).offImage) return;
        if (uploadedRes) { selectedSample = uploadedRes; setDetected(selectedSample); setFrozenSnapshot(selectedSample); }
        else {
          if (frozenImageUriRef.current) {
            try {
              const uri = frozenImageUriRef.current;
              try {
                const { decodeScaledRegion } = require('../../services/ImageDecoder');
                const nativeSample = await decodeScaledRegion(uri, relX, relY, previewLayout.current.width || 0, previewLayout.current.height || 0);
                if (nativeSample) { const match = await findClosestColorAsync([nativeSample.r, nativeSample.g, nativeSample.b], 3).catch(() => null); if (match) { const mapped = detectedFromMatch(match); if (mapped) { selectedSample = mapped; setDetected(mapped); setFrozenSnapshot(mapped); } } }
              } catch (_e) {
                try { const RNFS = require('react-native-fs'); const base64 = await RNFS.readFile(uri.replace('file://',''), 'base64'); const sample = _decodeAt(base64, relX, relY, previewLayout.current.width || 0, previewLayout.current.height || 0); if (sample) { const match = await findClosestColorAsync([sample.r, sample.g, sample.b], 3).catch(() => null); if (match) { const mapped = detectedFromMatch(match); if (mapped) { selectedSample = mapped; setDetected(mapped); setFrozenSnapshot(mapped); } } } } catch (_e2) {}
              }
            } catch (_e) {}
          }
          if (!selectedSample) {
            try {
              const res:any = await captureAndSampleAt(relX, relY);
              if (res) {
                selectedSample = res;
                setDetected(res);
                setFrozenSnapshot(res);
              } else {
                const fallbackDetected = datasetFallbackDetected();
                setDetected(fallbackDetected);
                setFrozenSnapshot(fallbackDetected);
                selectedSample = fallbackDetected;
              }
            } catch (_err) {
              const fallbackDetected = datasetFallbackDetected();
              setDetected(fallbackDetected);
              setFrozenSnapshot(fallbackDetected);
              selectedSample = fallbackDetected;
            }
          }
        }
        if (selectedSample) try { setCrosshairPos({ x: relX, y: relY }); } catch (_e) {}
        if (voiceEnabled && voiceMode !== 'disable' && selectedSample) {
          try { const textToSpeak = voiceMode === 'real' ? selectedSample.realName : selectedSample.family; try { freezeSpeakTimersRef.current.forEach((tid) => { try { clearTimeout(tid as any); } catch (_e) {} }); } catch (_e) {}; freezeSpeakTimersRef.current = []; try { stopTts(); } catch (_e) {}; const ok = safeSpeak(textToSpeak); lastSpokenRef.current = Date.now(); } catch (err) {}
        }
      } catch (_err) {
        try { const sampled = getFallbackColor(); setDetected(sampled); setFrozenSnapshot(sampled); if (voiceEnabled && voiceMode !== 'disable') try { safeSpeak(voiceMode === 'real' ? sampled.realName : sampled.family); } catch (_e) {} } catch (_e) {}
      }
    } catch (err) {}
  };


  const forceExitApp = () => {
    try {
      if (RNExitApp && typeof RNExitApp.exitApp === 'function') {
        RNExitApp.exitApp();
        return;
      }
    } catch (_e) {}
    try { BackHandler.exitApp(); } catch (_e2) {}
    setTimeout(() => {
      try { BackHandler.exitApp(); } catch (_e3) {}
    }, 120);
    setTimeout(() => {
      try { BackHandler.exitApp(); } catch (_e4) {}
    }, 300);
  };

  const showPermissionReminderAlert = () => {
    exitAppPendingRef.current = true;
    Alert.alert(
      'Camera Permission Required',
      'ColorLens needs camera permission to enable live color detection.',
      [
        {
          text: 'OK',
          onPress: () => { forceExitApp(); },
        },
      ],
      { cancelable: false },
    );
  };

  const showPermissionBlockedAlert = () => {
    Alert.alert(
      'Camera Permission Disabled',
      'Camera access has been disabled for ColorLens. Please enable it from system settings and try again.',
      [
        { text: 'OK', style: 'default' },
      ],
      { cancelable: false },
    );
  };

  const requestCameraPermission = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          setCameraPermission('authorized');
          return;
        }
        if (granted === PermissionsAndroid.RESULTS.DENIED) {
          setCameraPermission('denied');
          showPermissionReminderAlert();
          return;
        }
        if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          setCameraPermission('blocked');
          showPermissionBlockedAlert();
          return;
        }
        setCameraPermission('denied');
        return;
      }
      if (!VisionCamera) return;
      const handleVisionResult = (res: any) => {
        if (res === 'authorized' || res === 'granted') { setCameraPermission('authorized'); return true; }
        if (res === 'denied') { setCameraPermission('denied'); showPermissionReminderAlert(); return true; }
        if (res === 'blocked' || res === 'restricted') { setCameraPermission('blocked'); showPermissionBlockedAlert(); return true; }
        return false;
      };
      if (VisionCamera.requestCameraPermission) {
        const res = await VisionCamera.requestCameraPermission();
        if (handleVisionResult(res)) return;
        setCameraPermission(res ?? 'denied');
        return;
      }
      if (VisionCamera.Camera && VisionCamera.Camera.requestCameraPermission) {
        const res = await VisionCamera.Camera.requestCameraPermission();
        if (handleVisionResult(res)) return;
        setCameraPermission(res ?? 'denied');
        return;
      }
      if (VisionCamera.requestPermissions) {
        const res = await VisionCamera.requestPermissions();
        const cam = res?.camera ?? 'denied';
        if (handleVisionResult(cam)) return;
        setCameraPermission(cam);
        return;
      }
    } catch (err) {}
  };

  const pickImage = async () => {
    try {
      try { suppressSpeechRef.current = true; } catch (_e) {}
      let ImagePicker: any = null;
      try { ImagePicker = require('react-native-image-picker'); } catch (err) { ImagePicker = null; }
      if (!ImagePicker) return;

      ImagePicker.launchImageLibrary({ mediaType: 'photo' }, async (response: any) => {
        try {
          if (!response) return;
          if (response.didCancel) return;
          const uri = (response.assets && response.assets[0] && response.assets[0].uri) || response.uri || null;
          if (!uri) return;
          try { Image.getSize(uri, (w, h) => { setImageNaturalSize({ w, h }); }, (_err) => {}); } catch (_err) {}
          setSelectedImageUri(uri);
          try { setFreeze(true); freezeRef.current = true; } catch (_e) {}
          frozenImageUriRef.current = null;

          const doProcessing = async () => {
            let selectedSample: any = null;
            try {
              try { await ensurePreviewMeasured(); } catch (_e) {}
              const centerX = (previewLayout.current.width || 0) / 2;
              const centerY = (previewLayout.current.height || 0) / 2;
              let res: any = null;
              try { res = await sampleUploadedImageAt(centerX, centerY); } catch (_e) { res = null; }
              if (res && !(res as any).offImage) {
                selectedSample = res;
                setDetected(res);
                setFrozenSnapshot(res);
                setFreeze(true);
              } else {
                if (uri && (uri as string).startsWith('file://')) {
                  try {
                    const RNFS = require('react-native-fs');
                    const base64 = await RNFS.readFile((uri as string).replace('file://',''), 'base64');
                    if (base64) {
                      const centerSample = _decodeCenter(base64);
                      if (centerSample) {
                        const adj = normalizeBrightnessICtCp(centerSample);
                        const match = await findClosestColorAsync([adj.r, adj.g, adj.b], 3).catch(() => null);
                        if (match) {
                          const mapped = detectedFromMatch(match);
                          if (mapped) {
                            selectedSample = mapped;
                            setDetected(mapped);
                            setFrozenSnapshot(mapped);
                            setFreeze(true);
                          }
                        }
                      }
                    }
                  } catch (_e) {}
                }

                if (!selectedSample) {
                  setDetected(null);
                  setFrozenSnapshot(null);
                  selectedSample = null;
                }
              }
            } catch (err) {
              setDetected(null);
              setFrozenSnapshot(null);
              selectedSample = null;
            }

            if (voiceEnabled && voiceMode !== 'disable' && selectedSample) {
              try { const textToSpeak = voiceMode === 'real' ? selectedSample.realName : selectedSample.family; safeSpeak(textToSpeak); } catch (err) {}
            }
          };
          try {
            await processWithIndicator(setProcessing, doProcessing);
          } catch (_e) {
            await doProcessing();
          }
        } catch (innerErr) {
        }
        try { setTimeout(() => { try { suppressSpeechRef.current = false; } catch (_e) {} }, 300); } catch (_e) {}
      });
    } catch (err) {
    }
  };
  useEffect(() => { panResponder.current = PanResponder.create({ onStartShouldSetPanResponder: () => adjusting, onMoveShouldSetPanResponder: () => adjusting, onPanResponderGrant: () => { try { pan.setOffset({ x: (pan.x as any).__getValue ? (pan.x as any).__getValue() : 0, y: (pan.y as any).__getValue ? (pan.y as any).__getValue() : 0 }); } catch (_e) {} pan.setValue({ x: 0, y: 0 }); }, onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }), onPanResponderRelease: () => { pan.flattenOffset(); clampPanToBounds(); }, onPanResponderTerminate: () => { pan.flattenOffset(); clampPanToBounds(); } }); }, [adjusting, imageScaledSize, previewSize]);
  useEffect(() => { if (!previewSize || !imageNaturalSize) return; const pw = previewSize.width; const ph = previewSize.height; const iw = imageNaturalSize.w; const ih = imageNaturalSize.h; const scale = Math.max(pw / iw, ph / ih); setImageScaledSize({ w: Math.round(iw * scale), h: Math.round(ih * scale) }); pan.setValue({ x: 0, y: 0 }); }, [previewSize, imageNaturalSize]);

  const clampPanToBounds = () => { if (!previewSize || !imageScaledSize) return; const maxOffsetX = Math.max(0, (imageScaledSize.w - previewSize.width) / 2); const maxOffsetY = Math.max(0, (imageScaledSize.h - previewSize.height) / 2); const curX = (pan.x as any).__getValue ? (pan.x as any).__getValue() : 0; const curY = (pan.y as any).__getValue ? (pan.y as any).__getValue() : 0; let clampedX = curX; let clampedY = curY; if (curX > maxOffsetX) clampedX = maxOffsetX; if (curX < -maxOffsetX) clampedX = -maxOffsetX; if (curY > maxOffsetY) clampedY = maxOffsetY; if (curY < -maxOffsetY) clampedY = -maxOffsetY; if (clampedX !== curX || clampedY !== curY) { Animated.spring(pan, { toValue: { x: clampedX, y: clampedY }, useNativeDriver: false }).start(); } };
  const onAdjustToggle = () => { setAdjusting((v) => { const next = !v; if (!next) setTimeout(() => clampPanToBounds(), 10); return next; }); };
  const captureAndSampleCenter = async (): Promise<any> => {
    const ready = await waitForCameraReady();
    if (!ready) {
      return null;
    }
    try {
      await ensurePreviewMeasured();
      const ref: any = cameraRef.current;
      if (ref && (ref.takeSnapshot || ref.takePhoto || ref.takePicture)) {
  const takeMethodName = ref.takeSnapshot ? 'takeSnapshot' : ref.takePhoto ? 'takePhoto' : 'takePicture';
        try {
          const photo = await ref[takeMethodName]({ qualityPrioritization: 'speed', skipMetadata: true, width: 640 });
          const uri = photo?.path || photo?.uri || photo?.localUri;
          const normalizedUri = (typeof uri === 'string' && uri.startsWith('/')) ? ('file://' + uri) : uri;
          if (normalizedUri && typeof normalizedUri === 'string' && normalizedUri.startsWith('file://')) {
            try {
              const { decodeScaledRegion } = require('../../services/ImageDecoder');
              const nativeSample = await decodeScaledRegion(normalizedUri, (previewLayout.current.width || 0) / 2, (previewLayout.current.height || 0) / 2, previewLayout.current.width || 0, previewLayout.current.height || 0);
                if (nativeSample) {
                const match = await findClosestColorAsync([nativeSample.r, nativeSample.g, nativeSample.b], 3).catch(() => null);
                if (match) { const mapped = detectedFromMatch(match); if (mapped) return mapped; }
              }
            } catch (_e) {
              try {
                const RNFS = require('react-native-fs');
                    const base64 = await RNFS.readFile(normalizedUri.replace('file://',''), 'base64');
                    const sample = _decodeCenter(base64);
                if (sample) {
                  const match = await findClosestColorAsync([sample.r, sample.g, sample.b], 3).catch(() => null);
                  if (match) { const mapped = detectedFromMatch(match); if (mapped) return mapped; }
                }
              } catch (_e2) {
              }
            }
          }
          if ((photo as any)?.base64) {
            const sample = _decodeCenter((photo as any).base64);
            if (sample) {
              const inferred = await inferColorFromRGB({ r: sample.r, g: sample.g, b: sample.b }).catch(() => null);
              if (inferred) return { family: inferred.family, hex: inferred.hex, realName: inferred.realName, confidence: clampConfidence(inferred.confidence) };
            }
          }
        } catch (err) {
        }
      }

      if (ref && (ref.takePictureAsync || ref.capture)) {
  const takePicMethod = ref.takePictureAsync ? 'takePictureAsync' : 'capture';
        try {
          const pic = await ref[takePicMethod]({ quality: 0.5, base64: true, width: 640, doNotSave: true });
          if (pic && pic.base64) {
            const sample = _decodeCenter(pic.base64);
            if (sample) {
              const match = await findClosestColorAsync([sample.r, sample.g, sample.b], 3).catch(() => null);
              if (match) { const mapped = detectedFromMatch(match); if (mapped) return mapped; }
            }
          }
        } catch (err) {
        }
      }

      return null;
    } catch (e) {
      return null;
    }
  };

  const ensurePreviewMeasured = async (): Promise<void> => {
    try {
      const pw = previewLayout.current.width || 0;
      const ph = previewLayout.current.height || 0;
      if (pw > 0 && ph > 0) return;
      if (previewRef.current && previewRef.current.measureInWindow) {
        await new Promise<void>((resolve) => {
          try {
              previewRef.current.measureInWindow((px: number, py: number, pw2: number, ph2: number) => {
              previewLayout.current = { x: px, y: py, width: pw2, height: ph2 };
              resolve();
            });
          } catch (_e) { resolve(); }
        });
      }
    } catch (_e) {  }
  };

  const waitForCameraReady = async (timeoutMs = 3000, intervalMs = 120) => {
    const start = Date.now();
    try {
      if (!VisionCamera && !RNCamera) return false;
      while (Date.now() - start < timeoutMs) {
        try {
          const ref = cameraRef.current;
          const hasMethod = !!ref && (
            !!ref.takePhoto || !!ref.takeSnapshot || !!ref.takePicture || !!ref.takePictureAsync || !!ref.capture
          );
          const deviceAvailable = !!availableDevice || (!!availableDevices && availableDevices.length > 0) || !VisionCamera;
          if (hasMethod && deviceAvailable) {
            return true;
          }
        } catch (err) {
        }
        await new Promise((res) => setTimeout(() => res(undefined), intervalMs));
      }
    } catch (_err) {
    }
    return false;
  };

  

  const captureAndSampleAt = async (relX: number, relY: number): Promise<any> => {
    setCapturing(true);
    try {
      const ready = await waitForCameraReady();
      if (!ready) {
        setCapturing(false);
        return null;
      }
    } catch (_err) {
      setCapturing(false);
      return null;
    }

    try {
      await ensurePreviewMeasured();

      if (VisionCamera && cameraRef.current && (cameraRef.current.takePhoto || cameraRef.current.takeSnapshot || cameraRef.current.takePicture)) {
        const takeMethodName = cameraRef.current.takePhoto ? 'takePhoto' : cameraRef.current.takeSnapshot ? 'takeSnapshot' : 'takePicture';
        try {
          const photo = await (cameraRef.current as any)[takeMethodName]({ qualityPrioritization: 'speed', skipMetadata: true });
          const uri = photo?.path || photo?.uri || photo?.localUri;
          const normalizedUri = (typeof uri === 'string' && uri.startsWith('/')) ? ('file://' + uri) : uri;

          if (normalizedUri && typeof normalizedUri === 'string' && normalizedUri.startsWith('file://')) {
            try {
              const { decodeScaledRegion } = require('../../services/ImageDecoder');
              const nativeSample = await decodeScaledRegion(normalizedUri, relX, relY, previewLayout.current.width || 0, previewLayout.current.height || 0);
              if (nativeSample) {
                const match = await findClosestColorAsync([nativeSample.r, nativeSample.g, nativeSample.b], 3).catch(() => null);
                if (match) { const mapped = detectedFromMatch(match); if (mapped) return mapped; }
              }
            } catch (_e) {
              try {
                const RNFS = require('react-native-fs');
                const base64 = await RNFS.readFile(normalizedUri.replace('file://',''), 'base64');
                const sample = _decodeAt(base64, relX, relY, previewLayout.current.width || 0, previewLayout.current.height || 0);
                if (sample) {
                  const inferred = await inferColorFromRGB({ r: sample.r, g: sample.g, b: sample.b }).catch(() => null);
                  if (inferred) return { family: inferred.family, hex: inferred.hex, realName: inferred.realName, confidence: clampConfidence(inferred.confidence) };
                }
              } catch (_e2) {
              }
            }
          }

          if ((photo as any)?.base64) {
            const sample = _decodeAt((photo as any).base64, relX, relY, previewLayout.current.width || 0, previewLayout.current.height || 0);
            if (sample) {
              const match = await findClosestColorAsync([sample.r, sample.g, sample.b], 3).catch(() => null);
              if (match) { const mapped = detectedFromMatch(match); if (mapped) return mapped; }
            }
          }
        } catch (_err) {
        }
      }

      if (RNCamera && cameraRef.current && (cameraRef.current.takePictureAsync || cameraRef.current.capture)) {
        const takePicMethod = cameraRef.current.takePictureAsync ? 'takePictureAsync' : 'capture';
        try {
          const pic = await (cameraRef.current as any)[takePicMethod]({ quality: 0.5, base64: true, width: 640, doNotSave: true });
          if (pic && pic.base64) {
            const sample = _decodeAt(pic.base64, relX, relY, previewLayout.current.width || 0, previewLayout.current.height || 0);
            if (sample) {
              const match = await findClosestColorAsync([sample.r, sample.g, sample.b], 3).catch(() => null);
              if (match) { const mapped = detectedFromMatch(match); if (mapped) return mapped; }
            }
          }
        } catch (_err) {
        }
      }
      try {
        const centerSample = await captureAndSampleCenter();
  if (centerSample) return centerSample;
      } catch (_e) {
      }
      return null;
    } catch (e) {
      try {
        const centerSample = await captureAndSampleCenter();
        if (centerSample) return centerSample;
      } catch (_e) {
      }
      return null;
    } finally {
      try { setCapturing(false); } catch (_e) {}
    }
  };
  const sampleUploadedImageAt = async (relX: number, relY: number): Promise<any> => {
    if (!selectedImageUri) return null;
    try {
      try {
      if (captureRef && previewRef.current) {
        const snapSample = await sampleFromPreviewSnapshot(relX, relY);
          if (snapSample) {
            const match = await findClosestColorAsync([snapSample.r, snapSample.g, snapSample.b], 3).catch(() => null);
            if (match) {
              const mapped = detectedFromMatch(match);
              if (mapped) return mapped;
            }
          }
        }
      } catch (e) {
      }
      let base64: string | null = null;
      const uri = selectedImageUri as string;

      if (uri.startsWith('data:') && uri.indexOf('base64,') !== -1) {
        base64 = uri.split('base64,')[1];
      }
      try {
        const { decodeScaledRegion } = require('../../services/ImageDecoder');
        if (uri.startsWith('file://') || uri.startsWith('content://')) {
          const nativeSample = await decodeScaledRegion(uri, relX, relY, previewLayout.current.width || 0, previewLayout.current.height || 0);
          if (nativeSample) {
            const match = await findClosestColorAsync([nativeSample.r, nativeSample.g, nativeSample.b], 3).catch(() => null);
            if (!match) return null;
            try {
              const pw = previewLayout.current.width || 0;
              const ph = previewLayout.current.height || 0;
              const scaled = imageScaledSize || { w: pw, h: ph };
              let panX = 0, panY = 0;
              try { panX = (pan.x as any).__getValue ? (pan.x as any).__getValue() : 0; } catch (_e) { panX = 0; }
              try { panY = (pan.y as any).__getValue ? (pan.y as any).__getValue() : 0; } catch (_e) { panY = 0; }
              const imageLeft = Math.round((pw - scaled.w) / 2) + panX;
              const imageTop = Math.round((ph - scaled.h) / 2) + panY;
              const mappedPreviewX = relX;
              const mappedPreviewY = relY;
            
            } catch (_e) { }
            const mapped = detectedFromMatch(match);
            if (mapped) return mapped;
            return null;
          }
        }
      } catch (_e) {
      }
      if (!base64 && (uri.startsWith('content://') || uri.startsWith('http://') || uri.startsWith('https://'))) {
        try {
          const resp = await fetch(uri);
          const ab = await (resp as any).arrayBuffer();
          if (ab) {
            const { BufferShim: _BufferShim } = getJpegUtils();
            if (typeof _BufferShim !== 'undefined' && _BufferShim && (_BufferShim as any).from) {
              base64 = (_BufferShim as any).from(new Uint8Array(ab)).toString('base64');
            }
          }
        } catch (_e) {
        }
      }
      if (!base64) return null;

      let decoded: any = null;
      const { jpegjs: _jpegjs, BufferShim: _BufferShim } = getJpegUtils();
      if (!_jpegjs || !_BufferShim) return null;
  const buffer = _BufferShim.from(base64, 'base64');
  let exifOrient = 1;
  try { exifOrient = getJpegOrientation(buffer); } catch (_e) { exifOrient = 1; }
  const dec = _jpegjs.decode(buffer, { useTArray: true });
      if (!dec || !dec.width || !dec.data) return null;
      decoded = dec;
      const w = decoded.width; const h = decoded.height; const data = decoded.data;

      const pw = previewLayout.current.width || 0;
      const ph = previewLayout.current.height || 0;
      if (!pw || !ph) {
  const centerSample = _decodeCenter(base64);
        if (!centerSample) return null;
        const match = await findClosestColorAsync([centerSample.r, centerSample.g, centerSample.b], 3).catch(() => null);
        if (!match) return null;
        {
        const mapped = detectedFromMatch(match);
        if (mapped) return mapped;
      }
      }
      const scaled = imageScaledSize;
  if (!scaled) {
        const ix = Math.max(0, Math.min(w - 1, Math.round((relX / pw) * w)));
        const iy = Math.max(0, Math.min(h - 1, Math.round((relY / ph) * h)));
        const half = computeSampleHalf(w, h);
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let yy = Math.max(0, iy - half); yy <= Math.min(h - 1, iy + half); yy++) {
          for (let xx = Math.max(0, ix - half); xx <= Math.min(w - 1, ix + half); xx++) {
            const idx = (yy * w + xx) * 4;
            rSum += data[idx]; gSum += data[idx+1]; bSum += data[idx+2]; count++;
          }
        }
        if (count === 0) return null;
        const sampled = { r: Math.round(rSum/count), g: Math.round(gSum/count), b: Math.round(bSum/count) };
        const match = await findClosestColorAsync([sampled.r, sampled.g, sampled.b], 3).catch(() => null);
        if (!match) return null;
        {
        const mapped = detectedFromMatch(match);
        if (mapped) return mapped;
      }
      }
      let panX = 0, panY = 0;
      try { panX = (pan.x as any).__getValue ? (pan.x as any).__getValue() : 0; } catch (_e) { panX = 0; }
      try { panY = (pan.y as any).__getValue ? (pan.y as any).__getValue() : 0; } catch (_e) { panY = 0; }

      const imageLeft = Math.round((pw - scaled.w) / 2) + panX;
      const imageTop = Math.round((ph - scaled.h) / 2) + panY;

      const localX = relX - imageLeft;
      const localY = relY - imageTop;

      if (localX < 0 || localY < 0 || localX > scaled.w || localY > scaled.h) {
        return { offImage: true } as any;
      }
      let ix = Math.max(0, Math.min(w - 1, Math.round((localX / scaled.w) * w)));
      let iy = Math.max(0, Math.min(h - 1, Math.round((localY / scaled.h) * h)));
      try {
        switch (exifOrient) {
          case 2:
            ix = w - 1 - ix; break;
          case 3:
            ix = w - 1 - ix; iy = h - 1 - iy; break;
          case 4:
            iy = h - 1 - iy; break;
          case 5: {
            const ox = ix; ix = iy; iy = ox; break;
          }
          case 6: {
            const ox = ix; ix = h - 1 - iy; iy = ox; break;
          }
          case 7: {
            const ox = ix; ix = h - 1 - iy; iy = w - 1 - ox; break;
          }
          case 8: {
            const ox = ix; ix = iy; iy = w - 1 - ox; break;
          }
          default: break;
        }
      } catch (_e) { }

      const half = computeSampleHalf(w, h);
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let yy = Math.max(0, iy - half); yy <= Math.min(h - 1, iy + half); yy++) {
        for (let xx = Math.max(0, ix - half); xx <= Math.min(w - 1, ix + half); xx++) {
          const idx = (yy * w + xx) * 4;
          rSum += data[idx]; gSum += data[idx+1]; bSum += data[idx+2]; count++;
        }
      }
      if (count === 0) return null;
  const sampled = { r: Math.round(rSum/count), g: Math.round(gSum/count), b: Math.round(bSum/count) };
  try {
    const mappedPreviewX = imageLeft + (ix / w) * scaled.w;
    const mappedPreviewY = imageTop + (iy / h) * scaled.h;
  
  } catch (_e) { }
  const match = await findClosestColorAsync([sampled.r, sampled.g, sampled.b], 3).catch(() => null);
  if (!match) return null;
  const mapped = detectedFromMatch(match);
  return mapped;
    } catch (err) {
      return null;
    }
  };
  const onPreviewTap = (evt: any) => {
    if (selectedImageUri && !adjusting) {
      onScreenPress(evt);
      return;
    }
    onScreenPress(evt);
  };

    const centerX = previewSize ? (freeze && crosshairPos ? crosshairPos.x : previewSize.width / 2) : 0;
    const centerY = previewSize ? (freeze && crosshairPos ? crosshairPos.y : previewSize.height / 2) : 0;
    const lengthFactor = freeze ? CROSSHAIR_LENGTH_FACTOR_FROZEN : CROSSHAIR_LENGTH_FACTOR;
    const displayDetected = freeze ? (frozenSnapshot ?? detected) : liveDetected ?? detected;

  return (
    <View style={[styles.container, { paddingTop: insets.top || 0, paddingBottom: insets.bottom || 0 }]}> 
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}>
          <Image source={ICONS.ARROWicon} style={styles.backIconImage} />
        </TouchableOpacity>
  <TouchableOpacity onPress={() => { openSettings(); }} style={styles.settingsButton}><Text style={styles.settingsText}>⚙️</Text></TouchableOpacity>
        
      </View>
      <TouchableWithoutFeedback onPress={onPreviewTap}>
        <View style={styles.cameraArea}>
          <View style={styles.previewWrapper} onStartShouldSetResponder={() => true} onResponderRelease={(e) => {
            try { if (!freeze) return; const mapped = mapLocalPressToPreviewCoords(e, previewLayout); handleTapAt(mapped.relX, mapped.relY); } catch (_e) {}
          }}>
           {selectedImageUri ? (
            <View ref={(el)=>{ previewRef.current = el; }} style={styles.cameraPreviewContainer} onLayout={async (e)=>{
                      try {
                        if (previewRef.current && previewRef.current.measureInWindow) {
                          try {
                            previewRef.current.measureInWindow((px:number, py:number, pw:number, ph:number) => {
                              previewLayout.current = { x: px, y: py, width: pw, height: ph };
                              setPreviewSize({ width: pw, height: ph });
                            });
                          } catch (_e) {
                            const { width: pw, height: ph } = e.nativeEvent.layout;
                            previewLayout.current.width = pw; previewLayout.current.height = ph; setPreviewSize({ width: pw, height: ph });
                          }
                        } else {
                          const { width: pw, height: ph } = e.nativeEvent.layout;
                          previewLayout.current.width = pw; previewLayout.current.height = ph; setPreviewSize({ width: pw, height: ph });
                        }
                      } catch (innerErr) {  }
            }}>
              
              
               {imageScaledSize && previewSize ? (
                 <Animated.View
                   {...(adjusting && panResponder.current ? panResponder.current.panHandlers : {})}
                   pointerEvents={adjusting ? 'auto' : 'none'}
                   style={[styles.animatedImageAbsolute, { left: Math.round((previewSize.width - imageScaledSize.w) / 2), top: Math.round((previewSize.height - imageScaledSize.h) / 2), width: Math.round(imageScaledSize.w), height: Math.round(imageScaledSize.h), transform: [{ translateX: pan.x }, { translateY: pan.y }] }]}
                   >
                   <Image source={{ uri: selectedImageUri }} style={[{ width: Math.round(imageScaledSize.w), height: Math.round(imageScaledSize.h) }, styles.selectedImage, { resizeMode: 'cover' }]} />
                 </Animated.View>
               ) : (
                 <Animated.View
                   {...(adjusting && panResponder.current ? panResponder.current.panHandlers : {})}
                   pointerEvents={adjusting ? 'auto' : 'none'}
                   style={[styles.animatedFull, { transform: [{ translateX: pan.x }, { translateY: pan.y }] }]}
                   >
                   <Image source={{ uri: selectedImageUri }} style={[styles.cameraInner, styles.selectedImage, { resizeMode: 'cover' }]} />
                 </Animated.View>
               )}

            </View>
           ) : RNCamera ? (
             <View ref={(el)=>{ previewRef.current = el; }} style={styles.cameraPreviewContainer} onLayout={async (e)=>{
                       try {
                         if (previewRef.current && previewRef.current.measureInWindow) {
                           try {
                             previewRef.current.measureInWindow((px:number, py:number, pw:number, ph:number) => {
                               previewLayout.current = { x: px, y: py, width: pw, height: ph };
                               setPreviewSize({ width: pw, height: ph });
                             });
                           } catch (_e) {
                             const { width: pw, height: ph } = e.nativeEvent.layout;
                             previewLayout.current.width = pw; previewLayout.current.height = ph; setPreviewSize({ width: pw, height: ph });
                           }
                         } else {
                           const { width: pw, height: ph } = e.nativeEvent.layout;
                           previewLayout.current.width = pw; previewLayout.current.height = ph; setPreviewSize({ width: pw, height: ph });
                         }
                       } catch (innerErr) {  }
             }}>
               <RNCamera
                 ref={cameraRef}
                 style={styles.cameraInner}
                 type={RNCamera.Constants.Type.back}
                 captureAudio={false}
                 ratio={'4:3'}
                 captureTarget={RNCamera.constants?.CaptureTarget?.disk || undefined}
               />
             </View>
           ) : VisionCamera ? (
             (() => {
               if (cameraPermission !== 'authorized') {
                 return (
                   <View style={[styles.cameraPreview, styles.cameraFallback]}>
                     <Text style={styles.cameraFallbackText}>Camera permission not granted</Text>
                     <TouchableOpacity style={styles.permissionButton} onPress={requestCameraPermission}>
                       <Text style={styles.permissionButtonText}>Grant Camera Permission</Text>
                     </TouchableOpacity>
                   </View>
                 );
               }

               const finalDevice = availableDevice;
                 if (finalDevice) {
                  try {
                    const CameraComp = VisionCamera.Camera;
                    
                    // Handle camera errors gracefully
                    const handleCameraError = (error: any) => {
                      try {
                        const errorMessage = error?.message || error?.toString() || 'Unknown camera error';
                        console.warn('Camera error:', errorMessage);
                        setCameraError(errorMessage);
                        
                        // If camera is already in use, try to recover after a delay
                        if (errorMessage.includes('already in use') || errorMessage.includes('camera-already-in-use')) {
                          setTimeout(() => {
                            try {
                              const ref = cameraRef.current;
                              if (ref && typeof ref.destroy === 'function') {
                                ref.destroy();
                              }
                              cameraRef.current = null;
                              setCameraError(null);
                              // Re-discover devices after cleanup
                              setTimeout(() => {
                                if (VisionCamera && VisionCamera.getAvailableCameraDevices) {
                                  VisionCamera.getAvailableCameraDevices().then((devices: any[]) => {
                                    setAvailableDevices(devices ?? null);
                                  }).catch(() => {});
                                }
                              }, 500);
                            } catch (_e) {}
                          }, 1000);
                        }
                      } catch (_e) {
                        console.warn('Error handling camera error:', _e);
                      }
                    };
                    
                    return (
                      <View ref={(el)=>{ previewRef.current = el; }} style={styles.cameraPreviewContainer} onLayout={async (e)=>{
                         try {
                           if (previewRef.current && previewRef.current.measureInWindow) {
                             try {
                               previewRef.current.measureInWindow((px:number, py:number, pw:number, ph:number) => {
                                 previewLayout.current = { x: px, y: py, width: pw, height: ph };
                                 setPreviewSize({ width: pw, height: ph });
                               });
                             } catch (_e) {
                               const { width: pw, height: ph } = e.nativeEvent.layout;
                               previewLayout.current.width = pw; previewLayout.current.height = ph; setPreviewSize({ width: pw, height: ph });
                             }
                           } else {
                             const { width: pw, height: ph } = e.nativeEvent.layout;
                             previewLayout.current.width = pw; previewLayout.current.height = ph; setPreviewSize({ width: pw, height: ph });
                           }
                         } catch (innerErr) {  }
                       }}>
                          {cameraError ? (
                            <View style={[styles.cameraPreview, styles.cameraFallback]}>
                              <Text style={styles.cameraFallbackText}>Camera Error: {cameraError.includes('already in use') ? 'Camera is busy. Please wait...' : cameraError}</Text>
                              <TouchableOpacity 
                                style={styles.permissionButton} 
                                onPress={() => {
                                  setCameraError(null);
                                  if (VisionCamera && VisionCamera.getAvailableCameraDevices) {
                                    VisionCamera.getAvailableCameraDevices().then((devices: any[]) => {
                                      setAvailableDevices(devices ?? null);
                                    }).catch(() => {});
                                  }
                                }}
                              >
                                <Text style={styles.permissionButtonText}>Retry</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <CameraComp
                              ref={cameraRef}
                              style={styles.cameraInner}
                              device={finalDevice}
                              isActive={(!freeze || capturing) && !cameraError}
                              photo={true}
                              onError={handleCameraError}
                              {...(frameProcessor ? { frameProcessor, frameProcessorFps: 2 } : {})}
                            />
                          )}
                       </View>
                     );
                   } catch (innerErr) {
                   }
               }

               return (
                 <View style={[styles.cameraPreview, styles.cameraFallback]}>
                   <Text style={styles.cameraFallbackText}>No camera device detected.
                     On an emulator, enable a virtual camera (AVD settings) or run on a physical device.
                   </Text>
                  
                 </View>
               );
             })()
           ) : (
             <View style={[styles.cameraPreview, styles.cameraFallback]}>
               <Text style={styles.cameraFallbackText}>Camera not available</Text>
             </View>
           )}

    
   
  <View pointerEvents="none" style={[styles.absoluteOverlay, { width: previewSize?.width ?? '100%', height: previewSize?.height ?? '100%' }]}> 
               {previewSize && (
                 <>
                   
                   <View
                     style={[
                       styles.crosshairVertical,
                       { left: Math.round(centerX) - Math.round(CROSSHAIR_THICKNESS / 2), height: Math.round(previewSize.height * lengthFactor) + Math.round(CROSSHAIR_CONTAINER_SIZE), top: Math.round(previewSize.height * ((1 - lengthFactor) / 2)) - Math.round(CROSSHAIR_CONTAINER_SIZE / 2), width: CROSSHAIR_THICKNESS },
                     ]}
                   />

                   <View
                     style={[
                       styles.crosshairHorizontal,
                       { top: Math.round(centerY) - Math.round(CROSSHAIR_THICKNESS / 2), width: Math.round(previewSize.width * lengthFactor) + Math.round(CROSSHAIR_CONTAINER_SIZE), left: Math.round(previewSize.width * ((1 - lengthFactor) / 2)) - Math.round(CROSSHAIR_CONTAINER_SIZE / 2), height: CROSSHAIR_THICKNESS },
                     ]}
                   />
                   <View pointerEvents="none" style={[styles.fillerBar, { left: Math.round(centerX) - Math.round((CROSSHAIR_CONTAINER_SIZE * 1.2) / 2), top: Math.round(centerY) - Math.round((CROSSHAIR_THICKNESS + 1) / 2), width: Math.round(CROSSHAIR_CONTAINER_SIZE * 1.2), height: CROSSHAIR_THICKNESS + 1 }]} />
                   <View pointerEvents="none" style={[styles.fillerBar, { left: Math.round(centerX) - Math.round((CROSSHAIR_THICKNESS + 1) / 2), top: Math.round(centerY) - Math.round((CROSSHAIR_CONTAINER_SIZE * 1.2) / 2), width: CROSSHAIR_THICKNESS + 1, height: Math.round(CROSSHAIR_CONTAINER_SIZE * 1.2) }]} />
                 </>
               )}

               {tapMarker && previewSize && (
                 <View style={styles.tapMarkerRoot} pointerEvents="none">
                   <View style={[styles.tapMarkerDot, { left: Math.round(tapMarker.x - (18/2)), top: Math.round(tapMarker.y - (18/2)) }]} />
                 </View>
               )}

               {freeze && crosshairPos ? (
                 <View
                   pointerEvents="none"
                   style={[
                     styles.crosshairContainer,
                     { width: CROSSHAIR_CONTAINER_SIZE, height: CROSSHAIR_CONTAINER_SIZE, left: crosshairPos.x - Math.round(CROSSHAIR_CONTAINER_SIZE / 2), top: crosshairPos.y - Math.round(CROSSHAIR_CONTAINER_SIZE / 2) },
                   ]}
                 >
                   <View style={[styles.crosshairInner, { width: CROSSHAIR_CONTAINER_SIZE, height: CROSSHAIR_CONTAINER_SIZE }]}>
                     <View style={[{ width: CROSSHAIR_DOT_SIZE, height: CROSSHAIR_DOT_SIZE, borderRadius: Math.round(CROSSHAIR_DOT_SIZE/2) }, styles.crosshairDotBase]} />
                     <View style={[styles.crosshairLineBase, { width: 2, height: CROSSHAIR_CONTAINER_SIZE * 2 }]} />
                     <View style={[styles.crosshairLineBase, { height: 2, width: CROSSHAIR_CONTAINER_SIZE * 2 }]} />
                   </View>
                 </View>
               ) : (
                 previewSize && (
                   <View
                     pointerEvents="none"
                     style={[
                       styles.crosshairContainer,
                       { width: CROSSHAIR_CONTAINER_SIZE, height: CROSSHAIR_CONTAINER_SIZE, left: Math.round(previewSize.width / 2) - Math.round(CROSSHAIR_CONTAINER_SIZE / 2), top: Math.round(previewSize.height / 2) - Math.round(CROSSHAIR_CONTAINER_SIZE / 2) },
                     ]}
                   >
                     <View style={[styles.crosshairInner, { width: CROSSHAIR_CONTAINER_SIZE, height: CROSSHAIR_CONTAINER_SIZE }]}>
                       <View style={[{ width: CROSSHAIR_DOT_SIZE, height: CROSSHAIR_DOT_SIZE, borderRadius: Math.round(CROSSHAIR_DOT_SIZE/2) }, styles.crosshairDotBase]} />
                       <View style={[styles.crosshairLineBase, { width: 2, height: CROSSHAIR_CONTAINER_SIZE * 2 }]} />
                       <View style={[styles.crosshairLineBase, { height: 2, width: CROSSHAIR_CONTAINER_SIZE * 2 }]} />
                     </View>
                   </View>
                 )
               )}
    </View>
          </View>
          
          {selectedImageUri && (
            <View style={styles.adjustArea} pointerEvents="box-none">
              <TouchableOpacity style={styles.adjustButton} onPress={onAdjustToggle} activeOpacity={0.85}>
                <View style={styles.adjustButtonContent}>
                  <Image source={ICONS.HANDicon} style={styles.adjustIcon} />
                  <Text style={styles.adjustText}>{adjusting ? 'Done' : 'Adjust Image'}</Text>
                </View>
              </TouchableOpacity>
              {adjusting && (
                <View style={styles.adjustHelp}>
                  <Text style={styles.adjustHelpText}>Drag the image to position it so the area you want to sample is visible under the crosshair. Tap done when finished.</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </TouchableWithoutFeedback>

        {processing && (
          <View style={styles.processingOverlay} pointerEvents="box-none">
            <View style={styles.processingBox}>
              <ActivityIndicator size="large" color="#6A0DAF" />
              <Text style={styles.processingText}>Processing image…</Text>
            </View>
          </View>
        )}

        <View style={styles.infoArea}>
          
          <View style={styles.inlineSwatchRow}>
            <View style={[styles.swatchBoxLarge, { backgroundColor: displayDetected?.hex || '#000', opacity: adjusting ? 0 : 1 }]} />
          </View>
          {showFamily && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Family of:</Text>
              <Text style={styles.infoValue}>{displayDetected?.family ?? '—'}</Text>
            </View>
          )}
        {colorCodesVisible && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Hex:</Text>
            <Text style={styles.infoValue}>{displayDetected?.hex ?? '—'}</Text>
          </View>
        )}
        {showRealName && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Real Name:</Text>
            <Text style={styles.infoValue}>{displayDetected?.realName ?? '—'}</Text>
          </View>
        )}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Confidence:</Text>
          <Text style={styles.infoValue}>
            {typeof displayDetected?.confidence === 'number'
              ? `${displayDetected.confidence}% Match`
              : '—'}
          </Text>
        </View>
        <View style={styles.uploadRow}>
          <TouchableOpacity style={styles.uploadButton} onPress={pickImage} activeOpacity={0.8}>
            <View style={styles.uploadButtonContent}>
              <Image source={ICONS.UploadIcon} style={styles.uploadIcon} />
              <Text style={styles.uploadButtonText}>Upload Image</Text>
            </View>
          </TouchableOpacity>
          {selectedImageUri && (
            <Image source={{ uri: selectedImageUri }} style={styles.thumbnail} />
          )}
        </View>
        <TouchableOpacity style={[styles.freezeButton, freeze && styles.unfreezeButton]} onPress={toggleFreeze} activeOpacity={0.8}>
          <Text style={styles.freezeButtonText}>{freeze ? 'Unfreeze' : 'Freeze Frame'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
export default ColorDetector;
