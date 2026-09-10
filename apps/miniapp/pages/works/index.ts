import type { Task, TaskOutput } from '../../services/api';
import { uploadService } from '../../services/upload-service';
import { workService } from '../../services/work-service';

interface Work { task: Task; outputs: TaskOutput[] }

Page({
  data: { items: [] as Work[], page: 1, total: 0, hasMore: false, loading: true, loadingMore: false, error: '' },
  onShow() { void this.load(true); },
  onReachBottom() { if (this.data.hasMore && !this.data.loadingMore) void this.load(false); },
  async load(reset: boolean) {
    const page = reset ? 1 : this.data.page + 1;
    this.setData(reset ? { loading: true, error: '' } : { loadingMore: true, error: '' });
    try {
      const result = await workService.list(page);
      const items = reset ? result.items : [...this.data.items, ...result.items];
      this.setData({ items, page, total: result.total, hasMore: items.length < result.total, error: '' });
    } catch (reason) {
      this.setData({ error: reason instanceof Error ? reason.message : '作品加载失败' });
    } finally { this.setData({ loading: false, loadingMore: false }); }
  },
  retry() { void this.load(true); },
  loadMore() { if (this.data.hasMore && !this.data.loadingMore) void this.load(false); },
  open(event: { currentTarget: { dataset: { id: string } } }) {
    wx.navigateTo({ url: `/pages/result/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  actions(event: { currentTarget: { dataset: { index: number } } }) {
    const item = this.data.items[event.currentTarget.dataset.index];
    if (!item) return;
    wx.showActionSheet({
      itemList: ['保存图片', '再次生成', '删除作品'],
      success: (result: { tapIndex: number }) => {
        if (result.tapIndex === 0) void this.saveWork(item);
        if (result.tapIndex === 1) wx.navigateTo({ url: `/pages/create/index?id=${encodeURIComponent(item.task.skillId)}` });
        if (result.tapIndex === 2) this.confirmDelete(item);
      },
    });
  },
  async saveWork(item: Work) {
    const url = item.outputs[0]?.url;
    if (!url) return;
    try {
      await uploadService.saveToAlbum(url);
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (reason) {
      const permissionDenied = reason instanceof Error && reason.message === 'PHOTO_ALBUM_PERMISSION_DENIED';
      wx.showModal({
        title: permissionDenied ? '需要相册权限' : '保存失败',
        content: permissionDenied ? '请在设置中允许保存到相册。' : reason instanceof Error ? reason.message : '请稍后重试',
        confirmText: permissionDenied ? '去设置' : '知道了',
        showCancel: permissionDenied,
        success: (result: { confirm: boolean }) => { if (permissionDenied && result.confirm) wx.openSetting({}); },
      });
    }
  },
  confirmDelete(item: Work) {
    wx.showModal({
      title: '删除作品', content: '删除后无法在作品列表中恢复。', confirmText: '删除', confirmColor: '#C43E32',
      success: (result: { confirm: boolean }) => { if (result.confirm) void this.remove(item.task.id); },
    });
  },
  async remove(taskId: string) {
    try {
      await workService.remove(taskId);
      const items = this.data.items.filter((item: Work) => item.task.id !== taskId);
      this.setData({ items, total: Math.max(0, this.data.total - 1), hasMore: items.length < Math.max(0, this.data.total - 1) });
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (reason) {
      this.setData({ error: reason instanceof Error ? reason.message : '删除失败' });
    }
  },
  create() { wx.switchTab({ url: '/pages/home/index' }); },
});
