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

function readUint32(bytes, offset) {
  return bytes[offset] * 0x1000000
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3];
}

function getMp4MajorBrand(data) {
  const bytes = asByteView(data);
  if (!bytes) return '';

  let offset = 0;
  let boxesRead = 0;
  while (offset + 8 <= bytes.length && boxesRead < 16) {
    const size32 = readUint32(bytes, offset);
    const isFileTypeBox = bytes[offset + 4] === 0x66
      && bytes[offset + 5] === 0x74
      && bytes[offset + 6] === 0x79
      && bytes[offset + 7] === 0x70;
    let boxSize = size32;
    let headerSize = 8;

    if (size32 === 1) {
      if (offset + 16 > bytes.length) return '';
      const high = readUint32(bytes, offset + 8);
      const low = readUint32(bytes, offset + 12);
      boxSize = high * 0x100000000 + low;
      headerSize = 16;
    }

    if (isFileTypeBox) {
      const minimumSize = headerSize + 8;
      if (boxSize < minimumSize || offset + minimumSize > bytes.length) return '';
      return String.fromCharCode(
        bytes[offset + headerSize],
        bytes[offset + headerSize + 1],
        bytes[offset + headerSize + 2],
        bytes[offset + headerSize + 3],
      );
    }

    if (boxSize === 0 || boxSize < headerSize || offset + boxSize > bytes.length) return '';
    offset += boxSize;
    boxesRead += 1;
  }
  return '';
}

function orientDimensions(width, height, orientation) {
  const rotated = orientation === 'left' || orientation === 'right'
    || orientation === 'left-mirrored' || orientation === 'right-mirrored';
  return rotated ? { width: height, height: width } : { width, height };
}

async function inspectVideoSource(sourcePath, pickerInfo) {
  if (!sourcePath) {
    const error = new Error('没有读取到视频文件，请重新选择。');
    error.code = 'VIDEO_PATH_MISSING';
    throw error;
  }

  const results = await Promise.all([
    getVideoInfo(sourcePath),
    readVideoPrefix(sourcePath),
  ]);
  const info = results[0];
  const header = results[1];
  const majorBrand = getMp4MajorBrand(header);
  const reportedType = String(info.type || '').toLowerCase();
  if (!majorBrand || majorBrand === 'qt  ' || reportedType === 'mov') {
    const error = new Error('当前先支持 MP4 视频，MOV 暂不支持。请重新选择 MP4 文件。');
    error.code = 'UNSUPPORTED_VIDEO_CONTAINER';
    throw error;
  }

  const fallback = pickerInfo || {};
  const width = Number(info.width) || Number(fallback.width) || 0;
  const height = Number(info.height) || Number(fallback.height) || 0;
  const displaySize = orientDimensions(width, height, info.orientation || 'up');
  const duration = Number(info.duration) || Number(fallback.durationSeconds) || 0;
  if (!width || !height || !duration) {
    const error = new Error('无法读取视频时长或画面尺寸，请尝试其他 MP4 视频。');
    error.code = 'VIDEO_METADATA_UNAVAILABLE';
    throw error;
  }

  return {
    width,
    height,
    displayWidth: displaySize.width,
    displayHeight: displaySize.height,
    durationSeconds: duration,
    fps: Number(info.fps) || 0,
    orientation: info.orientation || 'up',
    containerType: info.type || majorBrand.trim() || 'mp4',
  };
}

module.exports = { inspectVideoSource };
