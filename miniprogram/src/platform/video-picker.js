function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const rawSeconds = String(totalSeconds % 60);
  const seconds = rawSeconds.length < 2 ? `0${rawSeconds}` : rawSeconds;
  return `${minutes}:${seconds}`;
}

function formatFileSize(value) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '大小未知';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getVideoName(file) {
  const path = String(file.tempFilePath || '');
  const pathName = path.split(/[\\/]/).pop().split('?')[0];
  const name = String(file.name || '').split(/[\\/]/).pop().trim();
  return name && name !== pathName ? name : '已选择视频';
}

function copyWxTempVideoToAppStorage(sourcePath) {
  if (!/^wxfile:\/\/temp\//i.test(sourcePath)
      || !wx.env || !wx.env.USER_DATA_PATH
      || typeof wx.getFileSystemManager !== 'function') {
    return Promise.resolve({ path: sourcePath, sourceTempPath: '' });
  }

  let fileSystemManager;
  try {
    fileSystemManager = wx.getFileSystemManager();
  } catch (_error) {
    return Promise.resolve({ path: sourcePath, sourceTempPath: '' });
  }
  if (!fileSystemManager || typeof fileSystemManager.copyFile !== 'function') {
    return Promise.resolve({ path: sourcePath, sourceTempPath: '' });
  }

  const extensionMatch = sourcePath.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  const extension = extensionMatch ? extensionMatch[1] : 'mp4';
  const targetPath = `${wx.env.USER_DATA_PATH}/selected-video-${Date.now()}-${Math.floor(Math.random() * 1000000)}.${extension}`;

  return new Promise((resolve) => {
    fileSystemManager.copyFile({
      srcPath: sourcePath,
      destPath: targetPath,
      success() {
        console.warn('[video-picker] copied wxfile temp video into app storage');
        resolve({ path: targetPath, sourceTempPath: sourcePath });
      },
      fail(error) {
        let detail = String((error && (error.errMsg || error.message)) || 'Unknown error');
        detail = detail.split(sourcePath).join('[selected video]');
        console.warn(`[video-picker] temp video copy failed; keeping original path: ${detail.slice(0, 200)}`);
        resolve({ path: sourcePath, sourceTempPath: '' });
      },
    });
  });
}

function chooseVideoFromAlbum() {
  return new Promise((resolve, reject) => {
    if (typeof wx.chooseMedia !== 'function') {
      const error = new Error('当前微信版本不支持从相册选择视频，请更新微信后重试。');
      error.code = 'VIDEO_PICKER_UNAVAILABLE';
      reject(error);
      return;
    }

    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album'],
      success(result) {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file || !file.tempFilePath) {
          const error = new Error('没有读取到所选视频，请重新选择。');
          error.code = 'VIDEO_NOT_RETURNED';
          reject(error);
          return;
        }

        const duration = Number(file.duration) || 0;
        const width = Number(file.width) || 0;
        const height = Number(file.height) || 0;
        console.warn(`[video-picker] selected metadata duration=${duration} width=${width} height=${height} size=${Number(file.size) || 0}`);
        copyWxTempVideoToAppStorage(file.tempFilePath).then((source) => {
          resolve({
            path: source.path,
            sourceTempPath: source.sourceTempPath,
            name: getVideoName(file),
            sizeBytes: Number(file.size) || 0,
            sizeLabel: formatFileSize(file.size),
            durationSeconds: duration,
            durationLabel: duration > 0 ? formatDuration(duration) : '时长未知',
            width,
            height,
            resolutionLabel: width > 0 && height > 0 ? `${width} × ${height}` : '尺寸未知',
            thumbnailPath: file.thumbTempFilePath || '',
          });
        });
      },
      fail: reject,
    });
  });
}

function isVideoPickerCanceled(error) {
  return Boolean(error && /cancel|取消/i.test(error.errMsg || error.message || ''));
}

module.exports = { chooseVideoFromAlbum, isVideoPickerCanceled };
