export const MIN_CLIP_SECONDS = 0.2;
export type TrimMode = 'fast' | 'precise';

export function clampClipStart(seconds: number, end: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const minimum = Math.min(MIN_CLIP_SECONDS, duration);
  return Math.min(Math.max(Number.isFinite(seconds) ? seconds : 0, 0), Math.max(0, end - minimum));
}

export function clampClipEnd(seconds: number, start: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const minimum = Math.min(MIN_CLIP_SECONDS, duration);
  return Math.max(Math.min(Number.isFinite(seconds) ? seconds : duration, duration), Math.min(duration, start + minimum));
}

export function clampCoverTime(seconds: number, start: number, end: number): number {
  const lastFrame = Math.max(start, end - 0.05);
  return Math.min(Math.max(Number.isFinite(seconds) ? seconds : start, start), lastFrame);
}

export function isClipTrimmed(start: number, end: number, duration: number): boolean {
  return start > 0.005 || end < duration - 0.005;
}

export function positionToClipTime(clientX: number, left: number, width: number, duration: number): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(width) || width <= 0 || !Number.isFinite(duration) || duration <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  if (ratio === 1) return duration;
  return Math.min(duration, Math.round(ratio * duration * 20) / 20);
}

export function formatClipTime(seconds: number): string {
  const safe = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) * 10));
  const minutes = Math.floor(safe / 600);
  const remaining = Math.floor((safe % 600) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}.${safe % 10}`;
}

export function coverOffsetInClip(selectedTime: number, start: number, end: number, actualDuration: number, mode: TrimMode): number {
  const preroll = mode === 'fast' ? Math.max(0, actualDuration - (end - start)) : 0;
  return Math.max(0, Math.min(selectedTime - start + preroll, Math.max(0, actualDuration - 0.05)));
}

export function trimArguments(inputName: string, outputName: string, start: number, end: number, mode: TrimMode): string[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < MIN_CLIP_SECONDS - 0.001) {
    throw new Error('截取范围无效，请至少保留 0.2 秒视频。');
  }
  const common = [
    ...(start > 0.005 ? ['-ss', start.toFixed(3)] : []),
    '-i', inputName, '-t', (end - start).toFixed(3),
    '-map', '0:v:0', '-map', '0:a?',
  ];
  if (mode === 'fast') {
    return [...common, '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', outputName];
  }
  return [
    ...common,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-threads', '1',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputName,
  ];
}
