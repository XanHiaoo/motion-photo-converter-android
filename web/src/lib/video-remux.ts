import { trimArguments, type TrimMode } from './video-trim';
import { captureVideoEndFrame } from './video-frame';
import { tryHardwareFadeTail } from './android-fade';
import { detectCodec } from '../core/mp4';
import { ascii, readBe32 } from '../core/binary';

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

export async function fadeCodec(file: File): Promise<string | null> {
  let offset = 0;
  while (offset + 8 <= file.size) {
    const header = new Uint8Array(await file.slice(offset, offset + 16).arrayBuffer());
    const type = ascii(header, 4, 4);
    let size = readBe32(header, 0);
    if (size === 1) {
      if (header.length < 16) return null;
      size = new DataView(header.buffer).getUint32(8, false) * 2 ** 32
        + new DataView(header.buffer).getUint32(12, false);
    } else if (size === 0) {
      size = file.size - offset;
    }
    if (!Number.isSafeInteger(size) || size < 8 || offset + size > file.size) return null;
    if (type === 'moov') {
      const moov = new Uint8Array(await file.slice(offset, offset + Math.min(size, 4 * 1024 * 1024)).arrayBuffer());
      return detectCodec(moov, 0, moov.length);
    }
    offset += size;
  }
  return null;
}

class HardwareFadeError extends Error {
  constructor(message: string, readonly mime: string) { super(message); }
}

async function addCoverFadeTail(
  file: File, cover: File, duration: number, width: number, height: number,
  fadeDuration: number, onStage?: (stage: string, progress?: number) => void,
  hardware = true,
): Promise<File> {
  const codec = await fadeCodec(file);
  if (!codec?.includes('H.264') && !codec?.includes('H.265')) throw new Error('暂不支持该视频编码的快速渐变。');
  onStage?.('正在提取视频末帧…');
  const lastFrame = await captureVideoEndFrame(file, duration);
  const mime = codec.includes('H.265') ? 'video/hevc' : 'video/avc';
  if (hardware && window.AndroidBridge?.beginFadeTail) onStage?.('正在尝试安卓硬件编码渐变尾段…');
  let nativeTail: File | null = null;
  if (hardware) {
    try {
      nativeTail = await tryHardwareFadeTail(lastFrame, cover, width, height, fadeDuration, mime);
    } catch {
      // A device may advertise a codec but fail to encode this size. Use the web fallback.
    }
  }
  if (!nativeTail && mime !== 'video/avc') throw new Error('该 H.265 视频没有可用的安卓硬件编码器。');

  const ffmpeg = await loadFfmpeg();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputName = `fast-fade-input-${id}.mp4`;
  const lastName = `fast-fade-last-${id}.jpg`;
  const coverName = `fast-fade-cover-${id}.jpg`;
  const tailName = `fast-fade-tail-${id}.mp4`;
  const bodyName = `fast-fade-body-${id}.mp4`;
  const listName = `fast-fade-list-${id}.txt`;
  const outputName = `fast-fade-output-${id}.mp4`;
  const files = [inputName, lastName, coverName, tailName, bodyName, listName, outputName];
  try {
    onStage?.('正在读取视频…');
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    if (nativeTail) {
      onStage?.('已使用安卓硬件编码渐变尾段');
      await ffmpeg.writeFile(tailName, new Uint8Array(await nativeTail.arrayBuffer()));
    } else {
      onStage?.('正在编码短渐变尾段…', 0);
      await Promise.all([
        ffmpeg.writeFile(lastName, new Uint8Array(await lastFrame.arrayBuffer())),
        ffmpeg.writeFile(coverName, new Uint8Array(await cover.arrayBuffer())),
      ]);
      const frames = Math.max(2, Math.ceil(fadeDuration * 30));
      const filter = [
        `[0:v]scale=${Math.round(width)}:${Math.round(height)},setsar=1,format=rgba[base]`,
        `[1:v]scale=${Math.round(width)}:${Math.round(height)},setsar=1,format=rgba,fade=t=in:st=0:d=${fadeDuration.toFixed(3)}:alpha=1[cover]`,
        '[base][cover]overlay=shortest=1:format=auto,format=yuv420p[outv]',
      ].join(';');
      const exit = await ffmpeg.exec([
        '-loop', '1', '-framerate', '30', '-i', lastName,
        '-loop', '1', '-framerate', '30', '-i', coverName,
        '-filter_complex', filter, '-map', '[outv]', '-frames:v', String(frames), '-an',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', tailName,
      ]);
      if (exit !== 0) throw new Error(`尾段编码失败（${exit}）`);
    }
    onStage?.('正在无损拼接视频主体与渐变尾段…');
    const bodyExit = await ffmpeg.exec(['-i', inputName, '-map', '0:v:0', '-c:v', 'copy', '-an', bodyName]);
    if (bodyExit !== 0) throw new Error(`视频主体提取失败（${bodyExit}）`);
    await ffmpeg.writeFile(listName, new TextEncoder().encode(
      `ffconcat version 1.0\nfile '${bodyName}'\nfile '${tailName}'\n`,
    ));
    const concatExit = await ffmpeg.exec([
      '-f', 'concat', '-safe', '0', '-i', listName, '-i', inputName,
      '-map', '0:v:0', '-map', '1:a?', '-c', 'copy', '-movflags', '+faststart', outputName,
    ]);
    if (concatExit !== 0) throw new Error(`渐变拼接失败（${concatExit}）`);
    if (nativeTail) {
      onStage?.('正在校验硬件编码尾段…');
      const verifyExit = await ffmpeg.exec([
        '-v', 'error', '-xerror', '-sseof', '-0.15', '-i', outputName,
        '-frames:v', '1', '-f', 'null', '-',
      ]);
      if (verifyExit !== 0) throw new Error('硬件编码尾段与原视频不兼容。');
    }
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === 'string' || data.byteLength === 0) throw new Error('渐变视频为空。');
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    return new File([bytes.buffer], `${file.name.replace(/\.[^.]+$/, '')}-fade.mp4`, { type: 'video/mp4', lastModified: file.lastModified });
  } catch (error) {
    if (nativeTail) throw new HardwareFadeError(error instanceof Error ? error.message : String(error), mime);
    throw error;
  } finally {
    await Promise.allSettled(files.map((name) => ffmpeg.deleteFile(name)));
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

  try {
    return await addCoverFadeTail(file, cover, safeDuration, width, height, fadeDuration, onStage);
  } catch (error) {
    if (error instanceof HardwareFadeError && error.mime === 'video/avc') {
      onStage?.('硬件尾段不兼容，正在改用短尾段软件编码…');
      try {
        return await addCoverFadeTail(file, cover, safeDuration, width, height, fadeDuration, onStage, false);
      } catch (retryError) {
        error = retryError;
      }
    }
    const reason = error instanceof Error ? error.message : String(error);
    onStage?.(`快速渐变不可用（${reason}），正在使用兼容模式…`);
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
