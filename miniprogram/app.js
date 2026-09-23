const { getLayoutInsets } = require('./src/platform/system-info');

App({
  globalData: {
    layoutInsets: null,
  },

  onLaunch() {
    this.globalData.layoutInsets = getLayoutInsets();
  },
});
