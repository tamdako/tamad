export function getFallbackColor() {
  return { family: 'Unknown', hex: '#000000', realName: 'Unknown' };
}
export const getJpegUtils = () => {
  try {
    const jpegjsLocal = require('jpeg-js');
    const BufferLocal = require('buffer').Buffer;
    return { jpegjs: jpegjsLocal, BufferShim: BufferLocal };
  } catch (_e) {
    return { jpegjs: null, BufferShim: null };
  }
};
export const getJpegOrientation = (buf: any): number => {
  try {
    let arr: Uint8Array;
    if (buf && typeof buf === 'object' && typeof buf.length === 'number' && typeof buf[0] === 'number') {
      arr = buf;
    } else if (buf && typeof (buf as any).toArray === 'function') {
      arr = (buf as any).toArray();
    } else {
      try { arr = new Uint8Array(buf); } catch (_e) { return 1; }
    }
    if (arr.length < 4) return 1;
    if (arr[0] !== 0xFF || arr[1] !== 0xD8) return 1;
    let offset = 2;
    while (offset < arr.length) {
      if (arr[offset] !== 0xFF) break;
      const marker = arr[offset + 1];
      if (marker === 0xE1) {
        const len = (arr[offset + 2] << 8) + arr[offset + 3];
        const exifStart = offset + 4;
        if (exifStart + 6 <= arr.length) {
          if (arr[exifStart] === 0x45 && arr[exifStart + 1] === 0x78 && arr[exifStart + 2] === 0x69 && arr[exifStart + 3] === 0x66 && arr[exifStart + 4] === 0x00 && arr[exifStart + 5] === 0x00) {
            const tiffOffset = exifStart + 6;
            const isLittle = arr[tiffOffset] === 0x49 && arr[tiffOffset + 1] === 0x49;
            const readUint16 = (off: number) => isLittle ? (arr[off] + (arr[off+1]<<8)) : ((arr[off]<<8) + arr[off+1]);
            const readUint32 = (off: number) => isLittle ? (arr[off] + (arr[off+1]<<8) + (arr[off+2]<<16) + (arr[off+3]<<24)) : ((arr[off]<<24) + (arr[off+1]<<16) + (arr[off+2]<<8) + arr[off+3]);
            const magic = readUint16(tiffOffset + 2);
            if (magic !== 0x002A && magic !== 42) return 1;
            const ifdOffset = readUint32(tiffOffset + 4);
            let dirStart = tiffOffset + ifdOffset;
            if (dirStart + 2 > arr.length) return 1;
            const entries = readUint16(dirStart);
            dirStart += 2;
            for (let i = 0; i < entries; i++) {
              const entryOffset = dirStart + i * 12;
              if (entryOffset + 12 > arr.length) break;
              const tag = readUint16(entryOffset);
              if (tag === 0x0112) {
                const type = readUint16(entryOffset + 2);
                const count = readUint32(entryOffset + 4);
                let valueOff = entryOffset + 8;
                let val = 0;
                if (type === 3 && count === 1) {
                  val = readUint16(valueOff);
                } else {
                  const actualValOffset = tiffOffset + readUint32(valueOff);
                  if (actualValOffset + 2 <= arr.length) val = readUint16(actualValOffset);
                }
                if (val >= 1 && val <= 8) return val;
                return 1;
              }
            }
          }
        }
        offset += 2 + len;
        continue;
      } else {
        if (offset + 4 > arr.length) break;
        const len = (arr[offset + 2] << 8) + arr[offset + 3];
        offset += 2 + len;
        continue;
      }
    }
  } catch (_e) {}
  return 1;
};
const SAMPLE_RADIUS_RATIO = 0.08;
const MIN_SAMPLE_RADIUS = 4;
const computeSampleHalf = (w: number, h: number): number => {
  if (!w || !h) return MIN_SAMPLE_RADIUS;
  const minDim = Math.min(w, h);
  if (!isFinite(minDim) || minDim <= 0) return MIN_SAMPLE_RADIUS;
  return Math.max(MIN_SAMPLE_RADIUS, Math.round(minDim * SAMPLE_RADIUS_RATIO));
};
export const hexToRgb = (hex: string): number[] => {
  if (!hex) return [0,0,0];
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0,2), 16) || 0;
  const g = parseInt(h.slice(2,4), 16) || 0;
  const b = parseInt(h.slice(4,6), 16) || 0;
  return [r,g,b];
};
export const decodeJpegAndSampleCenter = (base64: string): { r:number,g:number,b:number } | null => {
  const { jpegjs: _jpegjs, BufferShim: _BufferShim } = getJpegUtils();
  if (!_jpegjs || !_BufferShim) return null;
  try {
    if (base64.length > 5_000_000) return null;
    const buffer = _BufferShim.from(base64, 'base64');
    const decoded = _jpegjs.decode(buffer, {useTArray: true});
    if (!decoded || !decoded.width || !decoded.data) return null;
    const w = decoded.width; const h = decoded.height; const data = decoded.data;
    const cx = Math.floor(w/2); const cy = Math.floor(h/2);
    const half = computeSampleHalf(w, h);
    let rSum=0,gSum=0,bSum=0,count=0;
    for (let yy = Math.max(0, cy-half); yy <= Math.min(h-1, cy+half); yy++) {
      for (let xx = Math.max(0, cx-half); xx <= Math.min(w-1, cx+half); xx++) {
        const idx = (yy * w + xx) * 4;
        rSum += data[idx]; gSum += data[idx+1]; bSum += data[idx+2]; count++;
      }
    }
    if (count === 0) return null;
    return { r: Math.round(rSum/count), g: Math.round(gSum/count), b: Math.round(bSum/count) };
  } catch (_e) {
    return null;
  }
};
export function decodeJpegAndSampleAt(base64: string, relX: number, relY: number): { r:number,g:number,b:number } | null;
export function decodeJpegAndSampleAt(base64: string, relX: number, relY: number, pw?: number, ph?: number): { r:number,g:number,b:number } | null;
export function decodeJpegAndSampleAt(base64: string, relX: number, relY: number, pw?: number, ph?: number): { r:number,g:number,b:number } | null {
  const { jpegjs: _jpegjs, BufferShim: _BufferShim } = getJpegUtils();
  if (!_jpegjs || !_BufferShim) return null;
  try {
    if (base64.length > 8_000_000) return null;
    const buffer = _BufferShim.from(base64, 'base64');
    const decoded = _jpegjs.decode(buffer, {useTArray: true});
    if (!decoded || !decoded.width || !decoded.data) return null;
    const w = decoded.width; const h = decoded.height; const data = decoded.data;
    if (!pw || !ph) return decodeJpegAndSampleCenter(base64);
    const ix = Math.max(0, Math.min(w - 1, Math.round((relX / pw) * w)));
    const iy = Math.max(0, Math.min(h - 1, Math.round((relY / ph) * h)));
    const half = computeSampleHalf(w, h);
    let rSum=0,gSum=0,bSum=0,count=0;
    for (let yy = Math.max(0, iy-half); yy <= Math.min(h-1, iy+half); yy++) {
      for (let xx = Math.max(0, ix-half); xx <= Math.min(w-1, ix+half); xx++) {
        const idx = (yy * w + xx) * 4;
        rSum += data[idx]; gSum += data[idx+1]; bSum += data[idx+2]; count++;
      }
    }
    if (count === 0) return null;
    return { r: Math.round(rSum/count), g: Math.round(gSum/count), b: Math.round(bSum/count) };
  } catch (_e) {
    return null;
  }
}

