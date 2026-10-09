const perf = require('../../utils/perf.js');

Component({
  properties: {
    /* 粒子数量，低端机会自动减半 */
    count: {
      type: Number,
      value: 22
    }
  },

  data: {
    items: []
  },

  lifetimes: {
    attached() {
      this.build();
    }
  },

  methods: {
    build() {
      const max = perf.isLow() ? 10 : this.data.count;
      const items = [];
      for (let i = 0; i < max; i += 1) {
        const size = 4 + Math.random() * 8;
        const duration = 7 + Math.random() * 7;
        const delay = -Math.random() * 14;
        const left = Math.random() * 100;
        const opacity = 0.3 + Math.random() * 0.5;
        const drift = (Math.random() * 60 - 30).toFixed(1);
        items.push({
          id: i,
          style: [
            'left:' + left.toFixed(2) + '%',
            'width:' + size.toFixed(1) + 'rpx',
            'height:' + size.toFixed(1) + 'rpx',
            'opacity:' + opacity.toFixed(2),
            'animation-duration:' + duration.toFixed(1) + 's',
            'animation-delay:' + delay.toFixed(1) + 's',
            '--np-drift:' + drift + 'rpx'
          ].join(';')
        });
      }
      this.setData({ items: items });
    }
  }
});
