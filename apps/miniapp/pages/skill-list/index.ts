import type { Skill } from '../../services/api';
import { skillService } from '../../services/skill-service';

Page({
  data: { skills: [] as Skill[], visible: [] as Skill[], categories: ['全部'], selected: '全部', loading: true, error: '' },
  onLoad() { void this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const skills = await skillService.list();
      this.setData({ skills, visible: skills, categories: ['全部', ...Array.from(new Set(skills.map((item) => item.category)))], error: '' });
    } catch (reason) {
      this.setData({ error: reason instanceof Error ? reason.message : '加载失败' });
    } finally { this.setData({ loading: false }); }
  },
  chooseCategory(event: { currentTarget: { dataset: { value: string } } }) {
    const selected = event.currentTarget.dataset.value;
    this.setData({ selected, visible: selected === '全部' ? this.data.skills : this.data.skills.filter((item: Skill) => item.category === selected) });
  },
});
