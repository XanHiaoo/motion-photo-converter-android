import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  FileImage,
  Film,
  Images,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Plus,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Sun,
  Upload,
  X,
} from 'lucide-react';

import { formatBytes, locateEmbeddedMotionParts, outputName, type MediaAnalysis } from './core';
import { convertEmbeddedMotionFile } from './lib/embedded-convert';
import { normalizeImage } from './lib/image-normalize';
import { captureVideoFrame, createTimelineThumbnails } from './lib/video-frame';
import { normalizeVideo, trimVideo } from './lib/video-remux';
import { clampClipEnd, clampClipStart, clampCoverTime, coverOffsetInClip, formatClipTime, isClipTrimmed, MIN_CLIP_SECONDS, positionToClipTime, type TrimMode } from './lib/video-trim';
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

function ModeHeader({ title, onBack, dark, onToggleDark }: { title: string; onBack: () => void; dark: boolean; onToggleDark: () => void }) {
  return (
    <header className="mode-header">
      <button className="icon-button" type="button" onClick={onBack} aria-label="返回首页"><ArrowLeft size={21} /></button>
      <strong>{title}</strong>
      <button className="icon-button" type="button" onClick={onToggleDark} aria-label="切换深色模式">{dark ? <Sun size={20} /> : <Moon size={20} />}</button>
    </header>
  );
}

function PrivacyNote() {
  return <div className="privacy-note"><LockKeyhole size={17} /><span>文件仅在你的设备中解析和转换，不会上传服务器。</span></div>;
}

