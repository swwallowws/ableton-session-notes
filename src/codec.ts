// Set notes travel inside the Set as clip names. Since Live 12.4.15b7 extensions
// can't touch the project folder, so the notes are packed into the names of empty
// clips on a take lane: JSON -> Brotli -> CRC32 -> block bars (▁▂▃▄▅▆▇█, so
// the data looks like a waveform), split into chunks. Pure: no SDK, no file
// system, so it can be tested headlessly.
//
// One clip name: "Session Notes (do not edit) SN2 <id> <part>/<total> <byteLength> <bars>".
// The label is what shows on the clip, and the header is plain ASCII so the id
// and part count survive even if the body is damaged. The 0.3.0 beta wrote
// "SN1 <id> ..." with a CJK (base16384) body: those still decode, and the next
// save rewrites them in the current form.
import { randomInt } from "node:crypto";
import * as zlib from "node:zlib";

export type Bundle = {
  v: 1;
  id: string; // 8 base36 chars, minted the first time a Set saves notes
  rev: string; // "<counter>-<4 base36>"
  parent: string; // the rev this edit started from ("" for the first)
  saved: string; // ISO time
  current?: string; // the note that was open
  forkedFrom?: string; // the id this Set split off from (see reconcile.isFork)
  notes: Record<string, string>;
};

export type Damaged = { id: string | null; reason: string; names: string[] };

const MAGIC = "Session Notes (do not edit) SN2 ";
const LEGACY = "SN1 ";
// 16,000 characters per name stays inside what the spike verified (16,384).
const CHUNK = 16000;
const BASE = 0x4e00; // legacy body: U+4E00..U+8DFF, 16,384 CJK ideographs
const HEADER = /^Session Notes \(do not edit\) SN2 ([0-9a-z]{8}) (\d+)\/(\d+) (\d+) ([\s\S]*)$/;
const LEGACY_HEADER = /^SN1 ([0-9a-z]{8}) (\d+)\/(\d+) (\d+) ([\s\S]*)$/;
const BARS = "▁▂▃▄▅▆▇█"; // U+2581..U+2588, one per 3 bits
// A Set can come from anyone: a few KB of Brotli can expand to gigabytes. Real
// notes are far below this.
const MAX_JSON = 8 * 1024 * 1024;

const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const randomB36 = (n: number) => Array.from({ length: n }, () => B36[randomInt(36)]).join("");

export const newId = (): string => randomB36(8);

export const revCounter = (rev: string): number => {
  const m = /^(\d+)-/.exec(rev);
  return m ? Number(m[1]) : 0;
};

export const nextRev = (parent: string): string => `${revCounter(parent) + 1}-${randomB36(4)}`;

export const isDataName = (name: string): boolean =>
  typeof name === "string" && (name.startsWith(MAGIC) || name.startsWith(LEGACY));

// 14 bits per character, so 7 bytes become 4 characters. Only read now.
export function toBase16384(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 14) {
      bits -= 14;
      out += String.fromCharCode(BASE + ((acc >>> bits) & 0x3fff));
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += String.fromCharCode(BASE + ((acc << (14 - bits)) & 0x3fff));
  return out;
}

