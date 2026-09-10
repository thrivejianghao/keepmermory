import type { Skill } from '../../services/api';
import { skillService } from '../../services/skill-service';

Page({
  data: { featured: null as Skill | null, popular: [] as Skill[], loading: true, error: '' },
  onLoad() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, error: '' });
    try {
      const skills = await skillService.list();
      this.setData({ featured: skills[0] ?? null, popular: skills.slice(1), error: '' });
    } catch (reason) {
      this.setData({ error: reason instanceof Error ? reason.message : '加载失败' });
    } finally {
      this.setData({ loading: false });
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  openAll() { wx.navigateTo({ url: '/pages/skill-list/index' }); },
});
