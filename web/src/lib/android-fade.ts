async function sendImage(token: string, kind: string, file: File): Promise<void> {
  const bridge = window.AndroidBridge;
  if (!bridge) throw new Error('安卓编码通道不可用。');
  const chunkSize = 96 * 1024;
  for (let start = 0; start < file.size; start += chunkSize) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
      reader.onerror = () => reject(new Error('读取渐变画面失败。'));
      reader.readAsDataURL(file.slice(start, start + chunkSize));
    });
    if (!bridge.appendFadeTailChunk(token, kind, base64)) throw new Error('发送渐变画面失败。');
  }
}

export async function tryHardwareFadeTail(
  lastFrame: File,
  cover: File,
  width: number,
  height: number,
  duration: number,
  mime: string,
): Promise<File | null> {
  const bridge = window.AndroidBridge;
  if (!bridge?.beginFadeTail || !bridge.appendFadeTailChunk || !bridge.startFadeTail) return null;
  const token = bridge.beginFadeTail(width, height, Math.round(duration * 1000), mime);
  if (!token) return null;
  try {
    await Promise.all([sendImage(token, 'last', lastFrame), sendImage(token, 'cover', cover)]);
    if (!bridge.startFadeTail(token)) throw new Error('无法启动硬件编码。');
    for (;;) {
      const status = bridge.fadeTailStatus(token);
      if (status === 'done') break;
      if (status.startsWith('error:')) throw new Error(status.slice(6));
      if (status !== 'working') throw new Error('硬件编码状态异常。');
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    }
    const size = bridge.fadeTailSize(token);
    if (size <= 0) throw new Error('硬件编码未生成有效视频。');
    const chunks: ArrayBuffer[] = [];
    for (let offset = 0; offset < size; offset += 96 * 1024) {
      const encoded = bridge.readFadeTailChunk(token, offset, Math.min(96 * 1024, size - offset));
      if (!encoded) throw new Error('读取硬件编码结果失败。');
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      chunks.push(bytes.buffer);
    }
    return new File(chunks, 'fade-tail.mp4', { type: 'video/mp4' });
  } finally {
    bridge.finishFadeTail(token);
  }
}
