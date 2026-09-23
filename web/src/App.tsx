import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Download,
  FileImage,
  Film,
  Images,
  LoaderCircle,
  Plus,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';

import { formatBytes, locateEmbeddedMotionParts, outputName, type MediaAnalysis } from './core';
import { convertEmbeddedMotionFile } from './lib/embedded-convert';
import { normalizeImage, resizeImageToSize } from './lib/image-normalize';
import { captureVideoFrame, createTimelineThumbnails } from './lib/video-frame';
import { addCoverFade, MAX_COVER_FADE_SECONDS, MIN_COVER_FADE_SECONDS, normalizeVideo, trimVideo } from './lib/video-remux';
import { readVideoDimensions } from './lib/video-metadata';
import { clampClipEnd, clampClipStart, clampCoverTime, CLIP_TIME_STEP, coverOffsetInClip, formatClipTime, isClipTrimmed, MIN_CLIP_SECONDS, snapClipTime, type TrimMode } from './lib/video-trim';
import { analyzeFile, muxFiles } from './lib/worker-client';

type View = 'home' | 'embedded' | 'manual' | 'video';
type Status = 'idle' | 'analyzing' | 'ready' | 'working' | 'success' | 'already' | 'error';

interface MotionTask {
  id: string;
  file: File;
  previewUrl: string;
  analysis: MediaAnalysis | null;
  status: Status;
  stage: string;
  error: string | null;
  output: { url: string; blob: Blob; name: string } | null;
}

const IMAGE_ACCEPT = '.jpg,.jpeg,.heic,.heif,.png,image/jpeg,image/heic,image/heif,image/png';
const MOTION_ACCEPT = '.jpg,.jpeg,.heic,.heif,image/jpeg,image/heic,image/heif';
const VIDEO_ACCEPT = '.mp4,.mov,video/mp4,video/quicktime';
const DEFAULT_UI_COVER_FADE_SECONDS = 0.5;

function download(url: string, name: string) {
  if (window.AndroidBridge) {
    void saveInAndroid(url, name).catch((error) => {
      window.alert(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    });
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function saveInAndroid(url: string, name: string): Promise<void> {
  const bridge = window.AndroidBridge;
  if (!bridge) throw new Error('安卓保存通道不可用。');
  const response = await fetch(url);
  if (!response.ok) throw new Error('无法读取待保存的图片。');
  const blob = await response.blob();
  const token = bridge.beginSave(name);
  if (!token) throw new Error('无法在系统相册中创建图片。');
  try {
    const chunkSize = 128 * 1024;
    for (let start = 0; start < blob.size; start += chunkSize) {
      const chunk = blob.slice(start, start + chunkSize);
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
        reader.onerror = () => reject(new Error('读取图片数据失败。'));
        reader.readAsDataURL(chunk);
      });
      if (!bridge.appendChunk(token, base64)) throw new Error('写入图片数据失败。');
    }
    if (!bridge.finishSave(token)) throw new Error('完成图片保存失败。');
  } catch (error) {
    bridge.cancelSave(token);
    throw error;
  }
}

function fileKind(file: File | null): string {
  return file?.name.split('.').pop()?.toUpperCase() ?? '未选择';
}

function ModeHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="mode-header">
      <button className="icon-button" type="button" onClick={onBack} aria-label="返回首页"><ArrowLeft size={21} /></button>
      <strong>{title}</strong>
    </header>
  );
}

function SchemeAIcon({ name }: { name: 'photos' | 'film' | 'stack' | 'combine' | 'arrow' | 'chevron' | 'lock' }) {
  const shapes = {
    photos: <><rect x="7" y="3" width="14" height="14" rx="3" /><path d="M4 8H3a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2h11a1 1 0 0 0 1-1v-1M8 14l4-4 3 3 3-5 3 4" /><path d="M11 7h.01" /></>,
    film: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18" /></>,
    stack: <><rect x="7" y="3" width="14" height="14" rx="3" /><path d="M3 8v11a2 2 0 0 0 2 2h11M12 7l5 3-5 3Z" /></>,
    combine: <><rect x="2" y="3" width="9" height="13" rx="2" /><rect x="13" y="8" width="9" height="13" rx="2" /><path d="M4 12l2-3 3 3M17 12v5m-2-2.5h4" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    lock: <><rect x="6" y="10" width="12" height="10" rx="3" /><path d="M9 10V7a3 3 0 0 1 6 0v3m-3 4v2" /></>,
  }[name];
  return <svg className="scheme-a-icon" viewBox="0 0 24 24" aria-hidden="true">{shapes}</svg>;
}

function PrivacyNote() {
  return <div className="privacy-note"><SchemeAIcon name="lock" /><span>仅在本机处理，不会上传</span></div>;
}

function CoverFadeOptions({ enabled, seconds, disabled, onEnabledChange, onSecondsChange }: {
  enabled: boolean;
  seconds: number;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onSecondsChange: (seconds: number) => void;
}) {
  return (
    <div className="cover-fade-options">
      <label className="preview-option">
        <input type="checkbox" checked={enabled} disabled={disabled} onChange={(event) => onEnabledChange(event.currentTarget.checked)} />
        <span><strong>结束时渐变回封面</strong><small>优先仅编码结尾过渡，安卓设备会尝试硬件加速</small></span>
      </label>
      {enabled ? (
        <label className="preview-duration-option">
          <span className="preview-duration-heading"><strong>渐变时长</strong><output>{seconds.toFixed(1)} 秒</output></span>
          <input type="range" min={MIN_COVER_FADE_SECONDS} max={MAX_COVER_FADE_SECONDS} step="0.1" value={seconds} disabled={disabled} onChange={(event) => onSecondsChange(Number(event.currentTarget.value))} />
          <small>时长越长越明显；视频过短时会自动缩短。</small>
        </label>
      ) : null}
    </div>
  );
}

