import { trimArguments, type TrimMode } from './video-trim';

let ffmpegPromise: Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null = null;

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
  onStage?.('正在加载 MOV 转封装组件（首次约 31 MB）…');
  const ffmpeg = await loadFfmpeg();
  const inputName = `input-${Date.now()}.mov`;
  const outputName = `output-${Date.now()}.mp4`;
  try {
    onStage?.('正在将 MOV 无损转封装为 MP4…');
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    const exitCode = await ffmpeg.exec(['-i', inputName, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', outputName]);
    if (exitCode !== 0) throw new Error(`FFmpeg 返回错误码 ${exitCode}`);
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === 'string') throw new Error('未生成有效的 MP4 数据。');
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    return new File([bytes.buffer], `${file.name.replace(/\.mov$/i, '')}.mp4`, { type: 'video/mp4', lastModified: file.lastModified });
  } catch (error) {
    throw new Error(`MOV 无损转封装失败。视频编码可能不兼容，请先转换为 H.264 MP4。${error instanceof Error ? `（${error.message}）` : ''}`);
  } finally {
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
  }
}

export async function trimVideo(file: File, start: number, end: number, mode: TrimMode, onStage?: (stage: string, progress?: number) => void): Promise<File> {
  onStage?.('正在加载视频裁剪组件…');
  const ffmpeg = await loadFfmpeg();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputName = `clip-input-${id}.mp4`;
  const outputName = `clip-output-${id}.mp4`;
  try {
    const args = trimArguments(inputName, outputName, start, end, mode);
    onStage?.('正在读取视频文件…');
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    const stage = mode === 'fast' ? '正在快速截取片段（不重新编码）…' : '正在精确裁剪并编码为 H.264 MP4…';
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
    onStage?.('正在整理裁剪结果…');
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === 'string' || data.byteLength === 0) throw new Error('未生成有效的视频片段。');
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    return new File([bytes.buffer], `${file.name.replace(/\.[^.]+$/, '')}-clip.mp4`, { type: 'video/mp4', lastModified: file.lastModified });
  } catch (error) {
    const advice = mode === 'fast' ? '快速裁剪失败，可切换为“精确裁剪”重试。' : '精确裁剪失败，请缩短片段或改用 H.264 MP4。';
    throw new Error(`${advice}${error instanceof Error ? `（${error.message}）` : ''}`);
  } finally {
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
  }
}
