import { locateEmbeddedMotionParts, outputName, type MediaAnalysis } from '../core';
import { normalizeImage } from './image-normalize';
import { addCoverFade, DEFAULT_COVER_FADE_SECONDS, normalizeVideo } from './video-remux';
import { readVideoDimensions } from './video-metadata';
import { muxFiles } from './worker-client';

export interface EmbeddedConversionResult {
  blob: Blob;
  name: string;
  analysis: MediaAnalysis;
}

export interface EmbeddedConversionOptions {
  fadeToCover?: boolean;
  coverFadeSeconds?: number;
}

export async function convertEmbeddedMotionFile(
  source: File,
  sourceAnalysis: MediaAnalysis,
  onStage?: (stage: string) => void,
  options: EmbeddedConversionOptions = {},
): Promise<EmbeddedConversionResult> {
  const ranges = locateEmbeddedMotionParts(sourceAnalysis);
  onStage?.('正在提取图片…');

  const imageSource = sourceAnalysis.staticFormat === 'JPEG'
    ? new File(
        [source.slice(ranges.imageStart, ranges.imageEnd, 'image/jpeg')],
        `${source.name.replace(/\.[^.]+$/, '')}.jpg`,
        { type: 'image/jpeg', lastModified: source.lastModified },
      )
    : source;
  const image = await normalizeImage(imageSource, onStage);

  onStage?.('正在提取视频…');
  const video = new File(
    [source.slice(ranges.videoStart, ranges.videoEnd, ranges.videoMime)],
    `${source.name.replace(/\.[^.]+$/, '')}.${ranges.videoExtension}`,
    { type: ranges.videoMime, lastModified: source.lastModified },
  );
  const normalizedVideo = await normalizeVideo(video, onStage);
  let videoForOutput = normalizedVideo;
  if (options.fadeToCover) {
    onStage?.('正在添加封面渐变…');
    const duration = sourceAnalysis.durationSeconds;
    if (!duration || duration <= 0) throw new Error('无法读取视频时长，无法添加封面渐变。');
    const dimensions = await readVideoDimensions(normalizedVideo);
    videoForOutput = await addCoverFade(
      normalizedVideo,
      image,
      duration,
      dimensions.width,
      dimensions.height,
      options.coverFadeSeconds ?? DEFAULT_COVER_FADE_SECONDS,
      onStage,
    );
  }

  onStage?.('正在写入 Motion Photo…');
  const sourceTimestamp = sourceAnalysis.presentationTimestampUs;
  const timestampUs = sourceTimestamp !== null
    ? sourceTimestamp
    : sourceAnalysis.durationSeconds
      ? Math.round(sourceAnalysis.durationSeconds * 500_000)
      : -1;
  const name = outputName(source.name);
  const result = await muxFiles(image, videoForOutput, name, timestampUs);
  if (!result.analysis.validation.isSamsungCompatible) throw new Error('生成结果未通过 Samsung Motion Photo 结构校验。');
  return { blob: result.blob, name, analysis: result.analysis };
}
