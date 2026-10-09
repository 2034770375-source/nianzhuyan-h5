const dishes = require('../../config/dishes.js');
const card = require('../../utils/card.js');
const audio = require('../../utils/audio.js');
const track = require('../../utils/track.js');

function loadImage(canvas, src) {
  return new Promise(function (resolve) {
    const img = canvas.createImage();
    img.onload = function () { resolve(img); };
    img.onerror = function () { resolve(null); };
    img.src = src;
  });
}

Page({
  data: {
    title: '我的年猪宴',
    subtitle: '六道菜 · 一桌年味',
    bless: '六道菜齐了，新年开席！',
    list: [],
    saveText: '保存到相册',
    toast: ''
  },

  onLoad() {
    const list = dishes.ORDER.map(function (id) {
      const v = dishes.getDishView(id);
      return { id: id, title: v.title, src: v.dishImg };
    });
    this.setData({ list: list });
    track.log('banquet_show', {});
    this.buildCard();
  },

  onUnload() {
    clearTimeout(this.toastTimer);
  },

  showToast(msg) {
    this.setData({ toast: msg });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.setData({ toast: '' }), 2200);
  },

  /* --------------------------- 生成分享卡 --------------------------- */

  buildCard() {
    wx.createSelectorQuery()
      .in(this)
      .select('#card')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          this.showToast('卡片生成失败');
          return;
        }
        const canvas = res[0].node;
        canvas.width = card.CARD_W;
        canvas.height = card.CARD_H;
        const ctx = canvas.getContext('2d');
        const list = this.data.list;

        card.drawCard(ctx, list, function (src) {
          return loadImage(canvas, src);
        })
          .then(() => {
            wx.canvasToTempFilePath({
              canvas: canvas,
              success: (r) => {
                this.cardPath = r.tempFilePath;
              },
              fail: () => {
                this.showToast('卡片生成失败');
              }
            });
          })
          .catch(() => {
            this.showToast('卡片生成失败');
          });
      });
  },

  /* ------------------------------ 交互 ------------------------------ */

  onSave() {
    if (!this.cardPath) {
      this.showToast('卡片还在生成，稍等一下');
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath: this.cardPath,
      success: () => {
        audio.play('back_bell');
        this.showToast('已保存到相册');
        track.log('card_save', {});
      },
      fail: (e) => {
        const msg = (e && e.errMsg) || '';
        if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
          this.showToast('需要相册权限，请在设置里开启');
          if (wx.openSetting) wx.openSetting({});
        } else {
          this.showToast('保存失败，请重试');
        }
      }
    });
  },

  onBack() {
    audio.play('back_bell');
    wx.navigateBack({
      delta: 1,
      fail: function () {
        wx.redirectTo({ url: '/pages/map/index' });
      }
    });
  },

  goOrigin() {
    audio.play('back_bell');
    wx.navigateTo({ url: '/pages/origin/index' });
  },

  onShareAppMessage() {
    return {
      title: '我的年猪宴，六道徽州年菜都上桌了',
      path: '/pages/map/index'
    };
  }
});
