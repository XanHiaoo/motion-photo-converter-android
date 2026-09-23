const MAX_FRAME_PIXELS = 10000000;
const FRAME_POLL_INTERVAL_MS = 16;
const FRAME_WAIT_TIMEOUT_MS = 8000;

function throwIfCanceled(shouldCancel) {
  if (shouldCancel && shouldCancel()) {
    const error = new Error('封面提取已取消。');
    error.code = 'FRAME_CAPTURE_CANCELED';
    throw error;
  }
}

function waitForDecodedFrame(decoder, shouldCancel) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      try {
        throwIfCanceled(shouldCancel);
      } catch (error) {
        reject(error);
        return;
      }

      let frame = null;
      try {
        frame = decoder.getFrameData();
      } catch (error) {
        reject(error);
        return;
      }

      if (frame && frame.data && frame.width > 0 && frame.height > 0) {
        resolve(frame);
        return;
      }
      if (Date.now() - startedAt >= FRAME_WAIT_TIMEOUT_MS) {
        const error = new Error('等待视频解码帧超时，请换一个时间点或 H.264 MP4 视频。');
        error.code = 'VIDEO_FRAME_TIMEOUT';
        reject(error);
        return;
      }
      setTimeout(poll, FRAME_POLL_INTERVAL_MS);
    };
    poll();
  });
}

function getOrientedDimensions(width, height, orientation) {
  const rotated = orientation === 'left' || orientation === 'right'
    || orientation === 'left-mirrored' || orientation === 'right-mirrored';
  return rotated ? { width: height, height: width } : { width, height };
}

function drawOrientedFrame(sourceCanvas, outputCanvas, width, height, orientation) {
  const size = getOrientedDimensions(width, height, orientation);
  outputCanvas.width = size.width;
  outputCanvas.height = size.height;

  const context = outputCanvas.getContext('2d');
  if (!context) throw new Error('当前微信环境无法创建 2D 画布。');
  context.clearRect(0, 0, size.width, size.height);
  context.save();
  context.translate(size.width / 2, size.height / 2);

  switch (orientation) {
    case 'down':
      context.rotate(Math.PI);
      break;
    case 'up-mirrored':
      context.scale(-1, 1);
      break;
    case 'down-mirrored':
      context.scale(1, -1);
      break;
    case 'left':
      context.rotate(-Math.PI / 2);
      break;
    case 'right':
      context.rotate(Math.PI / 2);
      break;
    case 'left-mirrored':
      context.scale(1, -1);
      context.rotate(-Math.PI / 2);
      break;
    case 'right-mirrored':
      context.scale(1, -1);
      context.rotate(Math.PI / 2);
      break;
    default:
      break;
  }

  context.drawImage(sourceCanvas, -width / 2, -height / 2, width, height);
  context.restore();
  return size;
}

function canvasToJpeg(canvas, width, height) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width,
      height,
      destWidth: width,
      destHeight: height,
      fileType: 'jpg',
      quality: 0.95,
      success(result) {
        if (!result || !result.tempFilePath) {
          reject(new Error('微信没有返回封面 JPEG 文件，请重试。'));
          return;
        }
        resolve(result.tempFilePath);
      },
      fail: reject,
    });
  });
}

async function captureVideoFrameToJpeg(sourcePath, seconds, orientation, sourceCanvas, outputCanvas, shouldCancel) {
  if (typeof wx.createVideoDecoder !== 'function') {
    const error = new Error('当前微信版本不支持逐帧取图，请更新微信后重试。');
    error.code = 'VIDEO_DECODER_UNAVAILABLE';
    throw error;
  }
  if (!sourceCanvas || !outputCanvas
      || typeof sourceCanvas.getContext !== 'function'
      || typeof outputCanvas.getContext !== 'function') {
    const error = new Error('封面画布尚未初始化，请返回后重试。');
    error.code = 'FRAME_CANVAS_UNAVAILABLE';
    throw error;
  }

  let decoder = null;
  let didStart = false;
  try {
    throwIfCanceled(shouldCancel);
    decoder = wx.createVideoDecoder();
    if (!decoder) {
      const error = new Error('微信没有创建视频解码器，请重试。');
      error.code = 'VIDEO_DECODER_CREATE_FAILED';
      throw error;
    }

    const startOptions = { source: sourcePath, mode: 0 };
    if (typeof wx.canIUse === 'function'
        && wx.canIUse('VideoDecoder.start.object.abortAudio')) startOptions.abortAudio = true;
    const startInfo = await decoder.start(startOptions);
    didStart = true;
    throwIfCanceled(shouldCancel);
    await decoder.seek(Math.max(0, Math.round(seconds * 1000)));
    throwIfCanceled(shouldCancel);
    const frame = await waitForDecodedFrame(decoder, shouldCancel);
    throwIfCanceled(shouldCancel);
    const width = Number(frame.width) || 0;
    const height = Number(frame.height) || 0;
    if (!width || !height || width > MAX_FRAME_PIXELS / height) {
      const error = new Error('视频分辨率过高，当前无法安全导出封面。请先将视频缩小后重试。');
      error.code = 'VIDEO_FRAME_TOO_LARGE';
      throw error;
    }

    const frameBytes = ArrayBuffer.isView(frame.data)
      ? new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
      : frame.data instanceof ArrayBuffer
        || Object.prototype.toString.call(frame.data) === '[object ArrayBuffer]'
        ? new Uint8Array(frame.data)
        : null;
    if (!frameBytes || frameBytes.byteLength !== width * height * 4) {
      const error = new Error('当前视频解码器返回了不支持的像素格式，请换用 H.264 MP4。');
      error.code = 'VIDEO_FRAME_FORMAT_UNSUPPORTED';
      throw error;
    }

    throwIfCanceled(shouldCancel);
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceContext = sourceCanvas.getContext('2d');
    if (!sourceContext) throw new Error('当前微信环境无法创建 2D 画布。');
    const imageData = sourceContext.createImageData(width, height);
    imageData.data.set(frameBytes);
    sourceContext.putImageData(imageData, 0, 0);

    const outputSize = drawOrientedFrame(sourceCanvas, outputCanvas, width, height, orientation || 'up');
    const path = await canvasToJpeg(outputCanvas, outputSize.width, outputSize.height);
    return {
      path,
      width: outputSize.width,
      height: outputSize.height,
      rawPts: Number.isFinite(frame.pkPts) ? frame.pkPts : null,
      rawDts: Number.isFinite(frame.pkDts) ? frame.pkDts : null,
      decoderWidth: Number(startInfo && startInfo.width) || width,
      decoderHeight: Number(startInfo && startInfo.height) || height,
    };
  } finally {
    if (decoder && didStart) {
      try { await decoder.stop(); } catch (_error) { /* remove below releases the decoder */ }
    }
    if (decoder) {
      try { await decoder.remove(); } catch (_error) { /* decoder may already be stopped */ }
    }
    if (sourceCanvas) {
      sourceCanvas.width = 1;
      sourceCanvas.height = 1;
    }
    if (outputCanvas) {
      outputCanvas.width = 1;
      outputCanvas.height = 1;
    }
  }
}

module.exports = { captureVideoFrameToJpeg };
