const ANDROID_REFERENCE_WIDTH = 411.4;

function round(value) {
  return Math.round(value);
}

function getLayoutInsets() {
  let info = {};
  try {
    info = wx.getSystemInfoSync();
  } catch (_error) {
    // Keep the pages usable in the Developer Tools simulator if system data is unavailable.
  }

  const windowWidth = info.windowWidth || info.screenWidth || 375;
  const pxToRpx = 750 / windowWidth;
  const designPxToRpx = 750 / ANDROID_REFERENCE_WIDTH;
  const statusBarRpx = (info.statusBarHeight || 0) * pxToRpx;
  const safeAreaBottom = info.safeArea && Number.isFinite(info.safeArea.bottom)
    ? info.safeArea.bottom
    : (info.windowHeight || info.screenHeight || 0);
  const screenHeight = info.screenHeight || info.windowHeight || safeAreaBottom;
  const bottomInsetRpx = Math.max(0, screenHeight - safeAreaBottom) * pxToRpx;

  return {
    homeTopRpx: round(statusBarRpx + 20 * designPxToRpx),
    homeBottomRpx: round(bottomInsetRpx + 22 * designPxToRpx),
    videoTopRpx: round(statusBarRpx + 18 * designPxToRpx),
    videoBottomRpx: round(bottomInsetRpx + 108 * designPxToRpx),
    actionBottomRpx: round(bottomInsetRpx),
  };
}

module.exports = { getLayoutInsets };
