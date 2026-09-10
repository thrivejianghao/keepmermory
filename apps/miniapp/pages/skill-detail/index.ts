import type { Skill } from '../../services/api';
import { skillService, type ParameterField } from '../../services/skill-service';

Page({
  data: { skill: null as Skill | null, parameterFields: [] as ParameterField[], loading: true, error: '', id: '' },
  onLoad(options: { id?: string }) { this.setData({ id: options.id ?? '' }); void this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const skill = await skillService.get(this.data.id);
      this.setData({ skill, parameterFields: skillService.parameterFields(skill), error: '' });
    } catch (reason) {
      this.setData({ error: reason instanceof Error ? reason.message : '加载失败' });
    } finally { this.setData({ loading: false }); }
  },
  create() { wx.navigateTo({ url: `/pages/create/index?id=${encodeURIComponent(this.data.id)}` }); },
});
