const JPEG_TYPES = new Set(['image/jpeg', 'image/jpg']);

function extension(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

async function canvasToJpeg(source: Blob, name: string, targetWidth?: number, targetHeight?: number): Promise<File> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth ?? bitmap.width;
    canvas.height = targetHeight ?? bitmap.height;
    if (!Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width <= 0 || canvas.height <= 0) {
      throw new Error('目标图片尺寸无效。');
    }
    const context = canvas.getContext('2d');
    if (!context) throw new Error('\u5f53\u524d\u6d4f\u89c8\u5668\u65e0\u6cd5\u521b\u5efa\u56fe\u7247\u8f6c\u6362\u753b\u5e03\u3002');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('\u56fe\u7247\u8f6c\u6362\u4e3a JPEG \u5931\u8d25\u3002')), 'image/jpeg', 0.94);
    });
    return new File([blob], `${name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

export async function normalizeImage(file: File, onStage?: (stage: string) => void): Promise<File> {
  const ext = extension(file);
  if (JPEG_TYPES.has(file.type) || /jpe?g/i.test(ext)) return file;

  if (/(?:heic|heif)/i.test(ext) || /hei[cf]/i.test(file.type)) {
    onStage?.('\u6b63\u5728\u5c06 HEIC \u8f6c\u4e3a JPEG\u2026');
    try {
      const { heicTo } = await import('heic-to');
      const converted = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.94 });
      const blob = converted instanceof Blob ? converted : new Blob([converted], { type: 'image/jpeg' });
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
    } catch (error) {
      throw new Error(`HEIC \u8f6c\u6362\u5931\u8d25\uff1a${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (ext === 'png' || file.type === 'image/png') {
    onStage?.('\u6b63\u5728\u5c06 PNG \u8f6c\u4e3a JPEG\u2026');
    return canvasToJpeg(file, file.name);
  }

  throw new Error('\u56fe\u7247\u683c\u5f0f\u4e0d\u652f\u6301\uff0c\u8bf7\u9009\u62e9 JPG\u3001JPEG\u3001HEIC\u3001HEIF \u6216 PNG\u3002');
}

export async function resizeImageToSize(file: File, width: number, height: number, onStage?: (stage: string) => void): Promise<File> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('视频尺寸无效。');
  }
  onStage?.('\u6b63\u5728\u5c06\u56fe\u7247\u8c03\u6574\u4e3a\u89c6\u9891\u5c3a\u5bf8\u2026');
  return canvasToJpeg(file, file.name, width, height);
}
