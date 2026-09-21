export {};

declare global {
  interface Window {
    AndroidBridge?: {
      beginSave(name: string): string;
      appendChunk(token: string, base64: string): boolean;
      finishSave(token: string): boolean;
      cancelSave(token: string): void;
    };
  }
}

