import { trimArguments, type TrimMode } from './video-trim';

let ffmpegPromise: Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null = null;

export const DEFAULT_COVER_FADE_SECONDS = 1.2;
export const MIN_COVER_FADE_SECONDS = 0.2;
export const MAX_COVER_FADE_SECONDS = 3;

function isMov(file: File): boolean {
  return /\.mov$/i.test(file.name) || file.type === 'video/quicktime';
}

async function loadFfmpeg(): Promise<import('@ffmpeg/ffmpeg').FFmpeg> {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')]);
    const ffmpeg = new FFmpeg();
    const coreBase = `${import.meta.env.BASE_URL}ffmpeg`;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    return ffmpeg;
  })();
  try {
    return await ffmpegPromise;
  } catch (error) {
    ffmpegPromise = null;
    throw error;
  }
}

export async function normalizeVideo(file: File, onStage?: (stage: string) => void): Promise<File> {
  if (!isMov(file)) return file;
  onStage?.('正在准备 MOV 转换…');
  const ffmpeg = await loadFfmpeg();
  const inputName = `input-${Date.now()}.mov`;
  const outputName = `output-${Date.now()}.mp4`;
  try {
    onStage?.('正在将 MOV 转为 MP4…');
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    const exitCode = await ffmpeg.exec(['-i', inputName, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', outputName]);
    if (exitCode !== 0) throw new Error(`FFmpeg 返回错误码 ${exitCode}`);
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === 'string') throw new Error('未生成有效的 MP4 数据。');
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    return new File([bytes.buffer], `${file.name.replace(/\.mov$/i, '')}.mp4`, { type: 'video/mp4', lastModified: file.lastModified });
  } catch (error) {
    throw new Error(`MOV 转换失败，请使用 H.264 MP4。${error instanceof Error ? `（${error.message}）` : ''}`);
  } finally {
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
  }
}

export async function trimVideo(file: File, start: number, end: number, mode: TrimMode, onStage?: (stage: string, progress?: number) => void): Promise<File> {
  onStage?.('正在准备裁剪…');
  const ffmpeg = await loadFfmpeg();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputName = `clip-input-${id}.mp4`;
  const outputName = `clip-output-${id}.mp4`;
  try {
    const args = trimArguments(inputName, outputName, start, end, mode);
    onStage?.('正在读取视频…');
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    const stage = mode === 'fast' ? '正在快速裁剪…' : '正在精确裁剪并编码 H.264…';
    onStage?.(stage, 0);
    let lastPercent = -2;
    const reportProgress = ({ time }: { time: number }) => {
      if (!Number.isFinite(time) || time < 0) return;
      const percent = Math.min(99, Math.floor(time / 10_000 / (end - start)));
      if (percent >= lastPercent + 2) {
        lastPercent = percent;
        onStage?.(stage, percent / 100);
      }
    };
    ffmpeg.on('progress', reportProgress);
    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec(args);
    } finally {
      ffmpeg.off('progress', reportProgress);
    }
    if (exitCode !== 0) throw new Error(`FFmpeg 返回错误码 ${exitCode}`);
    onStage?.('正在整理结果…');
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === 'string' || data.byteLength === 0) throw new Error('未生成有效的视频片段。');
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    return new File([bytes.buffer], `${file.name.replace(/\.[^.]+$/, '')}-clip.mp4`, { type: 'video/mp4', lastModified: file.lastModified });
  } catch (error) {
    const advice = mode === 'fast' ? '快速裁剪失败，请重试精确裁剪。' : '精确裁剪失败，请缩短片段或使用 H.264 MP4。';
    throw new Error(`${advice}${error instanceof Error ? `（${error.message}）` : ''}`);
  } finally {
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
  }
}

export async function addCoverFade(
  file: File,
  cover: File,
  duration: number,
  width: number,
  height: number,
  requestedFadeSeconds: number,
  onStage?: (stage: string, progress?: number) => void,
): Promise<File> {
  const safeDuration = Math.max(0.2, duration);
  const requestedFadeDuration = Number.isFinite(requestedFadeSeconds) ? requestedFadeSeconds : DEFAULT_COVER_FADE_SECONDS;
  const fadeDuration = Math.min(Math.max(0.1, requestedFadeDuration), Math.max(0.1, safeDuration / 2));
  const totalDuration = safeDuration + fadeDuration;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new Error('无法读取视频尺寸，无法制作封面渐变。');
  }

  onStage?.('正在准备封面渐变…');
  const ffmpeg = await loadFfmpeg();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputName = `fade-input-${id}.mp4`;
  const coverName = `fade-cover-${id}.jpg`;
  const outputName = `fade-output-${id}.mp4`;
  const videoDuration = safeDuration.toFixed(3);
  const transitionDuration = fadeDuration.toFixed(3);
  const outputDuration = totalDuration.toFixed(3);
  const filter = [
    `[0:v]fps=30,scale=${Math.round(width)}:${Math.round(height)},setsar=1,format=yuv420p,trim=duration=${videoDuration},setpts=PTS-STARTPTS[main]`,
    `[main]tpad=stop_mode=clone:stop_duration=${transitionDuration}[base]`,
    `[1:v]fps=30,scale=${Math.round(width)}:${Math.round(height)},setsar=1,format=rgba,trim=duration=${transitionDuration},fade=t=in:st=0:d=${transitionDuration}:alpha=1,setpts=PTS-STARTPTS+${videoDuration}/TB[cover]`,
    `[base][cover]overlay=x=0:y=0:eof_action=pass:format=auto[outv]`,
  ].join(';');

  try {
    await Promise.all([
      ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer())),
      ffmpeg.writeFile(coverName, new Uint8Array(await cover.arrayBuffer())),
    ]);
    const stage = '正在编码封面渐变…';
    onStage?.(stage, 0);
    let lastPercent = -2;
    const reportProgress = ({ time }: { time: number }) => {
      if (!Number.isFinite(time) || time < 0) return;
      const percent = Math.min(99, Math.floor(time / 10_000 / totalDuration));
      if (percent >= lastPercent + 2) {
        lastPercent = percent;
        onStage?.(stage, percent / 100);
      }
    };
    ffmpeg.on('progress', reportProgress);
    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec([
        '-i', inputName,
        '-loop', '1', '-framerate', '30', '-i', coverName,
        '-filter_complex', filter,
        '-map', '[outv]', '-map', '0:a?', '-t', outputDuration,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputName,
      ]);
    } finally {
      ffmpeg.off('progress', reportProgress);
    }
    if (exitCode !== 0) throw new Error(`FFmpeg 返回错误码 ${exitCode}`);
    onStage?.('正在整理渐变视频…');
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === 'string' || data.byteLength === 0) throw new Error('未生成有效的渐变视频。');
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    return new File([bytes.buffer], `${file.name.replace(/\.[^.]+$/, '')}-fade.mp4`, { type: 'video/mp4', lastModified: file.lastModified });
  } catch (error) {
    throw new Error(`封面渐变生成失败，请关闭该选项或使用 H.264 MP4。${error instanceof Error ? `（${error.message}）` : ''}`);
  } finally {
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(coverName), ffmpeg.deleteFile(outputName)]);
  }
}
