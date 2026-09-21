import { ascii, findAscii, readBe32 } from './binary';
import type { Mp4Atom } from './types';

export function findMp4Start(bytes: Uint8Array, from = 0): number | null {
  let cursor = from;
  while (cursor < bytes.length - 12) {
    const ftyp = findAscii(bytes, 'ftyp', cursor);
    if (ftyp < 4) return null;
    const start = ftyp - 4;
    const size = readBe32(bytes, start);
    if (size >= 8 && start + size <= bytes.length) return start;
    cursor = ftyp + 4;
  }
  return null;
}

export function parseTopLevelAtoms(bytes: Uint8Array, start = 0, end = bytes.length): Mp4Atom[] {
  const atoms: Mp4Atom[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = readBe32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      const high = readBe32(bytes, offset + 8);
      const low = readBe32(bytes, offset + 12);
      const combined = high * 2 ** 32 + low;
      if (!Number.isSafeInteger(combined)) break;
      size = combined;
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    atoms.push({ type, offset, size });
    offset += size;
  }
  return atoms;
}

export function detectVideoFormat(bytes: Uint8Array, start: number): 'MP4' | 'MOV/QuickTime' | 'Unknown' {
  const brand = ascii(bytes, start + 8, 4);
  if (brand === 'qt  ') return 'MOV/QuickTime';
  if (ascii(bytes, start + 4, 4) === 'ftyp') return 'MP4';
  return 'Unknown';
}

export function detectCodec(bytes: Uint8Array, start: number, end: number): string | null {
  const codecs: Array<[string, string]> = [
    ['avc1', 'H.264 / AVC'],
    ['avc3', 'H.264 / AVC'],
    ['hvc1', 'H.265 / HEVC'],
    ['hev1', 'H.265 / HEVC'],
    ['av01', 'AV1'],
  ];
  for (const [needle, label] of codecs) {
    if (findAscii(bytes, needle, start, end) >= 0) return label;
  }
  return null;
}

export function parseDuration(bytes: Uint8Array, start: number, end: number): number | null {
  const mvhd = findAscii(bytes, 'mvhd', start, end);
  if (mvhd < 0 || mvhd + 24 >= end) return null;
  const version = bytes[mvhd + 4];
  if (version === 0) {
    const timescale = readBe32(bytes, mvhd + 16);
    const duration = readBe32(bytes, mvhd + 20);
    return timescale ? duration / timescale : null;
  }
  if (version === 1 && mvhd + 36 < end) {
    const timescale = readBe32(bytes, mvhd + 24);
    const high = readBe32(bytes, mvhd + 28);
    const low = readBe32(bytes, mvhd + 32);
    const duration = high * 2 ** 32 + low;
    return timescale && Number.isSafeInteger(duration) ? duration / timescale : null;
  }
  return null;
}
