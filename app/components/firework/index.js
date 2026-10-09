const perf = require('../../utils/perf.js');

Component({
  data: {
    enabled: true,
    bursts: [
      { id: 1, style: 'left:6%;top:9%;width:340rpx;height:340rpx;animation-delay:0.4s;animation-duration:7.5s' },
      { id: 2, style: 'right:2%;top:20%;width:400rpx;height:400rpx;animation-delay:3.1s;animation-duration:8.6s' },
      { id: 3, style: 'left:28%;top:2%;width:300rpx;height:300rpx;animation-delay:5.4s;animation-duration:9.2s' }
    ]
  },

  lifetimes: {
    attached() {
      /* 低端机自动关闭烟花层，保证帧率 */
      if (perf.isLow()) {
        this.setData({ enabled: false });
      }
    }
  }
});
