export interface VideoDimensions {
  width: number;
  height: number;
}

export async function readVideoDimensions(file: File): Promise<VideoDimensions> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;

  try {
    const dimensions = await new Promise<VideoDimensions>((resolve, reject) => {
      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
      };
      video.onloadedmetadata = () => {
        if (!video.videoWidth || !video.videoHeight) {
          cleanup();
          reject(new Error('无法读取视频尺寸。'));
          return;
        }
        cleanup();
        resolve({ width: video.videoWidth, height: video.videoHeight });
      };
      video.onerror = () => {
        cleanup();
        reject(new Error('无法读取所选视频的尺寸。'));
      };
      video.src = url;
      video.load();
    });
    return dimensions;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
