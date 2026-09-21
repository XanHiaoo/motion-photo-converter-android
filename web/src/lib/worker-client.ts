import type { MediaAnalysis } from '@/src/core';

type Pending = { resolve: (value: unknown) => void; reject: (reason?: unknown) => void };
type WorkerResponse = { id: number; ok: boolean; value?: unknown; error?: string };

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/motion.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.value);
    else request.reject(new Error(response.error ?? 'Worker request failed.'));
  };
  worker.onerror = (event) => {
    for (const request of pending.values()) request.reject(new Error(event.message));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function request<T>(message: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    getWorker().postMessage({ ...message, id }, transfer);
  });
}

export async function analyzeFile(file: File): Promise<MediaAnalysis> {
  const buffer = await file.arrayBuffer();
  return request<MediaAnalysis>({ type: 'analyze', buffer, fileName: file.name, mime: file.type }, [buffer]);
}

export async function muxFiles(
  image: File,
  video: File,
  outputName: string,
  timestampUs: number,
): Promise<{ blob: Blob; analysis: MediaAnalysis }> {
  const [imageBuffer, videoBuffer] = await Promise.all([image.arrayBuffer(), video.arrayBuffer()]);
  const result = await request<{ buffer: ArrayBuffer; analysis: MediaAnalysis }>(
    {
      type: 'mux',
      image: imageBuffer,
      video: videoBuffer,
      imageName: outputName,
      videoMime: video.type,
      timestampUs,
    },
    [imageBuffer, videoBuffer],
  );
  return { blob: new Blob([result.buffer], { type: 'image/jpeg' }), analysis: result.analysis };
}
