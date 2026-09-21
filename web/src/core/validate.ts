import type { MediaAnalysis, ValidationReport } from './types';

export function validateAnalysis(analysis: Omit<MediaAnalysis, 'validation'>): ValidationReport {
  const imageValid = analysis.staticFormat !== 'Unknown';
  const videoValid = analysis.videoStart !== null && analysis.videoSize !== null && analysis.videoSize > 8;
  const xmpValid = Boolean(
    analysis.xmp &&
      /(?:Camera|GCamera):MotionPhoto=["']1["']/i.test(analysis.xmp) &&
      /Item:(?:Semantic=["']MotionPhoto|Length=["']\d+)/i.test(analysis.xmp),
  );
  const offsetValid = videoValid && analysis.videoStart! + analysis.videoSize! <= analysis.size;
  const containerValid = analysis.mp4Atoms.some((atom) => atom.type === 'ftyp');
  const presentationTimestampValid =
    analysis.presentationTimestampUs === null || analysis.presentationTimestampUs >= -1;
  const trailerValid = analysis.hasSamsungTrailer;
  const isMotionPhoto = videoValid && (xmpValid || trailerValid);
  const isSamsungCompatible =
    analysis.staticFormat === 'JPEG' && videoValid && xmpValid && trailerValid && containerValid;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!imageValid) errors.push('未识别到有效的 JPEG/HEIC 主图片。');
  if (!videoValid && analysis.format !== '普通图片') errors.push('未找到可提取的视频数据。');
  if (isMotionPhoto && !xmpValid) warnings.push('缺少或无法完整解析 Android Motion Photo XMP。');
  if (isMotionPhoto && !trailerValid) warnings.push('缺少 Samsung SEF / MotionPhoto_Data trailer。');
  if (analysis.videoFormat === 'MOV/QuickTime') warnings.push('视频为 MOV；部分三星机型可能需要 MP4/H.264 才能播放。');
  if (analysis.codec && !analysis.codec.includes('H.264')) warnings.push(`视频编码为 ${analysis.codec}，需要三星实机验证。`);
  return {
    isMotionPhoto,
    isSamsungCompatible,
    imageValid,
    videoValid,
    xmpValid,
    offsetValid,
    containerValid,
    presentationTimestampValid,
    trailerValid,
    errors,
    warnings,
  };
}
