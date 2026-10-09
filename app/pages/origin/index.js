const dishes = require('../../config/dishes.js');
const audio = require('../../utils/audio.js');
const track = require('../../utils/track.js');

/* 整桌的来历：五段，讲一头猪怎么变成一桌菜 */
const OVERVIEW = [
  '进了腊月，徽州人家开始杀年猪。这是一年里最热闹的一天——天不亮就烧水，邻居都来搭手。',
  '猪杀好，第一锅不是自家吃。按老规矩，先请来帮忙的人和左邻右舍吃一顿，这叫「杀猪饭」。',
  '一头猪会被拆成许多道菜：猪头留着祭祖，脊骨炖汤，大肠下干锅，血灌成血肠，四蹄配上糯米做成圆子。',
  '到了除夕，这些菜一起上桌，就成了「年猪宴」。上菜讲次序：先上一碟开胃小食，再上头锅热菜和热炒，接着是猪头这样的大菜，最后压轴的是头牌和甜口。',
  '猪头取「有头有尾、鸿运当头」，鳜鱼压轴取「年年有余」。一家人围着一桌菜坐下，这一年的辛劳就算收了个尾。'
];

function sequenceText() {
  return dishes.ORDER.map(function (id) {
    return dishes.getDishView(id).title;
  }).join(' · ');
}

Page({
  data: {
    mode: 'overview',
    title: '这一桌菜的来历',
    badge: '年猪宴',
    subtitle: '徽州年猪宴',
    paras: OVERVIEW,
    sequence: '',
    dishId: ''
  },

  onLoad(query) {
    const id = query && query.dish;
    const seq = sequenceText();
    if (id && dishes.DISHES[id]) {
      const v = dishes.getDishView(id);
      this.setData({
        mode: 'dish',
        dishId: id,
        title: v.title,
        badge: '第 ' + v.index + ' 道',
        subtitle: '这道菜的来历',
        paras: [v.origin],
        fact: v.fact,
        sequence: seq
      });
      wx.setNavigationBarTitle && wx.setNavigationBarTitle({ title: v.title });
    } else {
      this.setData({ sequence: seq });
    }
    track.log('origin_show', { dish: id || 'overview' });
  },

  /* 从单道菜切到整桌 */
  goOverview() {
    audio.play('back_bell');
    wx.redirectTo({ url: '/pages/origin/index' });
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

  onShareAppMessage() {
    return {
      title: this.data.mode === 'dish'
        ? this.data.title + ' · 这道菜的来历'
        : '这一桌菜的来历 · 徽州年猪宴',
      path: '/pages/map/index'
    };
  }
});
