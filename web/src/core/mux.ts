import { concatBytes } from './binary';
import { injectXmp, isJpeg, parseJpeg } from './jpeg';
import { detectVideoFormat, findMp4Start } from './mp4';
import { buildSamsungTrailer } from './samsung';
import { buildMotionPhotoXmp } from './xmp';

export interface MuxOptions {
  timestampUs?: number;
  sourceVideoMime?: string;
}

export function muxSamsungMotionPhoto(
  imageInput: Uint8Array,
  videoInput: Uint8Array,
  options: MuxOptions = {},
): Uint8Array {
  if (!isJpeg(imageInput)) throw new Error('MVP 输出目前要求 JPEG 主图片；HEIC 输入请先转换为 JPEG。');
  const jpeg = parseJpeg(imageInput);
  if (!jpeg) throw new Error('无法解析 JPEG 结构。');
  const cleanImage = imageInput.slice(0, jpeg.eoi);
  const videoStart = findMp4Start(videoInput, 0);
  if (videoStart !== 0) throw new Error('视频不是有效的 MP4/MOV（缺少 ftyp box）。');
  const videoFormat = detectVideoFormat(videoInput, 0);
  const videoMime =
    options.sourceVideoMime === 'video/quicktime' || videoFormat === 'MOV/QuickTime' ? 'video/quicktime' : 'video/mp4';
  const trailer = buildSamsungTrailer(videoInput);
  const timestampUs = options.timestampUs ?? -1;
  const xmp = buildMotionPhotoXmp(
    trailer.motionItemLength,
    trailer.negativeVideoOffset,
    timestampUs,
    videoMime,
    trailer.primaryPadding,
  );
  const imageWithXmp = injectXmp(cleanImage, xmp);
  return concatBytes(imageWithXmp, trailer.bytes);
}

export function outputName(inputName: string): string {
  const stem = inputName.replace(/\.[^.]+$/, '').replace(/_MP$/i, '');
  return `${stem}_MP.jpg`;
}
