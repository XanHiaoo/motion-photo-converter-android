const app = getApp();
const { getLayoutInsets } = require('../../platform/system-info');
const { createInitialVideoState, VIDEO_FLOW_STATES } = require('../../features/video-flow/state');
const { chooseVideoFromAlbum, isVideoPickerCanceled } = require('../../platform/video-picker');
const { inspectVideoSource } = require('../../platform/video-info');
const { captureVideoFrameToJpeg } = require('../../platform/video-frame');

function formatFrameTime(value) {
  const numeric = Number(value);
  const time = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  const minutes = String(Math.floor(time / 60));
  const secondsValue = (time % 60).toFixed(1);
  const minutesLabel = minutes.length < 2 ? `0${minutes}` : minutes;
  const seconds = secondsValue.length < 4 ? `0${secondsValue}` : secondsValue;
  return `${minutesLabel}:${seconds}`;
}

function getErrorMessage(error, fallback, stage) {
  const code = error && error.code;
  const raw = String((error && (error.errMsg || error.message)) || '').trim();

  if (code === 'FRAME_CAPTURE_CANCELED') return '';
  if (/开发者工具|developer tools?/i.test(raw)
      && /(不支持|unsupported|not support|api|调试|debug)/i.test(raw)) {
    return '开发者工具无法运行逐帧取图，请使用已配置 AppID 的微信真机预览。';
  }
  if (code === 'VIDEO_PICKER_UNAVAILABLE' || code === 'VIDEO_DECODER_UNAVAILABLE') {
    return raw || fallback;
  }
  if (code === 'UNSUPPORTED_VIDEO_CONTAINER' || code === 'VIDEO_METADATA_UNAVAILABLE'
      || code === 'FRAME_CANVAS_UNAVAILABLE' || code === 'VIDEO_FRAME_TOO_LARGE'
      || code === 'VIDEO_FRAME_FORMAT_UNSUPPORTED' || code === 'VIDEO_FRAME_TIMEOUT') {
    return raw || fallback;
  }
  if (stage === 'preview') {
    return '视频预览失败。请换用微信可播放的 MP4 视频，或重新选择视频。';
  }
  if (stage === 'capture' && /(decode|codec|解码|video.?decoder|视频解码)/i.test(raw)) {
    return '无法解码此视频封面，请换用 H.264 编码的 MP4 视频。';
  }
  if (/fail(?:ed)?\b|errcode|system error/i.test(raw)) return fallback;
  return raw && raw.length <= 160 ? raw : fallback;
}

function removeTemporaryFile(filePath) {
  if (!filePath) return;
  try {
    wx.getFileSystemManager().unlink({ filePath, fail() {} });
  } catch (_error) {
    // A temp file may already be removed by the runtime.
  }
}

function removeTemporaryFiles(filePaths, keepPath) {
  const seen = new Set();
  (filePaths || []).forEach((filePath) => {
    if (!filePath || filePath === keepPath || seen.has(filePath)) return;
    seen.add(filePath);
    removeTemporaryFile(filePath);
  });
}

