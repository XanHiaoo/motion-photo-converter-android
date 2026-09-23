const MAX_FRAME_PIXELS = 10000000;
const FRAME_POLL_INTERVAL_MS = 16;
const FRAME_WAIT_TIMEOUT_MS = 8000;

function waitForDecodedFrame(decoder) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
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
        reject(new Error('等待视频解码帧超时，请换一个时间点或 H.264 MP4 视频。'));
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
        resolve(result.tempFilePath);
      },
      fail: reject,
    });
  });
}

async function captureVideoFrameToJpeg(sourcePath, seconds, orientation, sourceCanvas, outputCanvas) {
  if (typeof wx.createVideoDecoder !== 'function') {
    throw new Error('当前微信基础库不支持逐帧取图，请更新微信后重试。');
  }
  if (!sourceCanvas || !outputCanvas
      || typeof sourceCanvas.getContext !== 'function'
      || typeof outputCanvas.getContext !== 'function') {
    throw new Error('画布尚未初始化，请返回后重试。');
  }

  const decoder = wx.createVideoDecoder();
  let didStart = false;
  try {
    const startOptions = { source: sourcePath, mode: 0 };
    if (wx.canIUse('VideoDecoder.start.object.abortAudio')) startOptions.abortAudio = true;
    const startInfo = await decoder.start(startOptions);
    didStart = true;
    await decoder.seek(Math.max(0, Math.round(seconds * 1000)));
    const frame = await waitForDecodedFrame(decoder);
    const width = Number(frame.width) || 0;
    const height = Number(frame.height) || 0;
    if (!width || !height || width * height > MAX_FRAME_PIXELS) {
      throw new Error('视频分辨率过高，当前无法安全导出封面。请先将视频缩小后重试。');
    }

    const frameBytes = new Uint8Array(frame.data);
    if (frameBytes.byteLength !== width * height * 4) {
      throw new Error('当前视频解码器返回了不支持的像素格式，请换用 H.264 MP4。');
    }

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
    if (didStart) {
      try { await decoder.stop(); } catch (_error) { /* remove below releases the decoder */ }
    }
    try { await decoder.remove(); } catch (_error) { /* decoder may already be stopped */ }
    sourceCanvas.width = 1;
    sourceCanvas.height = 1;
    outputCanvas.width = 1;
    outputCanvas.height = 1;
  }
}

module.exports = { captureVideoFrameToJpeg };
