const audio = require('./utils/audio.js');
const perf = require('./utils/perf.js');
const track = require('./utils/track.js');

App({
  globalData: {
    perfLevel: 'high',
    visited: {},
    muted: false
  },

  onLaunch() {
    this.globalData.perfLevel = perf.getPerfLevel();
    this.globalData.muted = audio.isMuted();
    this.globalData.visited = wx.getStorageSync('np_visited') || {};
    track.log('app_launch', { perf: this.globalData.perfLevel });
  },

  /* 切到后台时把还在响的环境音停掉 */
  onHide() {
    audio.stopSteam();
  },

  /* 记录某道菜已浏览，用于首页热区显示“已看过”状态 */
  markVisited(dishId) {
    const visited = Object.assign({}, this.globalData.visited, { [dishId]: 1 });
    this.globalData.visited = visited;
    try {
      wx.setStorageSync('np_visited', visited);
    } catch (e) {}
  },

  isVisited(dishId) {
    return !!this.globalData.visited[dishId];
  }
});