function MotionFileMode({ dark, onToggleDark, onBack }: { dark: boolean; onToggleDark: () => void; onBack: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tasksRef = useRef<MotionTask[]>([]);
  const [tasks, setTasks] = useState<MotionTask[]>([]);
  const [dragging, setDragging] = useState(false);

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
        updateTask(task.id, { analysis: report, status: 'already', stage: '已经是 Samsung Motion Photo' });
      } else {
        updateTask(task.id, { analysis: report, status: 'ready', stage: '已找到图片和内嵌视频' });
      }
    } catch (caught) {
      updateTask(task.id, {
        status: 'error',
        stage: '无法解析',
        error: `${caught instanceof Error ? caught.message : String(caught)} 可尝试“照片 + 视频”模式。`,
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
      stage: '正在定位图片和内嵌视频…',
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
    updateTask(task.id, { status: 'working', stage: '正在准备转换…', error: null });
    try {
      const output = await convertEmbeddedMotionFile(task.file, task.analysis, (stage) => updateTask(task.id, { stage }));
      const url = URL.createObjectURL(output.blob);
      updateTask(task.id, { output: { url, blob: output.blob, name: output.name }, status: 'success', stage: '转换成功' });
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
      <ModeHeader title="批量转换动态图" onBack={onBack} dark={dark} onToggleDark={onToggleDark} />
      <PrivacyNote />
      <section className="section-heading">
        <span className="step-pill">推荐方式</span>
        <h1>选择一个或多个动态图</h1>
        <p>批量解析每个文件中的静态图片与内嵌视频，再按顺序封装为 Samsung Motion Photo。</p>
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
        <strong>{tasks.length ? '继续添加动态图' : '批量选择动态图'}</strong>
        <small>可一次多选 · JPG、JPEG、HEIC</small>
      </button>
      <input ref={inputRef} className="visually-hidden" type="file" multiple accept={MOTION_ACCEPT} onChange={(event) => { addFiles([...(event.currentTarget.files ?? [])]); event.currentTarget.value = ''; }} />
      <div className="format-hint"><ScanSearch size={17} /><span>每个文件都应同时包含静态图片和内嵌 MP4/MOV 视频。</span></div>

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
          <div className="summary-line"><span>{completedCount} 个已完成</span><span>{failedCount ? `${failedCount} 个需处理` : '按顺序处理，更适合手机'}</span></div>
        </section>
      ) : null}

      {(readyCount > 0 || busy) ? (
        <div className="bottom-action"><button className="primary-button" type="button" disabled={!readyCount || busy} onClick={() => void convertAll()}>{busy ? <LoaderCircle className="spin" /> : <Images />}{busy ? '正在处理文件…' : `全部转换（${readyCount}）`}</button></div>
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

function ManualMode({ dark, onToggleDark, onBack }: { dark: boolean; onToggleDark: () => void; onBack: () => void }) {
  const [image, setImage] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; name: string } | null>(null);
  const previewUrl = useMemo(() => image ? URL.createObjectURL(image) : null, [image]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const generate = async () => {
    if (!image || !video) return;
    setStatus('working');
    setError(null);
    try {
      const normalizedImage = await normalizeImage(image, setStage);
      const normalizedVideo = await normalizeVideo(video, setStage);
      setStage('正在生成 Motion Photo…');
      const videoAnalysis = await analyzeFile(normalizedVideo);
      const timestampUs = videoAnalysis.durationSeconds ? Math.round(videoAnalysis.durationSeconds * 500_000) : -1;
      const name = outputName(image.name);
      const output = await muxFiles(normalizedImage, normalizedVideo, name, timestampUs);
      if (!output.analysis.validation.isSamsungCompatible) throw new Error('生成结果未通过结构校验。');
      setResult({ url: URL.createObjectURL(output.blob), blob: output.blob, name });
      setStatus('success');
      setStage('转换成功');
    } catch (caught) {
      setStatus('error');
      setStage('转换失败');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const replaceImage = (file: File) => { setImage(file); setResult(null); setStatus('idle'); setError(null); };
  const replaceVideo = (file: File) => { setVideo(file); setResult(null); setStatus('idle'); setError(null); };

  return (
    <main className="screen-shell">
      <ModeHeader title="照片 + 视频" onBack={onBack} dark={dark} onToggleDark={onToggleDark} />
      <PrivacyNote />
      <section className="section-heading"><span className="step-pill">备用方式</span><h1>手动选择照片和视频</h1><p>当原设备把动态图导出为两个独立文件时使用。</p></section>
      <section className="manual-stack"><FilePicker kind="照片" file={image} accept={IMAGE_ACCEPT} icon="image" onChange={replaceImage} /><div className="connector"><Plus size={15} /></div><FilePicker kind="视频" file={video} accept={VIDEO_ACCEPT} icon="video" onChange={replaceVideo} /></section>
      {status === 'working' ? <div className="progress-card"><LoaderCircle className="spin" /><div><strong>{stage}</strong><span>请保持页面打开</span></div></div> : null}
      {status === 'error' ? <div className="error-card"><CircleAlert /><div><strong>{stage}</strong><span>{error}</span></div></div> : null}
      {result ? <section className="result-card"><div className="success-mark"><Check size={23} /></div><div className="result-copy"><span>转换成功</span><strong>{result.name}</strong><small>{formatBytes(result.blob.size)}</small></div>{previewUrl ? <img src={previewUrl} alt="结果图片缩略图" /> : null}<button className="primary-button" type="button" onClick={() => download(result.url, result.name)}><Download />保存 Motion Photo</button></section> : null}
      {!result ? <div className="bottom-action"><button className="primary-button" type="button" disabled={!image || !video || status === 'working'} onClick={() => void generate()}>{status === 'working' ? <LoaderCircle className="spin" /> : <Plus />}{status === 'working' ? '正在生成…' : '生成 Samsung Motion Photo'}</button></div> : null}
    </main>
  );
}

function ClipRangeSelector({ duration, start, end, coverTime, frames, disabled, onStartChange, onEndChange }: {
  duration: number;
  start: number;
  end: number;
  coverTime: number;
  frames: string[];
  disabled: boolean;
  onStartChange: (seconds: number) => void;
  onEndChange: (seconds: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<{ id: number; handle: 'start' | 'end' } | null>(null);
  const startPercent = duration > 0 ? start / duration * 100 : 0;
  const endPercent = duration > 0 ? end / duration * 100 : 100;
  const coverPercent = duration > 0 ? coverTime / duration * 100 : 0;

  const timeAtPointer = (clientX: number) => {
    const rect = railRef.current?.getBoundingClientRect();
    return rect ? positionToClipTime(clientX, rect.left, rect.width, duration) : 0;
  };

  const moveHandle = (handle: 'start' | 'end', seconds: number) => {
    if (handle === 'start') onStartChange(clampClipStart(seconds, end, duration));
    else onEndChange(clampClipEnd(seconds, start, duration));
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]');
    const seconds = timeAtPointer(event.clientX);
    const rect = railRef.current?.getBoundingClientRect();
    const overlapping = rect && duration > 0 && (end - start) / duration * rect.width < 34;
    const nearest = overlapping && rect
      ? event.clientX <= rect.left + (start + end) / (2 * duration) * rect.width ? 'start' : 'end'
      : Math.abs(seconds - start) <= Math.abs(seconds - end) ? 'start' : 'end';
    let handle: 'start' | 'end' = nearest;
    if (!overlapping && (target?.dataset.handle === 'start' || target?.dataset.handle === 'end')) handle = target.dataset.handle;
    activePointer.current = { id: event.pointerId, handle };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (target && !overlapping) target.focus();
    if (!target) moveHandle(handle, seconds);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current?.id === event.pointerId) moveHandle(activePointer.current.handle, timeAtPointer(event.clientX));
  };

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current?.id === event.pointerId) activePointer.current = null;
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
    <div className={`clip-range-group ${disabled ? 'is-disabled' : ''}`}>
      <div className="clip-range" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        <div className="clip-range-rail" ref={railRef}>
          <div className="clip-frame-strip" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className="clip-frame" key={index}>{frames[index] ? <img src={frames[index]} alt="" /> : null}</div>)}</div>
          <div className="clip-range-mask" style={{ left: 0, width: `${startPercent}%` }} />
          <div className="clip-range-mask" style={{ left: `${endPercent}%`, width: `${100 - endPercent}%` }} />
          <div className="clip-range-selection" style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }} />
          <div className="clip-range-playhead" style={{ left: `${coverPercent}%` }} aria-hidden="true" />
          <div className="clip-range-handle" data-handle="start" style={{ left: `${startPercent}%` }} role="slider" tabIndex={disabled ? -1 : 0} aria-label="片段起点" aria-valuemin={0} aria-valuemax={Math.max(0, end - MIN_CLIP_SECONDS)} aria-valuenow={start} aria-valuetext={formatClipTime(start)} aria-disabled={disabled} onKeyDown={(event) => handleKey(event, 'start')} />
          <div className="clip-range-handle" data-handle="end" style={{ left: `${endPercent}%` }} role="slider" tabIndex={disabled ? -1 : 0} aria-label="片段终点" aria-valuemin={Math.min(duration, start + MIN_CLIP_SECONDS)} aria-valuemax={duration} aria-valuenow={end} aria-valuetext={formatClipTime(end)} aria-disabled={disabled} onKeyDown={(event) => handleKey(event, 'end')} />
        </div>
      </div>
      <div className="clip-range-times"><span>开始 <strong>{formatClipTime(start)}</strong></span><span>结束 <strong>{formatClipTime(end)}</strong></span></div>
      <small>拖动蓝色把手选择片段；白线表示封面画面</small>
    </div>
  );
}

