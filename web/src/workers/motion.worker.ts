/// <reference lib="webworker" />

import { analyzeBytes, muxSamsungMotionPhoto } from '@/src/core';

type AnalyzeRequest = {
  id: number;
  type: 'analyze';
  buffer: ArrayBuffer;
  fileName: string;
  mime: string;
};

type MuxRequest = {
  id: number;
  type: 'mux';
  image: ArrayBuffer;
  video: ArrayBuffer;
  imageName: string;
  videoMime: string;
  timestampUs: number;
};

self.onmessage = (event: MessageEvent<AnalyzeRequest | MuxRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'analyze') {
      const analysis = analyzeBytes(new Uint8Array(request.buffer), request.fileName, request.mime);
      self.postMessage({ id: request.id, ok: true, value: analysis });
      return;
    }
    const output = muxSamsungMotionPhoto(new Uint8Array(request.image), new Uint8Array(request.video), {
      timestampUs: request.timestampUs,
      sourceVideoMime: request.videoMime,
    });
    const analysis = analyzeBytes(output, request.imageName, 'image/jpeg');
    self.postMessage({ id: request.id, ok: true, value: { buffer: output.buffer, analysis } }, [output.buffer]);
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