function MotionFileMode({ onBack }: { onBack: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tasksRef = useRef<MotionTask[]>([]);
  const [tasks, setTasks] = useState<MotionTask[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fadeToCover, setFadeToCover] = useState(true);
  const [coverFadeSeconds, setCoverFadeSeconds] = useState(DEFAULT_UI_COVER_FADE_SECONDS);

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => () => {
    for (const task of tasksRef.current) {
      URL.revokeObjectURL(task.previewUrl);
      if (task.output) URL.revokeObjectURL(task.output.url);
    }
  }, []);

  const updateTask = (id: string, patch: Partial<MotionTask>) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));
  };

  const inspectTask = async (task: MotionTask) => {
    try {
      const report = await analyzeFile(task.file);
      locateEmbeddedMotionParts(report);
      if (report.format === 'Samsung Motion Photo') {
        updateTask(task.id, { analysis: report, status: 'already', stage: '已是 Samsung Motion Photo' });
      } else {
        updateTask(task.id, { analysis: report, status: 'ready', stage: '已识别图片和视频' });
      }
    } catch (caught) {
      updateTask(task.id, {
        status: 'error',
        stage: '无法解析',
        error: `${caught instanceof Error ? caught.message : String(caught)} 可改用“照片 + 视频”。`,
      });
    }
  };

  const addFiles = (files: File[]) => {
    const next = files.map<MotionTask>((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      analysis: null,
      status: 'analyzing',
      stage: '正在分析文件…',
      error: null,
      output: null,
    }));
    if (!next.length) return;
    setTasks((current) => [...current, ...next]);
    void (async () => {
      for (const task of next) await inspectTask(task);
    })();
  };

  const convertTask = async (task: MotionTask) => {
    if (!task.analysis || task.analysis.format === 'Samsung Motion Photo') return;
    updateTask(task.id, { status: 'working', stage: '正在准备…', error: null });
    try {
      const output = await convertEmbeddedMotionFile(task.file, task.analysis, (stage) => updateTask(task.id, { stage }), { fadeToCover, coverFadeSeconds });
      const url = URL.createObjectURL(output.blob);
      updateTask(task.id, { output: { url, blob: output.blob, name: output.name }, status: 'success', stage: '转换完成' });
    } catch (caught) {
      updateTask(task.id, { status: 'error', stage: '转换失败', error: caught instanceof Error ? caught.message : String(caught) });
    }
  };

  const convertAll = async () => {
    const convertible = tasksRef.current.filter((task) => task.analysis && task.analysis.format !== 'Samsung Motion Photo' && (task.status === 'ready' || task.status === 'error'));
    for (const task of convertible) await convertTask(task);
  };

  const clearTasks = () => {
    for (const task of tasks) {
      URL.revokeObjectURL(task.previewUrl);
      if (task.output) URL.revokeObjectURL(task.output.url);
    }
    setTasks([]);
  };

  const busy = tasks.some((task) => task.status === 'analyzing' || task.status === 'working');
  const readyCount = tasks.filter((task) => task.status === 'ready' || (task.status === 'error' && task.analysis)).length;
  const completedCount = tasks.filter((task) => task.status === 'success' || task.status === 'already').length;
  const failedCount = tasks.filter((task) => task.status === 'error').length;

  const statusIcon = (task: MotionTask) => {
    if (task.status === 'analyzing' || task.status === 'working') return <LoaderCircle size={12} className="spin" />;
    if (task.status === 'success' || task.status === 'ready') return <Check size={12} />;
    if (task.status === 'already') return <ShieldCheck size={12} />;
    if (task.status === 'error') return <CircleAlert size={12} />;
    return null;
  };

  return (
    <main className="screen-shell">
      <ModeHeader title="批量导入动态图" onBack={onBack} />
      <PrivacyNote />
      <section className="section-heading">
        <p>解析图片和内嵌视频，批量转换为 Samsung Motion Photo。</p>
      </section>

      <button
        className={`upload-zone ${tasks.length ? 'is-compact' : ''} ${dragging ? 'is-dragging' : ''}`}
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (!busy) addFiles([...event.dataTransfer.files]); }}
      >
        <span className="upload-icon"><Upload size={25} /></span>
        <strong>{tasks.length ? '继续添加文件' : '选择动态图文件'}</strong>
        <small>可多选 · JPG / JPEG / HEIC</small>
      </button>
      <input ref={inputRef} className="visually-hidden" type="file" multiple accept={MOTION_ACCEPT} onChange={(event) => { addFiles([...(event.currentTarget.files ?? [])]); event.currentTarget.value = ''; }} />
      <div className="format-hint"><ScanSearch size={17} /><span>文件需同时包含图片和 MP4 / MOV 视频。</span></div>
      <CoverFadeOptions enabled={fadeToCover} seconds={coverFadeSeconds} disabled={busy} onEnabledChange={setFadeToCover} onSecondsChange={setCoverFadeSeconds} />

      {tasks.length ? (
        <section className="task-section">
          <div className="task-title-row">
            <div><span>转换队列</span><strong>{tasks.length} 个文件</strong></div>
            <button type="button" onClick={clearTasks} disabled={busy}><RefreshCw size={15} />清空列表</button>
          </div>
          <div className="task-list">
            {tasks.map((task) => (
              <article className="task-card" key={task.id}>
                <div className="thumb"><img src={task.previewUrl} alt="动态图缩略图" onError={(event) => { event.currentTarget.style.display = 'none'; }} /><FileImage size={21} /></div>
                <div className="task-copy">
                  <strong>{task.file.name}</strong>
                  <span>{formatBytes(task.file.size)}{task.analysis ? ` · ${task.analysis.staticFormat} + ${task.analysis.videoFormat ?? 'MP4'}` : ''}</span>
                  <span className={`status status-${task.status}`}>{statusIcon(task)}{task.stage}</span>
                  {task.error ? <small className="task-error">{task.error}</small> : null}
                </div>
                <div className="task-action">
                  {(task.status === 'ready' || (task.status === 'error' && task.analysis)) ? <button type="button" disabled={busy} onClick={() => void convertTask(task)}>转换</button> : null}
                  {task.status === 'success' && task.output ? <button type="button" onClick={() => download(task.output!.url, task.output!.name)} aria-label={`保存 ${task.output.name}`}><Download size={18} /></button> : null}
                  {task.status === 'already' ? <button type="button" onClick={() => download(task.previewUrl, task.file.name)} aria-label={`保存 ${task.file.name}`}><Download size={18} /></button> : null}
                </div>
              </article>
            ))}
          </div>
          <div className="summary-line"><span>{completedCount} 个已完成</span><span>{failedCount ? `${failedCount} 个待处理` : '按顺序处理'}</span></div>
        </section>
      ) : null}

      {(readyCount > 0 || busy) ? (
        <div className="bottom-action"><button className="primary-button" type="button" disabled={!readyCount || busy} onClick={() => void convertAll()}>{busy ? <LoaderCircle className="spin" /> : <Images />}{busy ? '正在转换…' : `全部转换（${readyCount}）`}</button></div>
      ) : null}
    </main>
  );
}

