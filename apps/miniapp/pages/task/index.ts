import type { Task } from '../../services/api';
import { describeTask, taskService } from '../../services/task-service';

Page({
  data: {
    id: '', skillId: '', status: 'PENDING', progress: 0,
    label: '正在提交任务', detail: '正在准备照片和创作参数',
    failed: false, networkError: '',
  },
  timer: 0,
  leaving: false,
  onLoad(options: { id?: string }) {
    this.setData({ id: options.id ?? '' });
    void this.poll();
  },
  onUnload() { this.leaving = true; clearTimeout(this.timer); },
  async poll() {
    if (!this.data.id || this.leaving) return;
    try {
      const task: Task = await taskService.get(this.data.id);
      const presentation = describeTask(task);
      this.setData({
        skillId: task.skillId,
        status: task.status,
        progress: task.progress,
        label: presentation.label,
        detail: task.errorMessage && presentation.failed ? task.errorMessage : presentation.detail,
        failed: presentation.failed,
        networkError: '',
      });
      if (presentation.succeeded) {
        this.timer = setTimeout(() => wx.redirectTo({ url: `/pages/result/index?id=${encodeURIComponent(task.id)}` }), 350);
        return;
      }
      if (presentation.terminal) return;
      this.timer = setTimeout(() => void this.poll(), 1200);
    } catch (reason) {
      this.setData({ networkError: reason instanceof Error ? reason.message : '任务状态查询失败' });
    }
  },
  retryQuery() { this.setData({ networkError: '' }); void this.poll(); },
  retryCreation() {
    if (this.data.skillId) wx.redirectTo({ url: `/pages/create/index?id=${encodeURIComponent(this.data.skillId)}` });
  },
  back() { wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/home/index' }) }); },
});
