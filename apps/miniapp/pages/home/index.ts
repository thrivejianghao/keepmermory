import { api, type Skill } from '../../services/api';

Page({ data: { skills: [] as Skill[], loading: true, error: '' }, onLoad() { void this.load(); }, onPullDownRefresh() { void this.load(); }, async load() { this.setData({ loading: true, error: '' }); try { this.setData({ skills: await api.skills() }); } catch (reason) { this.setData({ error: reason instanceof Error ? reason.message : '加载失败' }); } finally { this.setData({ loading: false }); } }, openAll() { wx.navigateTo({ url: '/pages/skill-list/index' }); } });