function FilePicker({ kind, file, accept, icon, onChange }: { kind: string; file: File | null; accept: string; icon: 'image' | 'video'; onChange: (file: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={`file-picker ${file ? 'has-file' : ''}`} type="button" onClick={() => ref.current?.click()}>
        <span>{icon === 'image' ? <FileImage size={25} /> : <Film size={25} />}</span>
        <div><strong>{file ? file.name : `选择${kind}`}</strong><small>{file ? `${fileKind(file)} · ${formatBytes(file.size)}` : icon === 'image' ? 'JPG / HEIC / PNG' : 'MP4 / MOV'}</small></div>
        {file ? <Check size={20} /> : <Plus size={20} />}
      </button>
      <input ref={ref} className="visually-hidden" type="file" accept={accept} onChange={(event) => { const selected = event.currentTarget.files?.[0]; if (selected) onChange(selected); event.currentTarget.value = ''; }} />
    </>
  );
}

function ManualMode({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [image, setImage] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [playableVideo, setPlayableVideo] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(0);
  const [trimMode, setTrimMode] = useState<TrimMode>('fast');
  const [timelineFrames, setTimelineFrames] = useState<string[]>([]);
  const [timelineViewport, setTimelineViewport] = useState<TimelineViewport>({ start: 0, end: 0 });
  const [frameReady, setFrameReady] = useState(false);
  const [firstFramePreviewUrl, setFirstFramePreviewUrl] = useState<string | null>(null);
  const [showFirstFramePreview, setShowFirstFramePreview] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [fitImageToVideo, setFitImageToVideo] = useState(false);
  const [fadeToCover, setFadeToCover] = useState(true);
  const [coverFadeSeconds, setCoverFadeSeconds] = useState(DEFAULT_UI_COVER_FADE_SECONDS);
  const [status, setStatus] = useState<Status>('idle');
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; name: string; note: string | null } | null>(null);
  const videoUrl = useMemo(() => playableVideo ? URL.createObjectURL(playableVideo) : null, [playableVideo]);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => () => { if (firstFramePreviewUrl) URL.revokeObjectURL(firstFramePreviewUrl); }, [firstFramePreviewUrl]);
  useEffect(() => {
    if (!videoUrl || !frameReady || !videoRef.current) {
      setFirstFramePreviewUrl(null);
      return;
    }
    let cancelled = false;
    let generatedUrl: string | null = null;
    void captureVideoFrame(videoRef.current, 'first-frame.mp4', 0)
      .then((image) => {
        generatedUrl = URL.createObjectURL(image);
        if (cancelled) {
          URL.revokeObjectURL(generatedUrl);
          return;
        }
        setFirstFramePreviewUrl(generatedUrl);
        setShowFirstFramePreview(true);
      })
      .catch(() => {
        if (!cancelled) setFirstFramePreviewUrl(null);
      });
    return () => {
      cancelled = true;
      if (generatedUrl) URL.revokeObjectURL(generatedUrl);
    };
  }, [videoUrl, frameReady]);
  useEffect(() => {
    if (!videoUrl || duration <= 0) {
      setTimelineViewport({ start: 0, end: 0 });
      return;
    }
    setTimelineViewport({ start: 0, end: duration });
  }, [videoUrl, duration]);
  useEffect(() => {
    setTimelineFrames([]);
    if (!videoUrl || duration <= 0 || timelineViewport.end <= timelineViewport.start) return;
    const controller = new AbortController();
    const viewportDuration = timelineViewport.end - timelineViewport.start;
    void createTimelineThumbnails(videoUrl, viewportDuration, controller.signal, timelineViewport.start)
      .then((frames) => { if (!controller.signal.aborted) setTimelineFrames(frames); })
      .catch(() => { /* 缩略图只是预览，失败时保留可操作的时间轴。 */ });
    return () => controller.abort();
  }, [videoUrl, duration, timelineViewport.start, timelineViewport.end]);

  const generate = async () => {
    if (!image || !playableVideo || !frameReady || !duration) return;
    setStatus('working');
    setError(null);
    try {
      const normalizedImage = await normalizeImage(image, setStage);
      const trimmed = isClipTrimmed(clipStart, clipEnd, duration);
      const outputVideo = trimmed ? await trimVideo(playableVideo, clipStart, clipEnd, trimMode, setStage) : playableVideo;
      const actualDuration = trimmed ? (await analyzeFile(outputVideo)).durationSeconds ?? clipEnd - clipStart : duration;
      if (trimmed && actualDuration < MIN_CLIP_SECONDS) throw new Error('裁剪结果过短，请扩大片段范围或尝试精确裁剪。');
      let imageForOutput = normalizedImage;
      const dimensions = await readVideoDimensions(outputVideo);
      if (fitImageToVideo) {
        imageForOutput = await resizeImageToSize(normalizedImage, dimensions.width, dimensions.height, setStage);
      }
      const outputVideoAnalysis = trimmed ? await analyzeFile(outputVideo) : null;
      const outputVideoWithFade = fadeToCover
        ? await addCoverFade(outputVideo, imageForOutput, actualDuration, dimensions.width, dimensions.height, coverFadeSeconds, setStage)
        : outputVideo;
      setStage('正在生成 Motion Photo…');
      const timestampUs = Math.round(actualDuration * 500_000);
      const name = outputName(image.name);
      const output = await muxFiles(imageForOutput, outputVideoWithFade, name, timestampUs);
      if (!output.analysis.validation.isSamsungCompatible) throw new Error('生成结果未通过结构校验。');
      const extra = trimmed && trimMode === 'fast' && outputVideoAnalysis?.durationSeconds
        ? Math.max(0, outputVideoAnalysis.durationSeconds - (clipEnd - clipStart))
        : 0;
      const notes: string[] = [];
      if (fadeToCover) notes.push(`已在视频结尾追加 ${formatClipTime(coverFadeSeconds)} 的封面渐变尾段。`);
      if (extra >= 0.15) notes.push(`快速裁剪可能多保留了约 ${formatClipTime(extra)} 的开头画面；如需严格起点，请选择精确裁剪。`);
      setResult({ url: URL.createObjectURL(output.blob), blob: output.blob, name, note: notes.length ? notes.join(' ') : null });
      setStatus('success');
      setStage('转换成功');
    } catch (caught) {
      setStatus('error');
      setStage('转换失败');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const replaceImage = (file: File) => { setImage(file); setResult(null); setStatus('idle'); setError(null); };
  const replaceVideo = async (file: File) => {
    setVideo(file);
    setPlayableVideo(null);
    setDuration(0);
    setClipStart(0);
    setClipEnd(0);
    setTimelineViewport({ start: 0, end: 0 });
    setFrameReady(false);
    setFirstFramePreviewUrl(null);
    setShowFirstFramePreview(false);
    setIsPreviewing(false);
    setResult(null);
    setError(null);
    if (/\.mov$/i.test(file.name) || file.type === 'video/quicktime') {
      setStatus('analyzing');
      try {
        const mp4 = await normalizeVideo(file, setStage);
        setPlayableVideo(mp4);
        setStatus('idle');
        setStage('');
      } catch (caught) {
        setStatus('error');
        setStage('无法准备 MOV 视频');
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } else {
      setPlayableVideo(file);
      setStatus('idle');
      setStage('');
    }
  };

  const seekVideo = (seconds: number) => {
    const element = videoRef.current;
    if (element) {
      element.pause();
      element.currentTime = seconds;
    }
    setShowFirstFramePreview(false);
    setIsPreviewing(false);
    setResult(null);
    setError(null);
    setStatus('idle');
  };

  const selectClipStart = (seconds: number) => {
    const next = clampClipStart(snapClipTime(seconds), clipEnd, duration);
    setClipStart(next);
    seekVideo(next);
  };

  const selectClipEnd = (seconds: number) => {
    const next = clampClipEnd(snapClipTime(seconds), clipStart, duration);
    setClipEnd(next);
    seekVideo(Math.min(videoRef.current?.currentTime ?? next, next));
  };

  const selectTrimMode = (mode: TrimMode) => {
    setTrimMode(mode);
    setResult(null);
    setError(null);
  };

  const previewClip = async () => {
    const element = videoRef.current;
    if (!element || !frameReady) return;
    if (isPreviewing) {
      element.pause();
      setIsPreviewing(false);
      return;
    }
    try {
      setShowFirstFramePreview(false);
      element.currentTime = clipStart;
      await element.play();
      setIsPreviewing(true);
    } catch {
      setError('无法播放预览，但仍可拖动选择片段。');
    }
  };

  const stopPreview = (element: HTMLVideoElement) => {
    element.pause();
    element.currentTime = clipStart;
    setIsPreviewing(false);
  };

  return (
    <main className="screen-shell">
      <ModeHeader title="照片和视频合成动态图" onBack={onBack} />
      <PrivacyNote />
      <section className="section-heading"><p>选择照片作为封面，再截取视频片段合成动态图。</p></section>
      <section className="manual-stack"><FilePicker kind="照片" file={image} accept={IMAGE_ACCEPT} icon="image" onChange={replaceImage} /><div className="connector"><Plus size={15} /></div><FilePicker kind="视频" file={video} accept={VIDEO_ACCEPT} icon="video" onChange={(file) => { void replaceVideo(file); }} /></section>
      <label className="image-size-option">
        <input type="checkbox" checked={fitImageToVideo} onChange={(event) => setFitImageToVideo(event.currentTarget.checked)} disabled={!playableVideo || status === 'working' || status === 'analyzing'} />
        <span className="image-size-option-copy"><strong>{'图片自适应视频尺寸'}</strong><small>{playableVideo ? '生成时按视频宽高调整图片' : '先选择视频后可启用'}</small></span>
      </label>
      {videoUrl ? (
        <section className="frame-card">
          <div className="frame-heading"><strong>选择视频片段</strong><span>{formatClipTime(clipEnd - clipStart)}</span></div>
          <div className="frame-preview-stage">
            <video
              key={videoUrl}
              ref={videoRef}
              className="frame-preview"
              src={videoUrl}
              preload="auto"
              muted
              playsInline
              onLoadedMetadata={(event) => {
                const value = event.currentTarget.duration;
                if (Number.isFinite(value) && value > 0) { setDuration(value); setClipEnd(value); }
                else setError('无法读取视频时长，请选择有效的 MP4 或 MOV。');
              }}
              onLoadedData={() => setFrameReady(true)}
              onPause={() => setIsPreviewing(false)}
              onEnded={(event) => stopPreview(event.currentTarget)}
              onTimeUpdate={(event) => {
                const element = event.currentTarget;
                if (isPreviewing && element.currentTime >= clipEnd - 0.03) stopPreview(element);
              }}
              onError={() => { setFrameReady(false); setError('浏览器无法预览该视频，请使用 H.264 MP4。'); }}
            />
            {firstFramePreviewUrl ? <img className={`frame-initial-preview ${showFirstFramePreview ? 'is-visible' : ''}`} src={firstFramePreviewUrl} alt="视频第一帧预览" aria-hidden="true" /> : null}
          </div>
          {duration > 0 ? (
            <>
              <ClipRangeSelector duration={duration} start={clipStart} end={clipEnd} coverTime={null} frames={timelineFrames} disabled={status === 'working' || status === 'analyzing'} viewport={timelineViewport} onViewportChange={setTimelineViewport} onStartChange={selectClipStart} onEndChange={selectClipEnd} />
              <div className="clip-preview-controls">
                <CoverFadeOptions enabled={fadeToCover} seconds={coverFadeSeconds} disabled={!frameReady || status === 'working' || status === 'analyzing'} onEnabledChange={setFadeToCover} onSecondsChange={setCoverFadeSeconds} />
                <button className="clip-preview-button" type="button" disabled={!frameReady || status === 'working' || status === 'analyzing'} onClick={() => void previewClip()}>{isPreviewing ? '暂停预览' : '预览片段'}</button>
              </div>
              <div className="trim-method" role="group" aria-label="裁剪方式">
                <button type="button" className={trimMode === 'fast' ? 'is-selected' : ''} aria-pressed={trimMode === 'fast'} disabled={status === 'working'} onClick={() => selectTrimMode('fast')}>快速裁剪</button>
                <button type="button" className={trimMode === 'precise' ? 'is-selected' : ''} aria-pressed={trimMode === 'precise'} disabled={status === 'working'} onClick={() => selectTrimMode('precise')}>精确裁剪</button>
              </div>
              <p className="trim-method-note">{trimMode === 'fast' ? '快速：速度快；起点可能略有偏差。' : '精确：重新编码 H.264，边界更准但更慢。'}</p>
            </>
          ) : null}
          <p>照片作为封面；未裁剪时使用完整视频。</p>
        </section>
      ) : null}
      {status === 'analyzing' || status === 'working' ? <div className="progress-card"><LoaderCircle className="spin" /><div><strong>{stage}</strong><span>请保持页面打开</span></div></div> : null}
      {status === 'error' ? <div className="error-card"><CircleAlert /><div><strong>{stage}</strong><span>{error}</span></div></div> : null}
      {result ? <section className="result-card"><div className="success-mark"><Check size={23} /></div><div className="result-copy"><span>转换完成</span><strong>{result.name}</strong><small>{formatBytes(result.blob.size)}</small></div><img src={result.url} alt="结果图片缩略图" />{result.note ? <small className="result-note">{result.note}</small> : null}<button className="primary-button" type="button" onClick={() => download(result.url, result.name)}><Download />保存 Motion Photo</button></section> : null}
      {!result ? <div className="bottom-action"><button className="primary-button" type="button" disabled={!image || !playableVideo || !frameReady || !duration || status === 'working' || status === 'analyzing'} onClick={() => void generate()}>{status === 'working' ? <LoaderCircle className="spin" /> : <Plus />}{status === 'working' ? '正在生成…' : '生成 Motion Photo'}</button></div> : null}
    </main>
  );
}

type TimelineViewport = { start: number; end: number };

function viewportForSelection(start: number, end: number, duration: number): TimelineViewport {
  if (duration <= 0 || end - start >= duration - 0.05) return { start: 0, end: duration };
  const context = Math.min(Math.max(1.5, (end - start) * 0.45), Math.max(1.5, duration * 0.16));
  return {
    start: Math.max(0, start - context),
    end: Math.min(duration, end + context),
  };
}

function ClipRangeSelector({ duration, start, end, coverTime, frames, disabled, viewport, onViewportChange, onStartChange, onEndChange }: {
  duration: number;
  start: number;
  end: number;
  coverTime: number | null;
  frames: string[];
  disabled: boolean;
  viewport: TimelineViewport;
  onViewportChange: (viewport: TimelineViewport) => void;
  onStartChange: (seconds: number) => void;
  onEndChange: (seconds: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<{
    id: number;
    mode: 'handle' | 'selection';
    handle: 'start' | 'end';
    selectionOffset?: number;
    selectionDuration?: number;
  } | null>(null);
  const localViewportRef = useRef<TimelineViewport>(viewport);
  const dragScrollTimeRef = useRef<number | null>(null);
  const [magneticEdge, setMagneticEdge] = useState<'start' | 'end' | null>(null);
  const [activeHandle, setActiveHandle] = useState<'start' | 'end' | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<'handle' | 'selection' | null>(null);
  const [localViewport, setLocalViewport] = useState<TimelineViewport>(viewport);
  useEffect(() => {
    localViewportRef.current = viewport;
    setLocalViewport(viewport);
  }, [viewport.start, viewport.end, duration]);
  useEffect(() => { localViewportRef.current = localViewport; }, [localViewport]);
  const viewStart = Math.max(0, Math.min(localViewport.start, duration));
  const viewEnd = Math.min(duration, Math.max(viewStart + 0.05, localViewport.end));
  const viewDuration = Math.max(0.05, viewEnd - viewStart);
  const startPercent = Math.min(100, Math.max(0, (start - viewStart) / viewDuration * 100));
  const endPercent = Math.min(100, Math.max(0, (end - viewStart) / viewDuration * 100));
  const coverPercent = coverTime === null ? null : Math.min(100, Math.max(0, (coverTime - viewStart) / viewDuration * 100));
  const overviewStartPercent = duration > 0 ? start / duration * 100 : 0;
  const overviewEndPercent = duration > 0 ? end / duration * 100 : 100;
  const overviewViewStartPercent = duration > 0 ? viewStart / duration * 100 : 0;
  const overviewViewEndPercent = duration > 0 ? viewEnd / duration * 100 : 100;

  const getViewportMetrics = (candidate: TimelineViewport = localViewportRef.current) => {
    const start = Math.max(0, Math.min(candidate.start, duration));
    const end = Math.min(duration, Math.max(start + 0.05, candidate.end));
    return { start, end, duration: Math.max(0.05, end - start) };
  };

  const timeAtPointer = (clientX: number, metrics = getViewportMetrics()) => {
    const rect = railRef.current?.getBoundingClientRect();
    return rect ? metrics.start + ((clientX - rect.left) / rect.width) * metrics.duration : 0;
  };

  const moveHandle = (handle: 'start' | 'end', seconds: number, rect?: DOMRect, visibleDuration = viewDuration) => {
    let snapped = snapClipTime(seconds);
    let nextMagneticEdge: 'start' | 'end' | null = null;
    if (rect && rect.width > 0) {
      const edgeSnapSeconds = Math.min(0.5, Math.max(CLIP_TIME_STEP, visibleDuration * 14 / rect.width));
      if (handle === 'start' && seconds <= edgeSnapSeconds) {
        snapped = 0;
        nextMagneticEdge = 'start';
      } else if (handle === 'end' && duration - seconds <= edgeSnapSeconds) {
        snapped = duration;
        nextMagneticEdge = 'end';
      }
    }
    setMagneticEdge(nextMagneticEdge);
    if (handle === 'start') onStartChange(clampClipStart(snapped, end, duration));
    else onEndChange(clampClipEnd(snapped, start, duration));
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]');
    const rect = railRef.current?.getBoundingClientRect();
    const metrics = getViewportMetrics();
    const seconds = timeAtPointer(event.clientX, metrics);
    const overlapping = rect && duration > 0 && (end - start) / metrics.duration * rect.width < 52;
    const nearest = overlapping && rect
      ? event.clientX <= rect.left + ((start + end) / 2 - metrics.start) / metrics.duration * rect.width ? 'start' : 'end'
      : Math.abs(seconds - start) <= Math.abs(seconds - end) ? 'start' : 'end';
    const targetHandle = target?.dataset.handle === 'start' || target?.dataset.handle === 'end' ? target.dataset.handle : null;
    const draggingSelection = !targetHandle && seconds >= start && seconds <= end && end > start;
    const handle: 'start' | 'end' = targetHandle ?? nearest;
    activePointer.current = draggingSelection
      ? { id: event.pointerId, mode: 'selection', handle, selectionOffset: seconds - start, selectionDuration: end - start }
      : { id: event.pointerId, mode: 'handle', handle };
    dragScrollTimeRef.current = performance.now();
    setActiveHandle(draggingSelection ? null : handle);
    setActiveInteraction(draggingSelection ? 'selection' : 'handle');
    setMagneticEdge(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (targetHandle) target?.focus();
    if (!draggingSelection && !targetHandle) moveHandle(handle, seconds, rect ?? undefined);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activePointer.current;
    const rect = railRef.current?.getBoundingClientRect();
    if (!active || active.id !== event.pointerId || !rect) return;
    const metrics = getViewportMetrics();
    const pointerX = event.clientX - rect.left;
    const edgeZone = Math.min(36, Math.max(24, rect.width * 0.08));
    const nearLeft = pointerX < edgeZone && metrics.start > 0;
    const nearRight = pointerX > rect.width - edgeZone && metrics.end < duration;
    let activeMetrics = metrics;
    let seconds = timeAtPointer(event.clientX, metrics);
    const now = performance.now();
    if (nearLeft || nearRight) {
      const previous = dragScrollTimeRef.current ?? now;
      const elapsed = Math.min(0.08, Math.max(0, (now - previous) / 1000));
      dragScrollTimeRef.current = now;
      const distance = nearLeft ? edgeZone - pointerX : pointerX - (rect.width - edgeZone);
      const strength = Math.min(1, Math.max(0, distance / edgeZone));
      const shift = metrics.duration * (0.7 + strength * 1.8) * elapsed;
      const nextStart = nearLeft
        ? Math.max(0, metrics.start - shift)
        : Math.max(0, Math.min(duration - metrics.duration, metrics.end + shift - metrics.duration));
      const nextEnd = nearLeft
        ? Math.min(duration, nextStart + metrics.duration)
        : Math.min(duration, metrics.end + shift);
      const next = { start: nextStart, end: nextEnd };
      activeMetrics = getViewportMetrics(next);
      if (Math.abs(activeMetrics.start - metrics.start) > 0.0001 || Math.abs(activeMetrics.end - metrics.end) > 0.0001) {
        localViewportRef.current = next;
        setLocalViewport(next);
      }
      const ratio = Math.min(1, Math.max(0, pointerX / rect.width));
      seconds = activeMetrics.start + ratio * activeMetrics.duration;
    } else {
      dragScrollTimeRef.current = now;
    }
    if (active.mode === 'selection') {
      const selectionDuration = active.selectionDuration ?? (end - start);
      const selectionOffset = active.selectionOffset ?? selectionDuration / 2;
      const maxStart = Math.max(0, duration - selectionDuration);
      const nextStart = Math.min(maxStart, Math.max(0, snapClipTime(seconds - selectionOffset)));
      const nextEnd = nextStart + selectionDuration;
      setMagneticEdge(nextStart <= 0 ? 'start' : nextEnd >= duration ? 'end' : null);
      onStartChange(nextStart);
      onEndChange(nextEnd);
    } else {
      moveHandle(active.handle, seconds, rect, activeMetrics.duration);
    }
  };

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current?.id !== event.pointerId) return;
    activePointer.current = null;
    dragScrollTimeRef.current = null;
    setActiveHandle(null);
    setActiveInteraction(null);
    setMagneticEdge(null);
    const next = viewportForSelection(start, end, duration);
    setLocalViewport(next);
    onViewportChange(next);
  };

  const handleKey = (event: ReactKeyboardEvent<HTMLDivElement>, handle: 'start' | 'end') => {
    if (disabled) return;
    const current = handle === 'start' ? start : end;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': case 'ArrowDown': next = current - 0.05; break;
      case 'ArrowRight': case 'ArrowUp': next = current + 0.05; break;
      case 'Home': next = handle === 'start' ? 0 : start + MIN_CLIP_SECONDS; break;
      case 'End': next = handle === 'start' ? end - MIN_CLIP_SECONDS : duration; break;
      default: return;
    }
    event.preventDefault();
    moveHandle(handle, next);
  };

  return (
    <div className={`clip-range-group ${disabled ? 'is-disabled' : ''} ${magneticEdge ? `is-magnetic-${magneticEdge}` : ''} ${activeInteraction === 'selection' ? 'is-selection-active' : ''}`}>
      <div className="clip-overview" aria-label="全片概览">
        <div className="clip-overview-track">
          <div className="clip-overview-viewport" style={{ left: `${overviewViewStartPercent}%`, width: `${overviewViewEndPercent - overviewViewStartPercent}%` }} />
          <div className="clip-overview-selection" style={{ left: `${overviewStartPercent}%`, width: `${overviewEndPercent - overviewStartPercent}%` }} />
        </div>
        <span>全片 {formatClipTime(duration)}</span>
      </div>
      <div className="clip-range" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        <div className="clip-range-rail" ref={railRef}>
          <div className="clip-frame-strip" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className="clip-frame" key={index}>{frames[index] ? <img src={frames[index]} alt="" /> : null}</div>)}</div>
          <div className="clip-range-mask" style={{ left: 0, width: `${startPercent}%` }} />
          <div className="clip-range-mask" style={{ left: `${endPercent}%`, width: `${100 - endPercent}%` }} />
          <div className="clip-range-selection" style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }} />
          {coverPercent !== null ? <div className="clip-range-playhead" style={{ left: `${coverPercent}%` }} aria-hidden="true" /> : null}
          <div className={`clip-range-handle ${activeHandle === 'start' ? 'is-active' : ''} ${magneticEdge === 'start' ? 'is-magnetic' : ''}`} data-handle="start" style={{ left: `${startPercent}%` }} role="slider" tabIndex={disabled ? -1 : 0} aria-orientation="horizontal" aria-label="片段起点" aria-valuemin={0} aria-valuemax={Math.max(0, end - MIN_CLIP_SECONDS)} aria-valuenow={start} aria-valuetext={formatClipTime(start)} aria-disabled={disabled} onKeyDown={(event) => handleKey(event, 'start')}>
            {activeHandle === 'start' ? <span className="clip-handle-time" aria-hidden="true">{formatClipTime(start)}</span> : null}
          </div>
          <div className={`clip-range-handle ${activeHandle === 'end' ? 'is-active' : ''} ${magneticEdge === 'end' ? 'is-magnetic' : ''}`} data-handle="end" style={{ left: `${endPercent}%` }} role="slider" tabIndex={disabled ? -1 : 0} aria-orientation="horizontal" aria-label="片段终点" aria-valuemin={Math.min(duration, start + MIN_CLIP_SECONDS)} aria-valuemax={duration} aria-valuenow={end} aria-valuetext={formatClipTime(end)} aria-disabled={disabled} onKeyDown={(event) => handleKey(event, 'end')}>
            {activeHandle === 'end' ? <span className="clip-handle-time" aria-hidden="true">{formatClipTime(end)}</span> : null}
          </div>
        </div>
      </div>
      <div className="clip-range-times"><span>起点 <strong>{formatClipTime(start)}</strong></span><span>片段 <strong>{formatClipTime(end - start)}</strong></span><span>终点 <strong>{formatClipTime(end)}</strong></span></div>
    </div>
  );
}