Page({
  data: {
    insets: {},
    flow: createInitialVideoState(),
    video: null,
    videoInfo: null,
    picking: false,
    importStage: 'idle',
    pickingLabel: '选择一个视频',
    importError: '',
    previewStatus: 'idle',
    previewPlaying: false,
    previewError: '',
    coverTimeLabel: '00:00.0',
    sliderMaxSeconds: 0.05,
    coverPreviewPath: '',
    coverFrameInfo: null,
    capturingCover: false,
    coverError: '',
    showJpegResult: false,
  },

  onLoad() {
    this.isUnloading = false;
    this.importRequestId = 0;
    this.frameRequestId = 0;
    this.retiredTemporaryPaths = [];
    this.pendingPreviewSeek = null;
    this.videoReady = false;
    this.setData({
      insets: app.globalData.layoutInsets || getLayoutInsets(),
    });
  },

  onReady() {
    this.initializeFrameCanvases();
  },

  initializeFrameCanvases() {
    if (this.isUnloading) return Promise.resolve(false);
    if (this.sourceCanvas && this.outputCanvas) return Promise.resolve(true);
    if (this.frameCanvasPromise) return this.frameCanvasPromise;

    this.frameCanvasPromise = new Promise((resolve) => {
      try {
        const query = wx.createSelectorQuery();
        query.select('#frame-source-canvas').fields({ node: true });
        query.select('#frame-output-canvas').fields({ node: true });
        query.exec((result) => {
          if (this.isUnloading) {
            this.frameCanvasPromise = null;
            resolve(false);
            return;
          }
          this.sourceCanvas = result && result[0] && result[0].node;
          this.outputCanvas = result && result[1] && result[1].node;
          this.canvasReady = Boolean(this.sourceCanvas && this.outputCanvas);
          if (!this.canvasReady) {
            console.error('[M2] Could not resolve frame canvases', {
              resultCount: result && result.length,
              sourceNode: Boolean(result && result[0] && result[0].node),
              outputNode: Boolean(result && result[1] && result[1].node),
            });
            this.frameCanvasPromise = null;
          }
          resolve(this.canvasReady);
        });
      } catch (error) {
        console.error('[M2] Frame canvas query failed', error);
        this.frameCanvasPromise = null;
        resolve(false);
      }
    });

    return this.frameCanvasPromise;
  },

  goBack() {
    this.pausePreview();
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.reLaunch({ url: '/src/pages/home/index' });
  },

  isCurrentImport(requestId) {
    return !this.isUnloading && requestId === this.importRequestId;
  },

  async onChooseVideo() {
    if (this.data.picking || this.data.capturingCover || this.isUnloading) return;
    const requestId = ++this.importRequestId;
    this.importFlowBeforeRequest = this.data.flow;
    this.pausePreview();
    const preparingFlow = this.data.video
      ? this.data.flow
      : Object.assign({}, this.data.flow, { status: VIDEO_FLOW_STATES.ANALYZING, error: null });
    this.setData({
      picking: true,
      importStage: 'choosing',
      pickingLabel: '正在打开视频',
      importError: '',
      flow: preparingFlow,
    });

    let video;
    try {
      video = await chooseVideoFromAlbum();
    } catch (error) {
      if (!this.isCurrentImport(requestId)) return;
      const canceled = isVideoPickerCanceled(error);
      const message = canceled ? '' : getErrorMessage(
        error,
        '无法打开本机视频选择器，请更新微信后重试。',
        'import',
      );
      const restoredFlow = this.data.video
        ? this.data.flow
        : (this.importFlowBeforeRequest || createInitialVideoState());
      const nextFlow = message && !this.data.video
        ? Object.assign({}, restoredFlow, { status: VIDEO_FLOW_STATES.ERROR, error: message })
        : restoredFlow;
      this.importFlowBeforeRequest = null;
      this.setData({
        picking: false,
        importStage: 'idle',
        pickingLabel: this.data.video ? '更换视频' : '选择一个视频',
        importError: message,
        flow: nextFlow,
      });
      return;
    }

    if (!this.isCurrentImport(requestId)) {
      removeTemporaryFiles([video.path], this.data.video && this.data.video.path);
      return;
    }
    this.setData({
      importStage: 'analyzing',
      pickingLabel: '正在读取视频信息',
    });

    let videoInfo;
    try {
      videoInfo = await inspectVideoSource(video.path, video);
    } catch (error) {
      if (!this.isCurrentImport(requestId)) {
        removeTemporaryFiles([video.path], this.data.video && this.data.video.path);
        return;
      }
      const message = getErrorMessage(
        error,
        '无法读取视频信息，请重新选择 MP4 视频。',
        'import',
      );
      removeTemporaryFiles([video.path], this.data.video && this.data.video.path);
      const baseFlow = this.data.video
        ? this.data.flow
        : (this.importFlowBeforeRequest || createInitialVideoState());
      const nextFlow = this.data.video
        ? baseFlow
        : Object.assign({}, baseFlow, { status: VIDEO_FLOW_STATES.ERROR, error: message });
      this.importFlowBeforeRequest = null;
      this.setData({
        picking: false,
        importStage: 'idle',
        pickingLabel: this.data.video ? '更换视频' : '选择一个视频',
        importError: message,
        flow: nextFlow,
      });
      return;
    }

    if (!this.isCurrentImport(requestId)) {
      removeTemporaryFiles([video.path], this.data.video && this.data.video.path);
      return;
    }

    const previousVideo = this.data.video;
    const previousPreviewPath = this.data.coverPreviewPath;
    this.retiredTemporaryPaths = (this.retiredTemporaryPaths || []).concat([
      previousVideo && previousVideo.path,
      previousVideo && previousVideo.thumbnailPath,
      previousPreviewPath,
      this.data.flow && this.data.flow.outputPath,
    ]);
    this.frameRequestId += 1;
    const displayWidth = videoInfo.displayWidth || videoInfo.width;
    const displayHeight = videoInfo.displayHeight || videoInfo.height;
    const durationSeconds = videoInfo.durationSeconds || video.durationSeconds;
    const selectedVideo = Object.assign({}, video, {
      width: displayWidth,
      height: displayHeight,
      durationSeconds,
      durationLabel: formatFrameTime(durationSeconds),
      resolutionLabel: `${displayWidth} × ${displayHeight}`,
    });
    const flow = Object.assign(createInitialVideoState(), {
      status: VIDEO_FLOW_STATES.READY,
      source: video.path,
      durationSeconds,
      width: displayWidth,
      height: displayHeight,
      orientation: videoInfo.orientation,
      fps: videoInfo.fps,
      coverTimeSeconds: 0,
    });

    this.importFlowBeforeRequest = null;
    this.setData({
      video: selectedVideo,
      videoInfo,
      flow,
      picking: false,
      importStage: 'idle',
      pickingLabel: '更换视频',
      importError: '',
      previewStatus: 'loading',
      previewPlaying: false,
      previewError: '',
      coverTimeLabel: '00:00.0',
      sliderMaxSeconds: Math.max(0, durationSeconds - Math.min(0.05, durationSeconds * 0.01)),
      coverPreviewPath: '',
      coverFrameInfo: null,
      coverError: '',
      capturingCover: false,
      showJpegResult: false,
    }, () => {
      if (this.isUnloading || !this.data.video || this.data.video.path !== video.path) return;
      this.videoReady = false;
      this.pendingPreviewSeek = 0;
      try {
        this.videoContext = wx.createVideoContext('source-video', this);
      } catch (error) {
        this.setData({
          previewStatus: 'error',
          previewError: getErrorMessage(error, '无法初始化视频预览。', 'preview'),
        });
      }
      removeTemporaryFiles(this.retiredTemporaryPaths, video.path);
      this.retiredTemporaryPaths = [];
      this.captureCoverAt(0);
    });
  },

  isCurrentFrameRequest(requestId, sourcePath) {
    return !this.isUnloading
      && requestId === this.frameRequestId
      && Boolean(this.data.video)
      && this.data.video.path === sourcePath;
  },

  onVideoLoadedMetadata() {
    if (this.isUnloading || !this.data.video) return;
    this.videoReady = true;
    this.setData({ previewStatus: this.data.previewError ? 'error' : 'ready' });
    this.applyPendingPreviewSeek();
  },

  onPreviewPlay() {
    if (this.isUnloading) return;
    this.setData({ previewPlaying: true, previewStatus: 'ready', previewError: '' });
  },

  onPreviewPause() {
    if (!this.isUnloading) this.setData({ previewPlaying: false });
  },

  onPreviewEnded() {
    if (!this.isUnloading) this.setData({ previewPlaying: false });
  },

  togglePreviewPlayback() {
    if (this.isUnloading || !this.data.video || this.data.capturingCover || !this.videoContext) return;
    if (this.data.previewPlaying) {
      this.pausePreview();
      return;
    }
    try {
      this.setData({ previewError: '' });
      this.videoContext.play();
    } catch (error) {
      const message = getErrorMessage(error, '无法播放此视频，请重新选择。', 'preview');
      this.setData({ previewStatus: 'error', previewError: message, previewPlaying: false });
    }
  },

  pausePreview() {
    if (this.videoContext) {
      try { this.videoContext.pause(); } catch (_error) { /* page may be leaving */ }
    }
    if (!this.isUnloading && this.data.previewPlaying) this.setData({ previewPlaying: false });
  },

  seekPreview(seconds) {
    const target = Math.max(0, Math.min(
      this.data.sliderMaxSeconds,
      Number(seconds) || 0,
    ));
    this.pendingPreviewSeek = target;
    this.applyPendingPreviewSeek();
  },

  applyPendingPreviewSeek() {
    if (!this.videoReady || !this.videoContext || this.pendingPreviewSeek === null) return;
    const target = this.pendingPreviewSeek;
    this.pendingPreviewSeek = null;
    try { this.videoContext.seek(target); } catch (_error) { /* preview can still be used for frame extraction */ }
  },

  onVideoError(event) {
    const message = getErrorMessage(
      event && event.detail,
      '视频预览失败。请换用微信可播放的 MP4 视频，或重新选择视频。',
      'preview',
    );
    if (!this.isUnloading) {
      this.setData({ previewStatus: 'error', previewError: message, previewPlaying: false });
    }
  },

  onCoverChange(event) {
    if (!this.data.video || this.data.capturingCover) return;
    const requested = Number(event.detail && event.detail.value) || 0;
    const seconds = Math.max(0, Math.min(this.data.sliderMaxSeconds, Math.round(requested * 20) / 20));
    this.pausePreview();
    this.seekPreview(seconds);
    this.captureCoverAt(seconds);
  },

  async captureCoverAt(seconds) {
    if (!this.data.video || !this.data.videoInfo) return;
    const sourcePath = this.data.video.path;
    const previousPreviewPath = this.data.coverPreviewPath;
    const requestId = (this.frameRequestId || 0) + 1;
    this.frameRequestId = requestId;
    const coverTimeSeconds = Math.max(0, Math.min(this.data.sliderMaxSeconds, Number(seconds) || 0));
    const orientation = this.data.videoInfo.orientation;
    const flow = Object.assign({}, this.data.flow, {
      status: VIDEO_FLOW_STATES.WORKING,
      coverTimeSeconds,
      coverPath: null,
      outputPath: null,
      error: null,
    });
    this.setData({
      flow,
      capturingCover: true,
      coverTimeLabel: formatFrameTime(coverTimeSeconds),
      coverPreviewPath: '',
      coverFrameInfo: null,
      coverError: '',
      showJpegResult: false,
    });
    if (previousPreviewPath) removeTemporaryFile(previousPreviewPath);

    try {
      const canvasesReady = await this.initializeFrameCanvases();
      if (!this.isCurrentFrameRequest(requestId, sourcePath)) return;
      if (!canvasesReady || !this.sourceCanvas || !this.outputCanvas) {
        const error = new Error('封面处理画布尚未准备好，请稍后重试。');
        error.code = 'FRAME_CANVAS_UNAVAILABLE';
        throw error;
      }
      const frame = await captureVideoFrameToJpeg(
        sourcePath,
        coverTimeSeconds,
        orientation,
        this.sourceCanvas,
        this.outputCanvas,
        () => !this.isCurrentFrameRequest(requestId, sourcePath),
      );
      if (!this.isCurrentFrameRequest(requestId, sourcePath)) {
        removeTemporaryFile(frame.path);
        return;
      }

      const coverFrameInfo = Object.assign({}, frame, { requestedSeconds: coverTimeSeconds });
      const readyFlow = Object.assign({}, this.data.flow, { status: VIDEO_FLOW_STATES.READY });
      this.setData({
        flow: readyFlow,
        capturingCover: false,
        coverPreviewPath: frame.path,
        coverFrameInfo,
        coverError: '',
      });
    } catch (error) {
      if (!this.isCurrentFrameRequest(requestId, sourcePath)) return;
      const message = getErrorMessage(error, '无法生成封面帧，请重新选择视频或时间点。', 'capture');
      const errorFlow = Object.assign({}, this.data.flow, {
        status: VIDEO_FLOW_STATES.ERROR,
        error: message,
      });
      this.setData({
        flow: errorFlow,
        capturingCover: false,
        coverPreviewPath: '',
        coverFrameInfo: null,
        coverError: message,
      });
    }
  },

  retryCoverCapture() {
    if (!this.data.video || this.data.capturingCover) return;
    this.captureCoverAt(this.data.flow.coverTimeSeconds || 0);
  },

  onGenerateCover() {
    const frame = this.data.coverFrameInfo;
    if (!this.data.video || !frame || !frame.path || this.data.capturingCover || this.data.showJpegResult) return;
    const flow = Object.assign({}, this.data.flow, {
      status: VIDEO_FLOW_STATES.SUCCESS,
      coverPath: frame.path,
      outputPath: frame.path,
      error: null,
    });
    this.setData({ flow, showJpegResult: true });
    console.info('[M2] Exported cover JPEG', {
      source: this.data.video.path,
      targetSeconds: frame.requestedSeconds,
      rawPts: frame.rawPts,
      rawDts: frame.rawDts,
      width: frame.width,
      height: frame.height,
    });
  },

  onPreviewJpeg() {
    const path = this.data.flow.outputPath;
    if (!path) return;
    wx.previewImage({
      current: path,
      urls: [path],
      fail: (error) => wx.showToast({
        title: getErrorMessage(error, '无法预览封面 JPEG。', 'preview'),
        icon: 'none',
      }),
    });
  },

  onHide() {
    this.pausePreview();
  },

  onUnload() {
    this.isUnloading = true;
    this.importRequestId = (this.importRequestId || 0) + 1;
    this.frameRequestId = (this.frameRequestId || 0) + 1;
    if (this.videoContext) {
      try { this.videoContext.pause(); } catch (_error) { /* page is being destroyed */ }
    }
    const video = this.data.video || {};
    removeTemporaryFiles([
      video.path,
      video.thumbnailPath,
      this.data.coverPreviewPath,
      this.data.coverFrameInfo && this.data.coverFrameInfo.path,
      this.data.flow && this.data.flow.outputPath,
    ].concat(this.retiredTemporaryPaths || []));
    if (this.sourceCanvas) {
      this.sourceCanvas.width = 1;
      this.sourceCanvas.height = 1;
    }
    if (this.outputCanvas) {
      this.outputCanvas.width = 1;
      this.outputCanvas.height = 1;
    }
    this.sourceCanvas = null;
    this.outputCanvas = null;
    this.videoContext = null;
    this.frameCanvasPromise = null;
  },
});
