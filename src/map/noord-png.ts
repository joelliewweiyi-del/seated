// Build/test-only indexed PNG codec. No canvas interpolation and no image dependencies.
import { deflateSync, inflateSync } from 'node:zlib';

export interface IndexedPNG { w: number; h: number; pixels: Uint8Array; palette: string[]; alpha: Uint8Array }
export function readPNG(png: Buffer): IndexedPNG {
  let w = 0, h = 0, depth = 8;
  let palette: string[] = [], alpha = new Uint8Array(256).fill(255);
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8), b = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = b.readUInt32BE(0); h = b.readUInt32BE(4);
      depth = b[8]!;
      if (![4, 8].includes(depth) || b[9] !== 3 || b[12] !== 0) throw new Error('Expected non-interlaced 4/8-bit indexed PNG');
    } else if (type === 'PLTE') {
      for (let i = 0; i < b.length; i += 3) palette.push('#' + b.subarray(i, i + 3).toString('hex'));
    } else if (type === 'tRNS') alpha.set(b);
    else if (type === 'IDAT') idat.push(b);
    at += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat)), pixels = new Uint8Array(w * h);
  const stride = Math.ceil(w * depth / 8), bytes = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < stride; x++) {
    const i = y * stride + x, f = raw[y * (stride + 1)]!;
    const a = x ? bytes[i - 1]! : 0, b = y ? bytes[i - stride]! : 0, c = x && y ? bytes[i - stride - 1]! : 0;
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
    if (pred === undefined) throw new Error('Invalid PNG filter');
    bytes[i] = (raw[y * (stride + 1) + 1 + x]! + pred) & 255;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const b = bytes[y * stride + Math.floor(x * depth / 8)]!;
    pixels[y * w + x] = depth === 8 ? b : (b >>> (x % 2 ? 0 : 4)) & 15;
  }
  return { w, h, pixels, palette, alpha };
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let j = 0; j < 8; j++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); out.write(type, 4); out.set(data, 8);
  let crc = 0xffffffff;
  for (const b of out.subarray(4, -4)) crc = crcTable[(crc ^ b) & 255]! ^ (crc >>> 8);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
/** Index zero is transparent; every other index is opaque. */
export function writePNG(w: number, h: number, pixels: Uint8Array, palette: string[]): Buffer {
  if (palette.length > 256 || pixels.length !== w * h) throw new Error('Invalid indexed image');
  const depth = palette.length <= 16 ? 4 : 8, stride = Math.ceil(w * depth / 8);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = 3;
  const rows = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = y * (stride + 1) + 1 + Math.floor(x * depth / 8), k = pixels[y * w + x]!;
    rows[at] = depth === 8 ? k : rows[at]! | (k << (x % 2 ? 0 : 4));
  }
  // Indexed colour often prefers no filter, but packed far levels and broad facade planes can
  // benefit from row-adaptive predictors. Compare the actual deflated streams; this is lossless.
  const adaptive = Buffer.alloc(rows.length), candidates = Array.from({length:4}, () => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    const scores = [0,0,0,0];
    for (let x = 0; x < stride; x++) {
      const i = y * (stride + 1) + x + 1, v = rows[i]!;
      const a=x ? rows[i-1]! : 0, b=y ? rows[i-stride-1]! : 0, c=x && y ? rows[i-stride-2]! : 0;
      const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c);
      const predictors=[0,a,b,pa<=pb && pa<=pc ? a : pb<=pc ? b : c];
      for(let f=0;f<4;f++) {
        const k=(v-predictors[f]!)&255;
        candidates[f]![x]=k; scores[f]!+=Math.min(k,256-k);
      }
    }
    let best=0; for(let f=1;f<4;f++) if(scores[f]!<scores[best]!) best=f;
    adaptive[y*(stride+1)]=[0,1,2,4][best]!;
    adaptive.set(candidates[best]!,y*(stride+1)+1);
  }
  const streams=[deflateSync(rows,{level:9}), deflateSync(rows,{level:9,memLevel:9}), deflateSync(adaptive,{level:9})];
  const compressed=streams.reduce((a,b)=>a.length<=b.length ? a : b);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('PLTE', Buffer.from(palette.map(h => h.slice(1)).join(''), 'hex')), chunk('tRNS', Uint8Array.of(0)), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())]);
}
