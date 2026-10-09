const dishes = require('../../../config/dishes.js');
const audio = require('../../../utils/audio.js');
const track = require('../../../utils/track.js');

Component({
  properties: {
    dishId: {
      type: String,
      value: 'hongyun'
    }
  },

  data: {
    view: null,
    entered: false,
    popIndex: -1,
    muted: false
  },

  lifetimes: {
    attached() {
      this.build();
      this.setData({ muted: audio.isMuted() });
    },

    detached() {
      audio.stopSteam();
      clearTimeout(this.enterTimer);
      clearTimeout(this.popTimer);
    }
  },

  pageLifetimes: {
    show() {
      audio.startSteam();
      /* 进菜品页放一轮远处鞭炮，错开页面转场音 */
      audio.playFirecracker(280);
    },
    hide() {
      audio.stopSteam();
    }
  },

  methods: {
    build() {
      const view = dishes.getDishView(this.data.dishId);
      this.setData({ view: view, entered: false });

      try {
        const app = getApp();
        if (app && app.markVisited) app.markVisited(view.id);
      } catch (e) {
        /* ignore */
      }

      clearTimeout(this.enterTimer);
      this.enterTimer = setTimeout(() => {
        this.setData({ entered: true });
      }, 40);

      track.log('dish_view', { dish: view.id });
    },

    /* 点击环绕配菜：轻轻弹一下 */
    onDecoTap(e) {
      const index = Number(e.currentTarget.dataset.index);
      this.setData({ popIndex: index });
      clearTimeout(this.popTimer);
      this.popTimer = setTimeout(() => {
        this.setData({ popIndex: -1 });
      }, 420);
    },

    /* 左右滑动切菜 */
    onTouchStart(e) {
      const t = e.touches[0];
      this.startPoint = { x: t.clientX, y: t.clientY };
    },

    onTouchEnd(e) {
      if (!this.startPoint) return;
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (!t) return;
      const dx = t.clientX - this.startPoint.x;
      const dy = t.clientY - this.startPoint.y;
      this.startPoint = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;

      const view = this.data.view;
      if (!view) return;
      const nextId = dishes.nextDish(view.id);
      audio.play('transition');
      track.log('dish_swipe', { from: view.id, to: nextId });
      wx.redirectTo({ url: dishes.pagePath(nextId) });
    },

    onToggleMute() {
      const muted = audio.toggle();
      this.setData({ muted: muted });
      if (muted) {
        audio.stopSteam();
      } else {
        audio.play('hotspot_ding');
        audio.startSteam();
      }
      track.log('mute_toggle', { muted: muted });
    },

    /* 右下角返回按钮 */
    goBack() {
      audio.play('back_bell');
      const view = this.data.view;
      track.log('back_home', { dish: view ? view.id : '' });
      wx.navigateBack({
        delta: 1,
        fail: function () {
          /* 直接进入详情页（如分享打开）时没有上一页，回到长地图 */
          wx.redirectTo({ url: '/pages/map/index' });
        }
      });
    },

    /* 点底部的「这一桌菜的来历」 */
    goOrigin() {
      audio.play('back_bell');
      const view = this.data.view;
      wx.navigateTo({
        url: '/pages/origin/index?dish=' + (view ? view.id : '')
      });
    }
  }
});
