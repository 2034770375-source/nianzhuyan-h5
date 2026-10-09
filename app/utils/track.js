/**
 * 轻量埋点：默认只打印日志；接入数据后台后把 REPORT_TO_BACKEND 打开即可。
 */
const REPORT_TO_BACKEND = false;

function log(event, data) {
  const payload = data || {};
  try {
    console.log('[track] ' + event, payload);
    if (REPORT_TO_BACKEND && typeof wx.reportEvent === 'function') {
      wx.reportEvent(event, payload);
    }
  } catch (e) {
    /* ignore */
  }
}

module.exports = {
  log: log
};
