import { locateEmbeddedMotionParts, outputName, type MediaAnalysis } from '../core';
import { normalizeImage } from './image-normalize';
import { normalizeVideo } from './video-remux';
import { muxFiles } from './worker-client';

export interface EmbeddedConversionResult {
  blob: Blob;
  name: string;
  analysis: MediaAnalysis;
}

export async function convertEmbeddedMotionFile(
  source: File,
  sourceAnalysis: MediaAnalysis,
  onStage?: (stage: string) => void,
): Promise<EmbeddedConversionResult> {
  const ranges = locateEmbeddedMotionParts(sourceAnalysis);
  onStage?.('正在提取静态图片…');

  const imageSource = sourceAnalysis.staticFormat === 'JPEG'
    ? new File(
        [source.slice(ranges.imageStart, ranges.imageEnd, 'image/jpeg')],
        `${source.name.replace(/\.[^.]+$/, '')}.jpg`,
        { type: 'image/jpeg', lastModified: source.lastModified },
      )
    : source;
  const image = await normalizeImage(imageSource, onStage);

  onStage?.('正在提取内嵌视频…');
  const video = new File(
    [source.slice(ranges.videoStart, ranges.videoEnd, ranges.videoMime)],
    `${source.name.replace(/\.[^.]+$/, '')}.${ranges.videoExtension}`,
    { type: ranges.videoMime, lastModified: source.lastModified },
  );
  const normalizedVideo = await normalizeVideo(video, onStage);

  onStage?.('正在写入三星 Motion Photo 元数据…');
  const sourceTimestamp = sourceAnalysis.presentationTimestampUs;
  const timestampUs = sourceTimestamp !== null
    ? sourceTimestamp
    : sourceAnalysis.durationSeconds
      ? Math.round(sourceAnalysis.durationSeconds * 500_000)
      : -1;
  const name = outputName(source.name);
  const result = await muxFiles(image, normalizedVideo, name, timestampUs);
  if (!result.analysis.validation.isSamsungCompatible) throw new Error('生成结果未通过 Samsung Motion Photo 结构校验。');
  return { blob: result.blob, name, analysis: result.analysis };
}
