const MP4_HEADER_BYTES = 4096;

function getVideoInfo(sourcePath) {
  return new Promise((resolve, reject) => {
    wx.getVideoInfo({
      src: sourcePath,
      success: resolve,
      fail: reject,
    });
  });
}

function readVideoPrefix(sourcePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: sourcePath,
      position: 0,
      length: MP4_HEADER_BYTES,
      success(result) {
        resolve(result.data);
      },
      fail: reject,
    });
  });
}

function asByteView(data) {
  const isArrayBuffer = data instanceof ArrayBuffer
    || Object.prototype.toString.call(data) === '[object ArrayBuffer]';
  if (isArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

function containsMp4FileTypeBox(data) {
  const bytes = asByteView(data);
  if (!bytes) return false;
  for (let index = 4; index <= bytes.length - 4; index += 1) {
    if (bytes[index] === 0x66 && bytes[index + 1] === 0x74 && bytes[index + 2] === 0x79 && bytes[index + 3] === 0x70) {
      return true;
    }
  }
  return false;
}

function orientDimensions(width, height, orientation) {
  const rotated = orientation === 'left' || orientation === 'right'
    || orientation === 'left-mirrored' || orientation === 'right-mirrored';
  return rotated ? { width: height, height: width } : { width, height };
}

async function inspectVideoSource(sourcePath) {
  const results = await Promise.all([
    getVideoInfo(sourcePath),
    readVideoPrefix(sourcePath),
  ]);
  const info = results[0];
  const header = results[1];
  if (!containsMp4FileTypeBox(header)) {
    throw new Error('当前版本需要带 MP4 媒体结构的视频，请选择可解码的 H.264 MP4。');
  }

  const width = Number(info.width) || 0;
  const height = Number(info.height) || 0;
  const displaySize = orientDimensions(width, height, info.orientation || 'up');
  const duration = Number(info.duration) || 0;
  if (!width || !height || !duration) {
    throw new Error('无法读取视频时长或画面尺寸，请尝试其他 MP4 视频。');
  }

  return {
    width,
    height,
    displayWidth: displaySize.width,
    displayHeight: displaySize.height,
    durationSeconds: duration,
    fps: Number(info.fps) || 0,
    orientation: info.orientation || 'up',
    containerType: info.type || 'mp4',
  };
}

module.exports = { inspectVideoSource };
