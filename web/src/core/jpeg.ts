import { concatBytes, readBe16, utf8, writeBe16 } from './binary';

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

interface JpegSegment {
  start: number;
  end: number;
  marker: number;
  isXmp: boolean;
}

export interface JpegStructure {
  eoi: number;
  scanStart: number;
  segments: JpegSegment[];
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function startsWith(bytes: Uint8Array, offset: number, text: string): boolean {
  const target = utf8(text);
  if (offset + target.length > bytes.length) return false;
  return target.every((value, index) => bytes[offset + index] === value);
}

export function parseJpeg(bytes: Uint8Array): JpegStructure | null {
  if (!isJpeg(bytes)) return null;
  const segments: JpegSegment[] = [];
  let position = 2;

  while (position + 1 < bytes.length) {
    if (bytes[position] !== 0xff) return null;
    const markerStart = position;
    while (bytes[position] === 0xff) position += 1;
    const marker = bytes[position];
    position += 1;

    if (marker === 0xd9) return { eoi: position, scanStart: markerStart, segments };
    if (marker === 0xda) {
      if (position + 2 > bytes.length) return null;
      const scanStart = markerStart;
      position += readBe16(bytes, position);
      for (let index = position; index + 1 < bytes.length; index += 1) {
        if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
          return { eoi: index + 2, scanStart, segments };
        }
      }
      return null;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (position + 2 > bytes.length) return null;
    const length = readBe16(bytes, position);
    if (length < 2 || position + length > bytes.length) return null;
    const end = position + length;
    segments.push({
      start: markerStart,
      end,
      marker,
      isXmp: marker === 0xe1 && startsWith(bytes, position + 2, XMP_HEADER),
    });
    position = end;
  }
  return null;
}

export function makeXmpApp1(xmp: string): Uint8Array {
  const payload = concatBytes(utf8(XMP_HEADER), utf8(xmp));
  if (payload.length + 2 > 0xffff) throw new Error('XMP packet exceeds the JPEG APP1 size limit.');
  return concatBytes(new Uint8Array([0xff, 0xe1]), writeBe16(payload.length + 2), payload);
}

export function injectXmp(bytes: Uint8Array, xmp: string): Uint8Array {
  const structure = parseJpeg(bytes);
  if (!structure) throw new Error('输入图片不是有效的 JPEG。');
  const prefixParts: Uint8Array[] = [bytes.slice(0, 2)];
  let cursor = 2;
  for (const segment of structure.segments) {
    if (segment.start > cursor) prefixParts.push(bytes.slice(cursor, segment.start));
    if (!segment.isXmp) prefixParts.push(bytes.slice(segment.start, segment.end));
    cursor = segment.end;
  }
  if (cursor < structure.scanStart) prefixParts.push(bytes.slice(cursor, structure.scanStart));
  prefixParts.push(makeXmpApp1(xmp));
  prefixParts.push(bytes.slice(structure.scanStart, structure.eoi));
  return concatBytes(...prefixParts);
}
