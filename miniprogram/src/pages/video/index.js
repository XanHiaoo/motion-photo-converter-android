const app = getApp();
const { getLayoutInsets } = require('../../platform/system-info');
const { createInitialVideoState, VIDEO_FLOW_STATES } = require('../../features/video-flow/state');
const { chooseVideoFromAlbum, isVideoPickerCanceled } = require('../../platform/video-picker');
const { inspectVideoSource } = require('../../platform/video-info');
const { captureVideoFrameToJpeg } = require('../../platform/video-frame');

function formatFrameTime(value) {
  const time = Math.max(0, Number(value) || 0);
  const minutes = String(Math.floor(time / 60));
  const secondsValue = (time % 60).toFixed(1);
  const minutesLabel = minutes.length < 2 ? `0${minutes}` : minutes;
  const seconds = secondsValue.length < 4 ? `0${secondsValue}` : secondsValue;
  return `${minutesLabel}:${seconds}`;
}

function getErrorMessage(error, fallback) {
  return String((error && (error.errMsg || error.message)) || fallback);
}

function removeTemporaryFile(filePath) {
  if (!filePath) return;
  try {
    wx.getFileSystemManager().unlink({ filePath, fail() {} });
  } catch (_error) {
    // A temp file may already be removed by the runtime.
  }
}

Page({
  data: {
    insets: {},
    flow: createInitialVideoState(),
    video: null,
    videoInfo: null,
    picking: false,
    coverTimeLabel: '00:00.0',
    sliderMaxSeconds: 0.05,
    coverPreviewPath: '',
    coverFrameInfo: null,
    capturingCover: false,
    coverError: '',
    showJpegResult: false,
  },

  onLoad() {
    this.setData({
      insets: app.globalData.layoutInsets || getLayoutInsets(),
    });
  },

  onReady() {
    this.videoContext = wx.createVideoContext('source-video', this);
    this.initializeFrameCanvases();
  },

  initializeFrameCanvases() {
    if (this.sourceCanvas && this.outputCanvas) return Promise.resolve(true);
    if (this.frameCanvasPromise) return this.frameCanvasPromise;

    this.frameCanvasPromise = new Promise((resolve) => {
      const query = wx.createSelectorQuery();
      query.select('#frame-source-canvas').fields({ node: true });
      query.select('#frame-output-canvas').fields({ node: true });
      query.exec((result) => {
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

  async onChooseVideo() {
    if (this.data.picking || this.data.capturingCover) return;
    this.pausePreview();
    this.setData({ picking: true });

    let video;
    try {
      video = await chooseVideoFromAlbum();
    } catch (error) {
      this.setData({ picking: false });
      if (!isVideoPickerCanceled(error)) {
        wx.showToast({ title: '暂时无法选择视频', icon: 'none' });
      }
      return;
    }

    let videoInfo;
    try {
      videoInfo = await inspectVideoSource(video.path);
    } catch (error) {
      this.setData({ picking: false });
      wx.showModal({
        title: '无法读取视频',
        content: getErrorMessage(error, '请重新选择本机上的 MP4 视频。'),
        showCancel: false,
      });
      return;
    }

    this.setData({ picking: false });
    removeTemporaryFile(this.data.coverPreviewPath);
    this.frameRequestId = (this.frameRequestId || 0) + 1;
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

    this.setData({
      video: selectedVideo,
      videoInfo,
      flow,
      coverTimeLabel: '00:00.0',
      sliderMaxSeconds: Math.max(0.05, durationSeconds - 0.05),
      coverPreviewPath: '',
      coverFrameInfo: null,
      coverError: '',
      showJpegResult: false,
    }, () => {
      this.seekPreview(0);
      this.captureCoverAt(0);
    });
  },

  pausePreview() {
    if (this.videoContext) this.videoContext.pause();
  },

  seekPreview(seconds) {
    if (this.videoContext) this.videoContext.seek(Math.max(0, Number(seconds) || 0));
  },

  onVideoError() {
    this.setData({ coverError: '视频预览失败，请换用 H.264 MP4 视频。' });
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
    const canvasesReady = await this.initializeFrameCanvases();
    if (!canvasesReady || !this.sourceCanvas || !this.outputCanvas) {
      this.setData({ coverError: '封面处理画布尚未准备好，请稍后重试。' });
      return;
    }
    if (!this.data.video || !this.data.videoInfo) return;

    const sourcePath = this.data.video.path;
    const previousPreviewPath = this.data.coverPreviewPath;
    const requestId = (this.frameRequestId || 0) + 1;
    this.frameRequestId = requestId;
    const coverTimeSeconds = Math.max(0, Math.min(this.data.sliderMaxSeconds, Number(seconds) || 0));
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

    try {
      const frame = await captureVideoFrameToJpeg(
        sourcePath,
        coverTimeSeconds,
        this.data.videoInfo.orientation,
        this.sourceCanvas,
        this.outputCanvas,
      );
      if (requestId !== this.frameRequestId || !this.data.video || this.data.video.path !== sourcePath) {
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
      if (previousPreviewPath && previousPreviewPath !== frame.path) removeTemporaryFile(previousPreviewPath);
    } catch (error) {
      if (requestId !== this.frameRequestId) return;
      const message = getErrorMessage(error, '无法生成封面帧，请重新选择视频或时间点。');
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
      if (previousPreviewPath) removeTemporaryFile(previousPreviewPath);
    }
  },

  onGenerateCover() {
    const frame = this.data.coverFrameInfo;
    if (!frame || this.data.capturingCover || this.data.showJpegResult) return;
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
    wx.previewImage({ current: path, urls: [path] });
  },

  onHide() {
    this.pausePreview();
  },

  onUnload() {
    this.frameRequestId = (this.frameRequestId || 0) + 1;
    if (this.videoContext) this.videoContext.pause();
    removeTemporaryFile(this.data.coverPreviewPath);
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
  },
});
