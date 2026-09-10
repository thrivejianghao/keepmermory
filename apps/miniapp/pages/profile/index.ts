Page({
  data: { version: 'Local MVP 0.1', userName: '本地创作者' },
  openWorks() { wx.switchTab({ url: '/pages/works/index' }); },
  about() { wx.showModal({ title: '关于造像', content: '用 Skill 把照片变成值得留下的作品。', showCancel: false }); },
});
