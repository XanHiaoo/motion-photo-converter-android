import type { MediaAnalysis } from './types';

export interface EmbeddedMotionRanges {
  imageStart: 0;
  imageEnd: number;
  videoStart: number;
  videoEnd: number;
  videoMime: 'video/mp4' | 'video/quicktime';
  videoExtension: 'mp4' | 'mov';
}

export function locateEmbeddedMotionParts(analysis: MediaAnalysis): EmbeddedMotionRanges {
  if (analysis.staticFormat === 'Unknown') throw new Error('未识别到 JPEG 或 HEIC 静态图片。');
  if (analysis.videoStart === null || analysis.videoSize === null || analysis.videoSize <= 8) {
    throw new Error('未在文件中找到内嵌的 MP4/MOV 视频。');
  }
  const videoEnd = analysis.videoStart + analysis.videoSize;
  if (analysis.videoStart <= 0 || videoEnd > analysis.size) throw new Error('动态图中的视频位置或长度无效。');
  const isMov = analysis.videoFormat === 'MOV/QuickTime';
  return {
    imageStart: 0,
    imageEnd: analysis.jpegEoi ?? analysis.videoStart,
    videoStart: analysis.videoStart,
    videoEnd,
    videoMime: isMov ? 'video/quicktime' : 'video/mp4',
    videoExtension: isMov ? 'mov' : 'mp4',
  };
}
