const app = getApp();
const { getLayoutInsets } = require('../../platform/system-info');

Page({
  data: {
    insets: {},
  },

  onLoad() {
    this.setData({
      insets: app.globalData.layoutInsets || getLayoutInsets(),
    });
  },

  openVideo() {
    wx.navigateTo({ url: '/src/pages/video/index' });
  },

  openBatch() {
    // The batch flow is outside milestones M0/M1.
  },

  openManual() {
    // The photo + video flow is outside milestones M0/M1.
  },
});
