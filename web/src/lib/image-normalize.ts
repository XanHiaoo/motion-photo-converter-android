const JPEG_TYPES = new Set(['image/jpeg', 'image/jpg']);

function extension(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

async function canvasToJpeg(source: Blob, name: string): Promise<File> {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建图片转换画布。');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('图片转换为 JPEG 失败。')), 'image/jpeg', 0.94);
  });
  return new File([blob], `${name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

export async function normalizeImage(file: File, onStage?: (stage: string) => void): Promise<File> {
  const ext = extension(file);
  if (JPEG_TYPES.has(file.type) || /jpe?g/i.test(ext)) return file;

  if (/(?:heic|heif)/i.test(ext) || /hei[cf]/i.test(file.type)) {
    onStage?.('正在将 HEIC 转为 JPEG…');
    try {
      const { heicTo } = await import('heic-to');
      const converted = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.94 });
      const blob = converted instanceof Blob ? converted : new Blob([converted], { type: 'image/jpeg' });
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
    } catch (error) {
      throw new Error(`HEIC 转换失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (ext === 'png' || file.type === 'image/png') {
    onStage?.('正在将 PNG 转为 JPEG…');
    return canvasToJpeg(file, file.name);
  }

  throw new Error('图片格式不支持，请选择 JPG、JPEG、HEIC、HEIF 或 PNG。');
}
