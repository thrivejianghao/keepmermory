import type { Skill, TaskResult } from '../../services/api';
import { skillService } from '../../services/skill-service';
import { taskService } from '../../services/task-service';
import { uploadService } from '../../services/upload-service';

Page({
  data: {
    id: '', result: null as TaskResult | null, skill: null as Skill | null,
    sourceUrls: [] as string[], loading: true, saving: false, error: '',
  },
  onLoad(options: { id?: string }) { this.setData({ id: options.id ?? '' }); void this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await taskService.result(this.data.id);
      if (!result.outputs.length) throw new Error('任务还没有可查看的结果');
      let skill: Skill | null = null;
      try { skill = await skillService.get(result.task.skillId); } catch { skill = null; }
      this.setData({ result, skill, sourceUrls: taskService.sourceUrls(result.task), error: '' });
    } catch (reason) {
      this.setData({ error: reason instanceof Error ? reason.message : '结果加载失败' });
    } finally { this.setData({ loading: false }); }
  },
  preview() {
    const url = this.data.result?.outputs[0]?.url;
    if (url) wx.previewImage({ current: url, urls: this.data.result?.outputs.map((output) => output.url).filter(Boolean) });
  },
  previewSource() {
    const current = this.data.sourceUrls[0];
    if (current) wx.previewImage({ current, urls: this.data.sourceUrls });
  },
  async save() {
    const url = this.data.result?.outputs[0]?.url;
    if (!url || this.data.saving) return;
    this.setData({ saving: true, error: '' });
    try {
      await uploadService.saveToAlbum(url);
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (reason) {
      if (reason instanceof Error && reason.message === 'PHOTO_ALBUM_PERMISSION_DENIED') {
        wx.showModal({
          title: '需要相册权限', content: '请在设置中允许保存到相册。', confirmText: '去设置',
          success: (result: { confirm: boolean }) => { if (result.confirm) wx.openSetting({}); },
        });
      } else {
        this.setData({ error: reason instanceof Error ? reason.message : '图片保存失败' });
      }
    } finally { this.setData({ saving: false }); }
  },
  again() {
    const skillId = this.data.result?.task.skillId;
    if (skillId) wx.redirectTo({ url: `/pages/create/index?id=${encodeURIComponent(skillId)}` });
  },
  backToSkill() {
    const skillId = this.data.result?.task.skillId;
    if (skillId) wx.redirectTo({ url: `/pages/skill-detail/index?id=${encodeURIComponent(skillId)}` });
  },
});
