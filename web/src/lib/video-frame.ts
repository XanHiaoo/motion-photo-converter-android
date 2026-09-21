export function clampFrameTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(seconds, 0), Math.max(0, duration - 0.05));
}

export function formatFrameTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function waitForFrame(video: HTMLVideoElement, seconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('视频缩略图生成已取消。'));
  const ready = () => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.seeking && Math.abs(video.currentTime - seconds) < 0.08;
  if (ready()) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('等待视频画面超时，请尝试其他时间点或使用浏览器支持的 MP4。')), 12000);
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      video.removeEventListener('seeked', check);
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('error', fail);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const check = () => { if (ready()) finish(); };
    const fail = () => finish(new Error('浏览器无法解码此视频，无法提取封面。'));
    const abort = () => finish(new Error('视频缩略图生成已取消。'));
    video.addEventListener('seeked', check);
    video.addEventListener('loadeddata', check);
    video.addEventListener('error', fail);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try {
      if (Math.abs(video.currentTime - seconds) >= 0.08) video.currentTime = seconds;
      check();
    } catch {
      finish(new Error('无法定位到选定的视频画面。'));
    }
  });
}

export async function createTimelineThumbnails(url: string, duration: number, signal: AbortSignal): Promise<string[]> {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const canvas = document.createElement('canvas');
  canvas.width = 112;
  canvas.height = 68;
  const context = canvas.getContext('2d');
  if (!context) return [];
  const video = document.createElement('video');
  video.src = url;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  const frames: string[] = [];
  try {
    for (let index = 0; index < 6 && !signal.aborted; index += 1) {
      const time = clampFrameTime(index / 5 * duration, duration);
      try {
        await waitForFrame(video, time, signal);
      } catch {
        break;
      }
      if (!video.videoWidth || !video.videoHeight) break;
      const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      frames.push(canvas.toDataURL('image/jpeg', 0.66));
    }
  } finally {
    video.removeAttribute('src');
    video.load();
  }
  return frames;
}

export async function captureVideoFrame(video: HTMLVideoElement, sourceName: string, seconds: number): Promise<File> {
  const time = clampFrameTime(seconds, video.duration);
  video.pause();
  await waitForFrame(video, time);
  if (!video.videoWidth || !video.videoHeight) throw new Error('视频画面尺寸无效，无法生成封面。');

  const scale = Math.min(1, 4096 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建图片画布。');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('视频画面保存为 JPEG 失败。')), 'image/jpeg', 0.95);
  });
  return new File([blob], `${sourceName.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
}
