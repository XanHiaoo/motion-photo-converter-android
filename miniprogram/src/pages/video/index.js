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

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.reLaunch({ url: '/src/pages/home/index' });
  },
});