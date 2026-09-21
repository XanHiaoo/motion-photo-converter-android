import { normalizedStem } from './binary';
import type { PairCandidate } from './types';

const IMAGE_EXT = /\.(?:jpe?g|heic|heif|png)$/i;
const VIDEO_EXT = /\.(?:mp4|mov)$/i;

export function pairFiles(files: File[]): PairCandidate[] {
  const images = files.filter((file) => IMAGE_EXT.test(file.name) || file.type.startsWith('image/'));
  const videos = files.filter((file) => VIDEO_EXT.test(file.name) || file.type.startsWith('video/'));
  const available = new Set(videos);
  return images.map((image, index) => {
    const stem = normalizedStem(image.name);
    const byName = videos.find((video) => available.has(video) && normalizedStem(video.name) === stem) ?? null;
    const sole = byName ?? (images.length === 1 && available.size === 1 ? [...available][0] : null);
    if (sole) available.delete(sole);
    return {
      id: `${image.name}-${image.size}-${index}`,
      image,
      video: sole,
      match: byName ? 'filename' : sole ? 'manual' : 'none',
    };
  });
}

export function isSupportedSelection(file: File): boolean {
  return IMAGE_EXT.test(file.name) || VIDEO_EXT.test(file.name);
}