function VideoOnlyMode({ dark, onToggleDark, onBack }: { dark: boolean; onToggleDark: () => void; onBack: () => void }) {
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
  const [frameReady, setFrameReady] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; name: string; note: string | null } | null>(null);
  const videoUrl = useMemo(() => playableVideo ? URL.createObjectURL(playableVideo) : null, [playableVideo]);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => {
    setTimelineFrames([]);
    if (!videoUrl || duration <= 0) return;
    const controller = new AbortController();
    void createTimelineThumbnails(videoUrl, duration, controller.signal)
      .then((frames) => { if (!controller.signal.aborted) setTimelineFrames(frames); })
      .catch(() => { /* 缩略图只是预览，失败时保留可操作的时间轴。 */ });
    return () => controller.abort();
  }, [videoUrl, duration]);
  useEffect(() => {
    if (status !== 'working') return;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const chooseVideo = async (file: File) => {
    setSource(file);
    setPlayableVideo(null);
    setDuration(0);
    setClipStart(0);
    setClipEnd(0);
    setSelectedTime(0);
    setFrameReady(false);
    setIsPreviewing(false);
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
    setSelectedTime(time);
    const element = videoRef.current;
    if (element) {
      element.pause();
      element.currentTime = time;
    }
    setIsPreviewing(false);
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
    seekFrame(clampCoverTime(seconds, clipStart, clipEnd));
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
      return;
    }
    try {
      element.currentTime = clipStart;
      await element.play();
      setIsPreviewing(true);
    } catch {
      setError('无法播放预览，但仍可拖动选择片段与封面。');
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
      const coverOffset = trimmed ? coverOffsetInClip(selectedTime, clipStart, clipEnd, actualDuration, trimMode) : selectedTime;
      setStage('正在写入 Samsung Motion Photo…');
      const name = outputName(source.name);
      const output = await muxFiles(image, outputVideo, name, Math.round(coverOffset * 1_000_000));
      if (!output.analysis.validation.isSamsungCompatible) throw new Error('生成结果未通过 Samsung Motion Photo 结构校验。');
      const extra = trimmed && trimMode === 'fast' ? Math.max(0, actualDuration - (clipEnd - clipStart)) : 0;
      const note = extra >= 0.15 ? `快速裁剪可能多保留了约 ${formatClipTime(extra)} 的开头画面；如需严格起点，请选择精确裁剪。` : null;
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
      <ModeHeader title="视频生成动态图" onBack={onBack} dark={dark} onToggleDark={onToggleDark} />
      <PrivacyNote />
      <section className="section-heading"><span className="step-pill">视频模式</span><h1>只用视频生成动态图</h1><p>先截取需要的片段，再选封面画面；默认使用片段的第一帧。</p></section>
      <button className={`upload-zone ${source ? 'is-compact' : ''}`} type="button" disabled={status === 'working' || status === 'analyzing'} onClick={() => inputRef.current?.click()}>
        <span className="upload-icon"><Film size={25} /></span>
        <strong>{source ? '更换视频' : '选择一个视频'}</strong>
        <small>{source ? `${source.name} · ${formatBytes(source.size)}` : 'MP4 / MOV · 视频仅在本机处理'}</small>
      </button>
      <input ref={inputRef} className="visually-hidden" type="file" accept={VIDEO_ACCEPT} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void chooseVideo(file); event.currentTarget.value = ''; }} />

      {videoUrl ? (
        <section className="frame-card">
          <div className="frame-heading"><strong>截取视频片段</strong><span>{formatClipTime(clipEnd - clipStart)}</span></div>
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
              else setError('无法读取视频时长，请选择有效的 MP4 或 MOV 文件。');
            }}
            onLoadedData={() => setFrameReady(true)}
            onPause={() => setIsPreviewing(false)}
            onEnded={(event) => { setIsPreviewing(false); event.currentTarget.currentTime = selectedTime; }}
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              if (isPreviewing && video.currentTime >= clipEnd - 0.03) {
                video.pause();
                video.currentTime = selectedTime;
              }
            }}
            onError={() => { setFrameReady(false); setError('浏览器无法预览此视频，因此无法提取封面。请尝试 H.264 MP4。'); }}
          />
          {duration > 0 ? (
            <>
              <ClipRangeSelector duration={duration} start={clipStart} end={clipEnd} coverTime={selectedTime} frames={timelineFrames} disabled={status === 'working'} onStartChange={selectClipStart} onEndChange={selectClipEnd} />
              <div className="trim-method" role="group" aria-label="裁剪方式">
                <button type="button" className={trimMode === 'fast' ? 'is-selected' : ''} aria-pressed={trimMode === 'fast'} disabled={status === 'working'} onClick={() => selectTrimMode('fast')}>快速裁剪</button>
                <button type="button" className={trimMode === 'precise' ? 'is-selected' : ''} aria-pressed={trimMode === 'precise'} disabled={status === 'working'} onClick={() => selectTrimMode('precise')}>精确裁剪</button>
              </div>
              <p className="trim-method-note">{trimMode === 'fast' ? '默认：直接复制原视频和声音，速度快；起点可能提前到附近的关键帧。' : '按选定时间重新编码 H.264，边界更准，但耗时明显更长。'}</p>
              <button className="clip-preview-button" type="button" disabled={!frameReady || status === 'working'} onClick={() => void previewClip()}>{isPreviewing ? '暂停预览' : '预览选中片段'}</button>
              <div className="frame-heading cover-heading"><strong>选择封面画面</strong><span>{formatClipTime(selectedTime)}</span></div>
              <label className="frame-slider-label" htmlFor="cover-time">拖动选择封面帧</label>
              <input id="cover-time" className="frame-slider" type="range" min={clipStart} max={clampCoverTime(clipEnd, clipStart, clipEnd)} step="0.05" value={selectedTime} disabled={status === 'working'} onChange={(event) => selectFrame(Number(event.currentTarget.value))} />
              <div className="frame-endpoints"><span>片段开始</span><span>片段结束</span></div>
            </>
          ) : null}
          <p>选中的画面会保存为 JPEG 封面；仅所选片段及其声音会封装。未截取时直接封装完整视频。</p>
        </section>
      ) : null}

      {(status === 'analyzing' || status === 'working') ? <div className="progress-card"><LoaderCircle className="spin" /><div className="progress-copy"><strong>{stage}</strong><span>{status === 'working' ? `已用时 ${elapsedSeconds} 秒${progress === null ? '' : ` · 处理进度约 ${Math.round(progress * 100)}%`}` : '正在准备视频'} · 请保持页面打开</span>{progress !== null ? <progress className="processing-meter" max={1} value={progress} aria-label="估算的视频处理进度" /> : null}</div></div> : null}
      {error ? <div className="error-card"><CircleAlert /><div><strong>{stage || '无法处理视频'}</strong><span>{error}</span></div></div> : null}
      {result ? <section className="result-card"><div className="success-mark"><Check size={23} /></div><div className="result-copy"><span>生成成功</span><strong>{result.name}</strong><small>{formatBytes(result.blob.size)}</small></div><Film size={35} />{result.note ? <small className="result-note">{result.note}</small> : null}<button className="primary-button" type="button" onClick={() => download(result.url, result.name)}><Download />保存 Motion Photo</button></section> : null}
      {!result ? <div className="bottom-action"><button className="primary-button" type="button" disabled={!playableVideo || !frameReady || !duration || status === 'working' || status === 'analyzing'} onClick={() => void generate()}>{status === 'working' ? <LoaderCircle className="spin" /> : <Images />}{status === 'working' ? '正在生成…' : '生成 Samsung Motion Photo'}</button></div> : null}
    </main>
  );
}

