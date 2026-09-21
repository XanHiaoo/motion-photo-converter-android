import { ascii, findAscii, readBe32 } from './binary';
import { parseJpeg } from './jpeg';
import { detectCodec, detectVideoFormat, findMp4Start, parseDuration, parseTopLevelAtoms } from './mp4';
import { parseSamsungTrailer } from './samsung';
import type { MediaAnalysis } from './types';
import { validateAnalysis } from './validate';
import { extractContentIdentifier, extractXmp, xmpNumber } from './xmp';

function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return false;
  return /^(?:hei[cf]|mif1|msf1|heix)$/i.test(ascii(bytes, 8, 4));
}

export function analyzeBytes(bytes: Uint8Array, fileName: string, mime = ''): MediaAnalysis {
  const jpeg = parseJpeg(bytes);
  const heif = !jpeg && isHeif(bytes);
  const xmp = extractXmp(bytes);
  const samsung = parseSamsungTrailer(bytes);
  const xmpVideoLength = xmpNumber(xmp, 'Item:Length');
  const microVideoOffset = xmpNumber(xmp, 'Camera:MicroVideoOffset', 'GCamera:MicroVideoOffset');
  const samsungVideoIsMp4 = samsung ? findMp4Start(bytes, samsung.videoStart) === samsung.videoStart : false;
  let videoStart = samsungVideoIsMp4 ? samsung!.videoStart : null;
  let videoSize = samsungVideoIsMp4 ? samsung!.videoSize : null;

  if (videoStart === null && heif) {
    const mpvdType = findAscii(bytes, 'mpvd');
    if (mpvdType >= 4) {
      const boxStart = mpvdType - 4;
      const boxSize = readBe32(bytes, boxStart);
      const embeddedStart = mpvdType + 4;
      if (boxSize > 16 && boxStart + boxSize <= bytes.length && findMp4Start(bytes, embeddedStart) === embeddedStart) {
        videoStart = embeddedStart;
        videoSize = boxSize - 8;
      }
    }
  }

  if (videoStart === null && xmpVideoLength && xmpVideoLength > 8 && xmpVideoLength <= bytes.length) {
    videoStart = bytes.length - xmpVideoLength;
    videoSize = xmpVideoLength;
  } else if (videoStart === null && microVideoOffset && microVideoOffset > 8 && microVideoOffset <= bytes.length) {
    videoStart = bytes.length - microVideoOffset;
    videoSize = microVideoOffset;
  }
  if (videoStart === null && (jpeg || heif)) {
    const searchFrom = jpeg?.eoi ?? 0;
    const found = findMp4Start(bytes, searchFrom);
    if (found !== null) {
      videoStart = found;
      videoSize = (samsung?.sefStart ?? bytes.length) - found;
    }
  }
  if (videoStart === null && !jpeg && !heif && findMp4Start(bytes, 0) === 0) {
    videoStart = 0;
    videoSize = bytes.length;
  }

  const videoEnd = videoStart !== null && videoSize !== null ? videoStart + videoSize : 0;
  const atoms = videoStart !== null ? parseTopLevelAtoms(bytes, videoStart, videoEnd) : [];
  const videoFormat = videoStart !== null ? detectVideoFormat(bytes, videoStart) : null;
  const codec = videoStart !== null ? detectCodec(bytes, videoStart, videoEnd) : null;
  const presentationTimestampUs = xmpNumber(
    xmp,
    'Camera:MotionPhotoPresentationTimestampUs',
    'GCamera:MicroVideoPresentationTimestampUs',
  );
  const contentIdentifier = extractContentIdentifier(bytes);
  const hasMotionXmp = Boolean(xmp && /(?:Camera|GCamera):(?:MotionPhoto|MicroVideo)=["']1["']/i.test(xmp));
  const isVideoFile = !jpeg && !heif && videoStart === 0;
  const format = samsung
    ? 'Samsung Motion Photo'
    : hasMotionXmp && videoStart !== null
      ? 'Android Motion Photo'
      : (jpeg || heif) && videoStart !== null
        ? '内嵌动态照片'
      : contentIdentifier
        ? 'Apple Live Photo 组件'
        : jpeg || heif
          ? '普通图片'
          : isVideoFile
            ? '普通视频'
            : '未知格式';

  const base = {
    fileName,
    mime: mime || 'application/octet-stream',
    size: bytes.length,
    format,
    staticFormat: jpeg ? ('JPEG' as const) : heif ? ('HEIC/HEIF' as const) : ('Unknown' as const),
    videoFormat,
    imageSize: jpeg?.eoi ?? (videoStart !== null ? videoStart : heif ? bytes.length : null),
    videoStart,
    videoSize,
    jpegEoi: jpeg?.eoi ?? null,
    xmp,
    hasXmp: Boolean(xmp),
    hasSamsungTrailer: Boolean(samsung),
    presentationTimestampUs,
    contentIdentifier,
    codec,
    durationSeconds: videoStart !== null ? parseDuration(bytes, videoStart, videoEnd) : null,
    mp4Atoms: atoms,
  } satisfies Omit<MediaAnalysis, 'validation'>;
  return { ...base, validation: validateAnalysis(base) };
}
