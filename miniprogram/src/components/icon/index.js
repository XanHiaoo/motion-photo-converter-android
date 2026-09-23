const ICON_PATHS = {
  brand: '../../assets/motion-photo-icon-functional-simple-approved.svg',
  'film-white': '../../assets/icons/film-white.svg',
  'film-muted': '../../assets/icons/film-muted.svg',
  'stack-green': '../../assets/icons/stack-green.svg',
  'combine-purple': '../../assets/icons/combine-purple.svg',
  'chevron-gray': '../../assets/icons/chevron-gray.svg',
  'chevron-white': '../../assets/icons/chevron-white.svg',
  'lock-muted': '../../assets/icons/lock-muted.svg',
  'arrow-left': '../../assets/icons/arrow-left.svg',
  'images-white': '../../assets/icons/images-white.svg',
};

Component({
  properties: {
    name: { type: String, value: 'film-muted' },
    size: { type: Number, value: 24 },
  },

  data: {
    source: ICON_PATHS['film-muted'],
    imageStyle: 'width:44rpx;height:44rpx;',
  },

  observers: {
    'name, size': function updateIcon(name, size) {
      const source = ICON_PATHS[name] || ICON_PATHS['film-muted'];
      const dimension = Math.round(Math.max(1, Number(size) || 24) * 750 / 411.4);
      this.setData({
        source,
        imageStyle: `width:${dimension}rpx;height:${dimension}rpx;`,
      });
    },
  },
});