export async function processWithIndicator(setProcessing: (v:boolean)=>void, fn: ()=>Promise<any>) {
  try {
    try { setProcessing(true); } catch (_e) {}
  try { await new Promise<void>((resolve) => setTimeout(() => resolve(), 50)); } catch (_e) {}
    const res = await fn();
    return res;
  } finally {
    try { setProcessing(false); } catch (_e) {}
  }
}

export async function mapPressToPreviewCoords(e: any, previewRef: any, previewLayoutRef: { current: { x:number,y:number,width:number,height:number } }) {
  const pageX = (e && e.nativeEvent && typeof e.nativeEvent.pageX === 'number') ? e.nativeEvent.pageX : (e && typeof e.pageX === 'number' ? e.pageX : 0);
  const pageY = (e && e.nativeEvent && typeof e.nativeEvent.pageY === 'number') ? e.nativeEvent.pageY : (e && typeof e.pageY === 'number' ? e.pageY : 0);
  const locX = (e && e.nativeEvent && typeof e.nativeEvent.locationX === 'number') ? e.nativeEvent.locationX : undefined;
  const locY = (e && e.nativeEvent && typeof e.nativeEvent.locationY === 'number') ? e.nativeEvent.locationY : undefined;
  let px = previewLayoutRef.current?.x || 0;
  let py = previewLayoutRef.current?.y || 0;
  let pw = previewLayoutRef.current?.width || 0;
  let ph = previewLayoutRef.current?.height || 0;
  try {
    if (previewRef && previewRef.current && typeof previewRef.current.measureInWindow === 'function') {
      await new Promise<void>((resolve) => {
        try {
          previewRef.current.measureInWindow((mx: number, my: number, mw: number, mh: number) => {
            if (typeof mx === 'number' && typeof my === 'number' && typeof mw === 'number' && typeof mh === 'number') {
              previewLayoutRef.current = { x: mx, y: my, width: mw, height: mh };
              px = mx; py = my; pw = mw; ph = mh;
            }
            resolve();
          });
        } catch (_e) { resolve(); }
      });
    }
  } catch (_e) {}
  let relX = (typeof pageX === 'number') ? Math.max(0, Math.min(pw, pageX - px)) : NaN;
  let relY = (typeof pageY === 'number') ? Math.max(0, Math.min(ph, pageY - py)) : NaN;
  const outsideThreshold = 10;
  const isOutside = isNaN(relX) || isNaN(relY) || relX < -outsideThreshold || relY < -outsideThreshold || relX > pw + outsideThreshold || relY > ph + outsideThreshold;
  if (isOutside && typeof locX === 'number' && typeof locY === 'number') {
    relX = Math.max(0, Math.min(pw, locX));
    relY = Math.max(0, Math.min(ph, locY));
  }
  if (isNaN(relX) || isNaN(relY)) { relX = 0; relY = 0; }
  try {
    const key = (previewLayoutRef && previewLayoutRef.current) ? `${Math.round(previewLayoutRef.current.width)}x${Math.round(previewLayoutRef.current.height)}` : 'default';
    const globalAny: any = globalThis as any;
    if (!globalAny.__clTapCorrection) globalAny.__clTapCorrection = {};
    if (!globalAny.__clTapCorrection[key]) globalAny.__clTapCorrection[key] = { dx: 0, dy: 0, count: 0 };
    const entry = globalAny.__clTapCorrection[key];
    const appliedDx = Math.max(-40, Math.min(40, Math.round(entry.dx)));
    const appliedDy = Math.max(-40, Math.min(40, Math.round(entry.dy)));
    const correctedX = Math.max(0, Math.min(pw, relX + appliedDx));
    const correctedY = Math.max(0, Math.min(ph, relY + appliedDy));
    return { relX: Math.round(correctedX), relY: Math.round(correctedY) };
  } catch (_e) { return { relX: Math.round(relX), relY: Math.round(relY) }; }
}

