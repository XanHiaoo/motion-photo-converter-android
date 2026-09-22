export {};

declare global {
  interface Window {
    AndroidBridge?: {
      beginSave(name: string): string;
      appendChunk(token: string, base64: string): boolean;
      finishSave(token: string): boolean;
      cancelSave(token: string): void;
      beginFadeTail(width: number, height: number, durationMs: number, mime: string): string;
      appendFadeTailChunk(token: string, kind: string, base64: string): boolean;
      startFadeTail(token: string): boolean;
      fadeTailStatus(token: string): string;
      fadeTailSize(token: string): number;
      readFadeTailChunk(token: string, offset: number, length: number): string;
      finishFadeTail(token: string): void;
    };
  }
}
