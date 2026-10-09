/**
 * 设备性能档位检测：低端机自动降级（减少金粉粒子、关闭烟花）
 */
function getPerfLevel() {
  try {
    const info = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()) || {};
    const level = info.benchmarkLevel;
    if (typeof level === 'number' && level > 0 && level < 20) return 'low';
  } catch (e) {
    /* ignore */
  }
  return 'high';
}

function isLow() {
  try {
    const app = getApp();
    return !!(app && app.globalData && app.globalData.perfLevel === 'low');
  } catch (e) {
    return false;
  }
}

module.exports = {
  getPerfLevel: getPerfLevel,
  isLow: isLow
};