function Home({ dark, onToggleDark, onOpen }: { dark: boolean; onToggleDark: () => void; onOpen: (view: View) => void }) {
  return (
    <main className="home-shell">
      <header className="brand-row"><div className="brand-mark"><Images size={22} /></div><div><span>SAMSUNG 工具</span><strong>Motion Photo Converter</strong></div><button className="icon-button" type="button" onClick={onToggleDark} aria-label="切换深色模式">{dark ? <Sun size={20} /> : <Moon size={20} />}</button></header>
      <PrivacyNote />
      <section className="home-intro"><span className="step-label">本地解析与重新封装</span><h1>批量把动态图转换为三星格式</h1><p>自动拆出每个文件里的静态图片和内嵌视频，再生成 Samsung Gallery 可识别的 Motion Photo。</p></section>
      <section className="mode-list">
        <button className="mode-card featured" type="button" onClick={() => onOpen('embedded')}><span className="mode-icon"><ScanSearch size={25} /></span><span><strong>批量导入动态图</strong><small>可一次多选 · 解析内嵌图片与视频</small></span><ArrowRight size={21} /></button>
        <button className="mode-card" type="button" onClick={() => onOpen('video')}><span className="mode-icon"><Film size={25} /></span><span><strong>视频生成动态图</strong><small>截取片段，选择封面画面</small></span><ChevronRight size={21} /></button>
        <button className="mode-card" type="button" onClick={() => onOpen('manual')}><span className="mode-icon"><Plus size={25} /></span><span><strong>照片 + 视频</strong><small>原设备导出为两个文件时使用</small></span><ChevronRight size={21} /></button>
      </section>
      <section className="trust-row"><span><ShieldCheck size={16} />本地处理</span><span><X size={15} />不覆盖原文件</span></section>
      <footer>适配 Samsung Internet 与 Android Chrome</footer>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [dark, setDark] = useState(() => localStorage.getItem('motion-photo-theme') === 'dark' || (!localStorage.getItem('motion-photo-theme') && matchMedia('(prefers-color-scheme: dark)').matches));
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('motion-photo-theme', dark ? 'dark' : 'light'); }, [dark]);
  const toggleDark = () => setDark((value) => !value);
  if (view === 'embedded') return <MotionFileMode dark={dark} onToggleDark={toggleDark} onBack={() => setView('home')} />;
  if (view === 'video') return <VideoOnlyMode dark={dark} onToggleDark={toggleDark} onBack={() => setView('home')} />;
  if (view === 'manual') return <ManualMode dark={dark} onToggleDark={toggleDark} onBack={() => setView('home')} />;
  return <Home dark={dark} onToggleDark={toggleDark} onOpen={setView} />;
}