function VideoOnlyMode({ onBack }: { onBack: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<File | null>(null);
  const [playableVideo, setPlayableVideo] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(0);
  const [trimMode, setTrimMode] = useState<TrimMode>('fast');
  const [selectedTime, setSelectedTime] = useState(0);
  const [timelineFrames, setTimelineFrames] = useState<string[]>([]);
  const [timelineViewport, setTimelineViewport] = useState<TimelineViewport>({ start: 0, end: 0 });
  const [frameReady, setFrameReady] = useState(false);
  const [firstFramePreviewUrl, setFirstFramePreviewUrl] = useState<string | null>(null);
  const [showFirstFramePreview, setShowFirstFramePreview] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [fadeToCover, setFadeToCover] = useState(true);
  const [coverFadeSeconds, setCoverFadeSeconds] = useState(DEFAULT_UI_COVER_FADE_SECONDS);
  const [showCoverTransition, setShowCoverTransition] = useState(false);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const coverTransitionTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; name: string; note: string | null } | null>(null);
  const videoUrl = useMemo(() => playableVideo ? URL.createObjectURL(playableVideo) : null, [playableVideo]);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => () => { if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl); }, [coverPreviewUrl]);
  useEffect(() => () => { if (firstFramePreviewUrl) URL.revokeObjectURL(firstFramePreviewUrl); }, [firstFramePreviewUrl]);
  useEffect(() => {
    if (!videoUrl || !frameReady || !videoRef.current) {
      setFirstFramePreviewUrl(null);
      return;
    }
    let cancelled = false;
    let generatedUrl: string | null = null;
    void captureVideoFrame(videoRef.current, 'first-frame.mp4', 0)
      .then((image) => {
        generatedUrl = URL.createObjectURL(image);
        if (cancelled) {
          URL.revokeObjectURL(generatedUrl);
          return;
        }
        setFirstFramePreviewUrl(generatedUrl);
        setShowFirstFramePreview(true);
      })
      .catch(() => {
        if (!cancelled) setFirstFramePreviewUrl(null);
      });
    return () => {
      cancelled = true;
      if (generatedUrl) URL.revokeObjectURL(generatedUrl);
    };
  }, [videoUrl, frameReady]);
  useEffect(() => () => {
    if (coverTransitionTimerRef.current !== null) {
      window.clearTimeout(coverTransitionTimerRef.current);
      coverTransitionTimerRef.current = null;
    }
  }, []);
  useEffect(() => {
    if (!videoUrl || duration <= 0) {
      setTimelineViewport({ start: 0, end: 0 });
      return;
    }
    setTimelineViewport({ start: 0, end: duration });
  }, [videoUrl, duration]);
  useEffect(() => {
    setTimelineFrames([]);
    if (!videoUrl || duration <= 0 || timelineViewport.end <= timelineViewport.start) return;
    const controller = new AbortController();
    const viewportDuration = timelineViewport.end - timelineViewport.start;
    void createTimelineThumbnails(videoUrl, viewportDuration, controller.signal, timelineViewport.start)
      .then((frames) => { if (!controller.signal.aborted) setTimelineFrames(frames); })
      .catch(() => { /* 缩略图只是预览，失败时保留可操作的时间轴。 */ });
    return () => controller.abort();
  }, [videoUrl, duration, timelineViewport.start, timelineViewport.end]);
  useEffect(() => {
    if (!fadeToCover || !videoUrl || !frameReady) {
      setCoverPreviewUrl(null);
      setShowCoverTransition(false);
      return;
    }
    if (isPreviewing || !videoRef.current) return;

    const element = videoRef.current;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void captureVideoFrame(element, source?.name ?? 'cover.mp4', selectedTime)
        .then((image) => {
          if (!cancelled) setCoverPreviewUrl(URL.createObjectURL(image));
        })
        .catch(() => {
          if (!cancelled) setCoverPreviewUrl(null);
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fadeToCover, videoUrl, frameReady, selectedTime, source?.name, isPreviewing]);
  useEffect(() => {
    if (status !== 'working') return;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const chooseVideo = async (file: File) => {
    if (coverTransitionTimerRef.current !== null) {
      window.clearTimeout(coverTransitionTimerRef.current);
      coverTransitionTimerRef.current = null;
    }
    setSource(file);
    setPlayableVideo(null);
    setDuration(0);
    setClipStart(0);
    setClipEnd(0);
    setSelectedTime(0);
    setTimelineViewport({ start: 0, end: 0 });
    setFrameReady(false);
    setFirstFramePreviewUrl(null);
    setShowFirstFramePreview(false);
    setIsPreviewing(false);
    setShowCoverTransition(false);
    setCoverPreviewUrl(null);
    setStatus('idle');
    setStage('');
    setProgress(null);
    setError(null);
    setResult(null);
    if (/\.mov$/i.test(file.name) || file.type === 'video/quicktime') {
      setStatus('analyzing');
      try {
        const mp4 = await normalizeVideo(file, setStage);
        setPlayableVideo(mp4);
        setStatus('idle');
        setStage('');
      } catch (caught) {
        setStatus('error');
        setStage('无法准备 MOV 视频');
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } else {
      setPlayableVideo(file);
    }
  };

  const seekFrame = (time: number) => {
    if (coverTransitionTimerRef.current !== null) {
      window.clearTimeout(coverTransitionTimerRef.current);
      coverTransitionTimerRef.current = null;
    }
    setSelectedTime(time);
    const element = videoRef.current;
    if (element) {
      element.pause();
      element.currentTime = time;
    }
    setShowFirstFramePreview(false);
    setIsPreviewing(false);
    setShowCoverTransition(false);
    setResult(null);
    setError(null);
    setProgress(null);
    setStatus('idle');
  };

  const selectTrimMode = (mode: TrimMode) => {
    setTrimMode(mode);
    setResult(null);
    setError(null);
    setProgress(null);
    setStatus('idle');
  };

  const selectFrame = (seconds: number) => {
    seekFrame(clampCoverTime(snapClipTime(seconds), clipStart, clipEnd));
  };

  const selectClipStart = (seconds: number) => {
    const time = clampClipStart(seconds, clipEnd, duration);
    setClipStart(time);
    seekFrame(time);
  };

  const selectClipEnd = (seconds: number) => {
    const time = clampClipEnd(seconds, clipStart, duration);
    setClipEnd(time);
    seekFrame(clampCoverTime(selectedTime, clipStart, time));
  };

  const previewClip = async () => {
    const element = videoRef.current;
    if (!element || !frameReady) return;
    if (isPreviewing) {
      element.pause();
      setShowCoverTransition(false);
      return;
    }
    try {
      if (coverTransitionTimerRef.current !== null) {
        window.clearTimeout(coverTransitionTimerRef.current);
        coverTransitionTimerRef.current = null;
      }
      setShowCoverTransition(false);
      setShowFirstFramePreview(false);
      element.currentTime = clipStart;
      await element.play();
      setIsPreviewing(true);
    } catch {
      setError('无法播放预览，但仍可拖动选择片段与封面。');
    }
  };

  const returnToCover = (element: HTMLVideoElement) => {
    setIsPreviewing(false);
    element.pause();
    if (coverTransitionTimerRef.current !== null) {
      window.clearTimeout(coverTransitionTimerRef.current);
      coverTransitionTimerRef.current = null;
    }
    if (fadeToCover && coverPreviewUrl) {
      setShowCoverTransition(true);
      coverTransitionTimerRef.current = window.setTimeout(() => {
        element.currentTime = selectedTime;
        coverTransitionTimerRef.current = null;
      }, coverFadeSeconds * 1000 + 40);
    } else {
      element.currentTime = selectedTime;
      setShowCoverTransition(false);
    }
  };

  const generate = async () => {
    const element = videoRef.current;
    if (!source || !playableVideo || !element || !frameReady || status === 'working') return;
    setStatus('working');
    setError(null);
    setProgress(null);
    try {
      setStage('正在提取选定画面作为封面…');
      const image = await captureVideoFrame(element, source.name, selectedTime);
      const trimmed = isClipTrimmed(clipStart, clipEnd, duration);
      const outputVideo = trimmed ? await trimVideo(playableVideo, clipStart, clipEnd, trimMode, (message, value) => {
        setStage(message);
        setProgress(value ?? null);
      }) : playableVideo;
      const actualDuration = trimmed ? (await analyzeFile(outputVideo)).durationSeconds ?? clipEnd - clipStart : duration;
      if (trimmed && actualDuration < MIN_CLIP_SECONDS) throw new Error('裁剪结果过短，请扩大片段范围或尝试精确裁剪。');
      const dimensions = await readVideoDimensions(outputVideo);
      const outputVideoWithFade = fadeToCover
        ? await addCoverFade(outputVideo, image, actualDuration, dimensions.width, dimensions.height, coverFadeSeconds, (message, value) => {
          setStage(message);
          setProgress(value ?? null);
        })
        : outputVideo;
      const coverOffset = trimmed ? coverOffsetInClip(selectedTime, clipStart, clipEnd, actualDuration, trimMode) : selectedTime;
      setStage('正在写入 Samsung Motion Photo…');
      const name = outputName(source.name);
      const output = await muxFiles(image, outputVideoWithFade, name, Math.round(coverOffset * 1_000_000));
      if (!output.analysis.validation.isSamsungCompatible) throw new Error('生成结果未通过 Samsung Motion Photo 结构校验。');
      const extra = trimmed && trimMode === 'fast' ? Math.max(0, actualDuration - (clipEnd - clipStart)) : 0;
      const notes: string[] = [];
      if (fadeToCover) notes.push(`已在视频结尾追加 ${formatClipTime(coverFadeSeconds)} 的封面渐变尾段。`);
      if (extra >= 0.15) notes.push(`快速裁剪可能多保留了约 ${formatClipTime(extra)} 的开头画面；如需严格起点，请选择精确裁剪。`);
      const note = notes.length > 0 ? notes.join(' ') : null;
      setResult({ url: URL.createObjectURL(output.blob), blob: output.blob, name, note });
      setStatus('success');
      setStage('转换成功');
    } catch (caught) {
      setStatus('error');
      setStage('转换失败');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <main className="screen-shell">
      <ModeHeader title="视频生成 Motion Photo" onBack={onBack} />
      <PrivacyNote />
      <section className="section-heading"><p>选择片段和封面，生成 Samsung Motion Photo。</p></section>
      <button className={`upload-zone ${source ? 'is-compact' : ''}`} type="button" disabled={status === 'working' || status === 'analyzing'} onClick={() => inputRef.current?.click()}>
        <span className="upload-icon"><Film size={25} /></span>
        <strong>{source ? '更换视频' : '选择一个视频'}</strong>
        <small>{source ? `${source.name} · ${formatBytes(source.size)}` : 'MP4 / MOV · 仅本机处理'}</small>
      </button>
      <input ref={inputRef} className="visually-hidden" type="file" accept={VIDEO_ACCEPT} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void chooseVideo(file); event.currentTarget.value = ''; }} />

      {videoUrl ? (
        <section className="frame-card">
          <div className="frame-heading"><strong>选择视频片段</strong><span>{formatClipTime(clipEnd - clipStart)}</span></div>
          <div className={`frame-preview-stage ${showCoverTransition ? 'is-showing-cover' : ''}`} style={{ '--cover-fade-duration': `${coverFadeSeconds}s` } as CSSProperties}>
            <video
              key={videoUrl}
              ref={videoRef}
              className="frame-preview"
              src={videoUrl}
              preload="auto"
              muted
              playsInline
              onLoadedMetadata={(event) => {
                const value = event.currentTarget.duration;
                if (Number.isFinite(value) && value > 0) { setDuration(value); setClipEnd(value); }
                else setError('无法读取视频时长，请选择有效的 MP4 或 MOV。');
              }}
              onLoadedData={() => setFrameReady(true)}
              onPause={() => setIsPreviewing(false)}
              onEnded={(event) => returnToCover(event.currentTarget)}
              onTimeUpdate={(event) => {
                const video = event.currentTarget;
                if (isPreviewing && video.currentTime >= clipEnd - 0.03) returnToCover(video);
              }}
              onError={() => { setFrameReady(false); setError('浏览器无法预览该视频，请使用 H.264 MP4。'); }}
            />
            {firstFramePreviewUrl ? <img className={`frame-initial-preview ${showFirstFramePreview ? 'is-visible' : ''}`} src={firstFramePreviewUrl} alt="视频第一帧预览" aria-hidden="true" /> : null}
            {coverPreviewUrl ? <img className="frame-cover-preview" src={coverPreviewUrl} alt="选定的封面预览" aria-hidden="true" /> : null}
          </div>
          {duration > 0 ? (
            <>
              <ClipRangeSelector duration={duration} start={clipStart} end={clipEnd} coverTime={selectedTime} frames={timelineFrames} disabled={status === 'working'} viewport={timelineViewport} onViewportChange={setTimelineViewport} onStartChange={selectClipStart} onEndChange={selectClipEnd} />
              <label className="frame-slider-label" htmlFor="cover-time">拖动选择封面</label>
              <input id="cover-time" className="frame-slider" type="range" min={clipStart} max={clampCoverTime(clipEnd, clipStart, clipEnd)} step={CLIP_TIME_STEP} value={selectedTime} disabled={status === 'working'} onChange={(event) => selectFrame(Number(event.currentTarget.value))} />
              <div className="clip-preview-controls">
                <CoverFadeOptions enabled={fadeToCover} seconds={coverFadeSeconds} disabled={!frameReady || status === 'working'} onEnabledChange={(enabled) => { setFadeToCover(enabled); setShowCoverTransition(false); }} onSecondsChange={setCoverFadeSeconds} />
                <button className="clip-preview-button" type="button" disabled={!frameReady || status === 'working'} onClick={() => void previewClip()}>{isPreviewing ? '暂停预览' : '预览片段'}</button>
              </div>
              <div className="trim-method" role="group" aria-label="裁剪方式">
                <button type="button" className={trimMode === 'fast' ? 'is-selected' : ''} aria-pressed={trimMode === 'fast'} disabled={status === 'working'} onClick={() => selectTrimMode('fast')}>快速裁剪</button>
                <button type="button" className={trimMode === 'precise' ? 'is-selected' : ''} aria-pressed={trimMode === 'precise'} disabled={status === 'working'} onClick={() => selectTrimMode('precise')}>精确裁剪</button>
              </div>
              <p className="trim-method-note">{trimMode === 'fast' ? '快速：复制原视频，速度快；起点可能略有偏差。' : '精确：重新编码 H.264，边界更准但更慢。'}</p>
            </>
          ) : null}
          <p>封面保存为 JPEG；未裁剪时使用完整视频。</p>
        </section>
      ) : null}

      {(status === 'analyzing' || status === 'working') ? <div className="progress-card"><LoaderCircle className="spin" /><div className="progress-copy"><strong>{stage}</strong><span>{status === 'working' ? `已用时 ${elapsedSeconds} 秒${progress === null ? '' : ` · 进度约 ${Math.round(progress * 100)}%`}` : '正在准备视频'} · 请勿关闭页面</span>{progress !== null ? <progress className="processing-meter" max={1} value={progress} aria-label="视频处理进度" /> : null}</div></div> : null}
      {error ? <div className="error-card"><CircleAlert /><div><strong>{stage || '无法处理视频'}</strong><span>{error}</span></div></div> : null}
      {result ? <section className="result-card"><div className="success-mark"><Check size={23} /></div><div className="result-copy"><span>生成成功</span><strong>{result.name}</strong><small>{formatBytes(result.blob.size)}</small></div><Film size={35} />{result.note ? <small className="result-note">{result.note}</small> : null}<button className="primary-button" type="button" onClick={() => download(result.url, result.name)}><Download />保存 Motion Photo</button></section> : null}
      {!result ? <div className="bottom-action"><button className="primary-button" type="button" disabled={!playableVideo || !frameReady || !duration || status === 'working' || status === 'analyzing'} onClick={() => void generate()}>{status === 'working' ? <LoaderCircle className="spin" /> : <Images />}{status === 'working' ? '正在生成…' : '生成 Motion Photo'}</button></div> : null}
    </main>
  );
}

function Home({ onOpen }: { onOpen: (view: View) => void }) {
  return (
    <main className="home-shell home-minimal">
      <header className="brand-row"><div className="brand-mark"><img className="brand-logo" src="./motion-photo-icon-functional-simple-approved.svg" alt="" aria-hidden="true" /></div><div className="brand-name"><strong><span className="brand-word-main">Motion Photo</span><span className="brand-word-sub">Converter</span></strong></div></header>
      <section className="home-intro" aria-label="Motion Photo Converter 首页">
        <h1>动态图工具</h1>
        <p>轻松生成 Samsung Motion Photo</p>
      </section>
      <p className="home-section-label">选择创建方式</p>
      <section className="home-tool-list home-layout-d" aria-label="转换方式">
        <button className="home-tool" type="button" onClick={() => onOpen('video')}>
          <span className="home-tool-icon"><SchemeAIcon name="film" /></span>
          <span className="home-tool-copy"><strong>视频生成动态图</strong><small>截取片段，选择一帧作封面</small></span>
          <SchemeAIcon name="chevron" />
        </button>
        <button className="home-tool" type="button" onClick={() => onOpen('embedded')}>
          <span className="home-tool-icon"><SchemeAIcon name="stack" /></span>
          <span className="home-tool-copy"><strong>批量转换</strong><small>一次转换多个动态照片</small></span>
          <SchemeAIcon name="chevron" />
        </button>
        <button className="home-tool" type="button" onClick={() => onOpen('manual')}>
          <span className="home-tool-icon"><SchemeAIcon name="combine" /></span>
          <span className="home-tool-copy"><strong>照片 + 视频</strong><small>组合成动态照片</small></span>
          <SchemeAIcon name="chevron" />
        </button>
      </section>
      <div className="home-bottom-meta">
        <PrivacyNote />
      </div>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<View>('home');
  if (view === 'embedded') return <MotionFileMode onBack={() => setView('home')} />;
  if (view === 'video') return <VideoOnlyMode onBack={() => setView('home')} />;
  if (view === 'manual') return <ManualMode onBack={() => setView('home')} />;
  return <Home onOpen={setView} />;
}