export function mapLocalPressToPreviewCoords(e: any, previewLayoutRef: { current: { x:number,y:number,width:number,height:number } }) {
  try {
    const locX = e && e.nativeEvent && typeof e.nativeEvent.locationX === 'number' ? e.nativeEvent.locationX : 0;
    const locY = e && e.nativeEvent && typeof e.nativeEvent.locationY === 'number' ? e.nativeEvent.locationY : 0;
    const pw = previewLayoutRef.current?.width || 0;
    const ph = previewLayoutRef.current?.height || 0;
    let relX = Math.max(0, Math.min(pw, locX));
    let relY = Math.max(0, Math.min(ph, locY));
    const key = (previewLayoutRef && previewLayoutRef.current) ? `${Math.round(previewLayoutRef.current.width)}x${Math.round(previewLayoutRef.current.height)}` : 'default';
    const globalAny: any = globalThis as any;
    if (!globalAny.__clTapCorrection) globalAny.__clTapCorrection = {};
    if (!globalAny.__clTapCorrection[key]) globalAny.__clTapCorrection[key] = { dx: 0, dy: 0, count: 0 };
    const entry = globalAny.__clTapCorrection[key];
    const appliedDx = Math.max(-40, Math.min(40, Math.round(entry.dx)));
    const appliedDy = Math.max(-40, Math.min(40, Math.round(entry.dy)));
    const correctedX = Math.max(0, Math.min(pw, relX + appliedDx));
    const correctedY = Math.max(0, Math.min(ph, relY + appliedDy));
    return { relX: Math.round(correctedX), relY: Math.round(correctedY) };
  } catch (_e) {
    return { relX: 0, relY: 0 };
  }
}

export function normalizeBrightnessICtCp(rgb: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  try {
    const Color = require('colorjs.io');
    const sr = Math.max(0, Math.min(1, rgb.r / 255));
    const sg = Math.max(0, Math.min(1, rgb.g / 255));
    const sb = Math.max(0, Math.min(1, rgb.b / 255));
    const c = new Color('srgb', [sr, sg, sb]).to('ictcp');
    const I = (c && Array.isArray(c.coords) && typeof c.coords[0] === 'number') ? c.coords[0] : 0.0;
    const target = 0.5;
    const eps = 1e-6;
    let scale = target / Math.max(eps, I);
    scale = Math.max(0.6, Math.min(1.6, scale));
    const outR = Math.max(0, Math.min(255, Math.round(rgb.r * scale)));
    const outG = Math.max(0, Math.min(255, Math.round(rgb.g * scale)));
    const outB = Math.max(0, Math.min(255, Math.round(rgb.b * scale)));
    return { r: outR, g: outG, b: outB };
  } catch (_e) {
    return rgb;
  }
}