export function fromBase16384(s: string, byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength);
  let acc = 0;
  let bits = 0;
  let i = 0;
  for (let k = 0; k < s.length && i < byteLength; k++) {
    const v = s.charCodeAt(k) - BASE;
    if (v < 0 || v > 0x3fff) throw new Error("character outside the alphabet");
    acc = (acc << 14) | v;
    bits += 14;
    while (bits >= 8 && i < byteLength) {
      bits -= 8;
      out[i++] = (acc >>> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  if (i < byteLength) throw new Error("too few characters");
  return out;
}

// 3 bits per bar, so the clip name reads as a waveform.
export function toWave(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 3) {
      bits -= 3;
      out += BARS[(acc >>> bits) & 7];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += BARS[(acc << (3 - bits)) & 7];
  return out;
}

export function fromWave(s: string, byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength);
  let acc = 0;
  let bits = 0;
  let i = 0;
  for (let k = 0; k < s.length && i < byteLength; k++) {
    const v = BARS.indexOf(s[k]!);
    if (v < 0) throw new Error("character outside the alphabet");
    acc = (acc << 3) | v;
    bits += 3;
    if (bits >= 8) {
      bits -= 8;
      out[i++] = (acc >>> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  if (i < byteLength) throw new Error("too few characters");
  return out;
}

export function encodeBundle(b: Bundle, chunkChars = CHUNK): string[] {
  const json = Buffer.from(JSON.stringify(b), "utf8");
  const packed = zlib.brotliCompressSync(json, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length,
    },
  });
  const stream = Buffer.alloc(4 + packed.length);
  stream.writeUInt32BE(zlib.crc32(packed), 0);
  packed.copy(stream, 4);
  const body = toWave(stream);
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += chunkChars) chunks.push(body.slice(i, i + chunkChars));
  if (!chunks.length) chunks.push("");
  return chunks.map((c, i) => `${MAGIC}${b.id} ${i + 1}/${chunks.length} ${stream.length} ${c}`);
}

const isBundle = (x: any): x is Bundle =>
  !!x &&
  x.v === 1 &&
  typeof x.id === "string" &&
  typeof x.rev === "string" &&
  typeof x.parent === "string" &&
  typeof x.saved === "string" &&
  !!x.notes &&
  typeof x.notes === "object" &&
  Object.values(x.notes).every((t) => typeof t === "string");

type Group = { id: string; legacy: boolean; total: number; byteLength: number; parts: Map<number, string>; names: string[] };

export function decodeNames(names: string[]): { bundles: Bundle[]; damaged: Damaged[] } {
  const bundles: Bundle[] = [];
  const damaged: Damaged[] = [];
  const groups = new Map<string, Group>();

  for (const name of names) {
    if (!isDataName(name)) continue;
    const legacy = name.startsWith(LEGACY);
    const m = (legacy ? LEGACY_HEADER : HEADER).exec(name);
    if (!m) {
      damaged.push({ id: null, reason: "unreadable header", names: [name] });
      continue;
    }
    const [, id, part, total, byteLength, chunk] = m as unknown as [string, string, string, string, string, string];
    const key = (legacy ? "1:" : "2:") + id;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { id, legacy, total: Number(total), byteLength: Number(byteLength), parts: new Map(), names: [] }));
    g.names.push(name);
    if (!g.parts.has(Number(part))) g.parts.set(Number(part), chunk);
  }

  for (const g of groups.values()) {
    const { id } = g;
    try {
      for (let p = 1; p <= g.total; p++)
        if (!g.parts.has(p)) {
          damaged.push({ id, reason: "missing part", names: g.names });
          throw null;
        }
      let body = "";
      for (let p = 1; p <= g.total; p++) body += g.parts.get(p);
      if (g.byteLength > MAX_JSON) throw new Error("too long");
      const stream = Buffer.from(g.legacy ? fromBase16384(body, g.byteLength) : fromWave(body, g.byteLength));
      if (stream.length < 4) throw new Error("too short");
      const packed = stream.subarray(4);
      if (zlib.crc32(packed) !== stream.readUInt32BE(0)) throw new Error("checksum mismatch");
      const json = zlib.brotliDecompressSync(packed, { maxOutputLength: MAX_JSON });
      const parsed = JSON.parse(json.toString("utf8"));
      if (!isBundle(parsed) || parsed.id !== id) throw new Error("not a version 1 bundle");
      bundles.push(parsed);
    } catch (e) {
      if (e !== null) damaged.push({ id, reason: e instanceof Error ? e.message : String(e), names: g.names });
    }
  }
  return { bundles, damaged };
}
