const audio = require('../../utils/audio.js');
const track = require('../../utils/track.js');

const AUTO_NEXT_MS = 1800;

Page({
  data: {
    shown: false
  },

  onLoad() {
    track.log('entry_show', {});
    this.navigated = false;
    this.setData({ shown: true });

    /* 首次交互前音频可能被系统拦截，这里先尝试一次，点击时会补播 */
    audio.play('enter_bell');

    this.timer = setTimeout(() => {
      this.go();
    }, AUTO_NEXT_MS);
  },

  onUnload() {
    clearTimeout(this.timer);
    audio.stopSteam();
  },

  onTap() {
    audio.unlock();
    audio.play('enter_bell');
    track.log('entry_skip', {});
    this.go();
  },

  go() {
    if (this.navigated) return;
    this.navigated = true;
    clearTimeout(this.timer);
    audio.play('transition');
    wx.redirectTo({
      url: '/pages/map/index',
      fail: () => {
        /* redirectTo 失败时兜底，避免停在入口页看不到年猪地图 */
        wx.reLaunch({ url: '/pages/map/index' });
      }
    });
  }
});
