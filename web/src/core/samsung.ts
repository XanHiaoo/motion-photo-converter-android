import { ascii, concatBytes, readLe32, utf8, writeLe32 } from './binary';
import type { SamsungTrailerInfo } from './types';

const MOTION_DATA_MARKER = new Uint8Array([0x00, 0x00, 0x30, 0x0a]);
const MOTION_VERSION_MARKER = new Uint8Array([0x00, 0x00, 0x31, 0x0a]);
const MOTION_DATA_NAME = utf8('MotionPhoto_Data');
const MOTION_VERSION_NAME = utf8('MotionPhoto_Version');

export interface BuiltSamsungTrailer {
  bytes: Uint8Array;
  negativeVideoOffset: number;
  motionItemLength: number;
  primaryPadding: number;
}

export function buildSamsungTrailer(video: Uint8Array): BuiltSamsungTrailer {
  const motionHeader = concatBytes(MOTION_DATA_MARKER, writeLe32(MOTION_DATA_NAME.length), MOTION_DATA_NAME);
  const motionTag = concatBytes(motionHeader, video);
  const versionTag = concatBytes(
    MOTION_VERSION_MARKER,
    writeLe32(MOTION_VERSION_NAME.length),
    MOTION_VERSION_NAME,
    utf8('mpv3'),
  );
  const motionOffset = motionTag.length + versionTag.length;
  const versionOffset = versionTag.length;
  const sefBody = concatBytes(
    utf8('SEFH'),
    writeLe32(107),
    writeLe32(2),
    MOTION_DATA_MARKER,
    writeLe32(motionOffset),
    writeLe32(motionTag.length),
    MOTION_VERSION_MARKER,
    writeLe32(versionOffset),
    writeLe32(versionTag.length),
  );
  const sefTail = concatBytes(writeLe32(sefBody.length), utf8('SEFT'));
  const bytes = concatBytes(motionTag, versionTag, sefBody, sefTail);
  const motionItemLength = bytes.length - motionHeader.length;
  return {
    bytes,
    negativeVideoOffset: motionItemLength,
    motionItemLength,
    primaryPadding: motionHeader.length,
  };
}

export function parseSamsungTrailer(bytes: Uint8Array): SamsungTrailerInfo | null {
  if (bytes.length < 40 || ascii(bytes, bytes.length - 4, 4) !== 'SEFT') return null;
  const sefDataSize = readLe32(bytes, bytes.length - 8);
  const sefStart = bytes.length - 8 - sefDataSize;
  if (sefStart < 0 || ascii(bytes, sefStart, 4) !== 'SEFH') return null;
  const fieldCount = readLe32(bytes, sefStart + 8);
  if (fieldCount < 1 || sefStart + 12 + fieldCount * 12 > bytes.length - 8) return null;
  for (let index = 0; index < fieldCount; index += 1) {
    const record = sefStart + 12 + index * 12;
    if (bytes[record + 2] !== 0x30 || bytes[record + 3] !== 0x0a) continue;
    const negativeOffset = readLe32(bytes, record + 4);
    const fieldSize = readLe32(bytes, record + 8);
    const trailerStart = sefStart - negativeOffset;
    if (trailerStart < 0 || trailerStart + fieldSize > sefStart) continue;
    const nameLength = readLe32(bytes, trailerStart + 4);
    if (nameLength > 256 || ascii(bytes, trailerStart + 8, nameLength) !== 'MotionPhoto_Data') continue;
    const videoStart = trailerStart + 8 + nameLength;
    const videoSize = fieldSize - 8 - nameLength;
    if (videoSize <= 0 || videoStart + videoSize > sefStart) continue;
    return { trailerStart, videoStart, videoSize, sefStart, fieldSize };
  }
  return null;
}
