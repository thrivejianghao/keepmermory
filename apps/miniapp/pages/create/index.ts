import type { AIModel, ParameterValue, Skill } from '../../services/api';
import { skillService, type ParameterField } from '../../services/skill-service';
import { taskService } from '../../services/task-service';
import { uploadService, type SelectedImage } from '../../services/upload-service';

Page({
  data: {
    id: '',
    skill: null as Skill | null,
    photos: [] as SelectedImage[],
    models: [] as AIModel[],
    modelLabels: [] as string[],
    selectedModel: null as AIModel | null,
    modelIndex: 0,
    parameterFields: [] as ParameterField[],
    loading: true,
    submitting: false,
    submitLabel: '开始生成',
    error: '',
  },
  onLoad(options: { id?: string }) {
    this.setData({ id: options.id ?? '' });
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [skill, modelPayload] = await Promise.all([skillService.get(this.data.id), taskService.models()]);
      const models = modelPayload.items.filter((model) => model.available);
      const selectedModel = modelPayload.default?.available ? modelPayload.default : models[0] ?? null;
      this.setData({
        skill,
        models,
        modelLabels: models.map((model) => `${model.name} · ${model.modelId}`),
        selectedModel,
        modelIndex: Math.max(0, models.findIndex((model) => model.providerId === selectedModel?.providerId && model.modelId === selectedModel?.modelId)),
        parameterFields: skillService.parameterFields(skill),
        error: selectedModel ? '' : '当前没有可用 AI 模型，请先在后台完成配置',
      });
    } catch (reason) {
      this.setData({ error: reason instanceof Error ? reason.message : '加载失败' });
    } finally { this.setData({ loading: false }); }
  },
  async choose() {
    const max = this.data.skill?.input.images.max ?? 1;
    const remaining = max - this.data.photos.length;
    if (remaining <= 0) return;
    try {
      const selected = await uploadService.choose(remaining);
      this.setData({ photos: [...this.data.photos, ...selected].slice(0, max), error: '' });
    } catch (reason) {
      if (reason instanceof Error && reason.message === 'PHOTO_SELECTION_CANCELLED') return;
      this.setData({ error: reason instanceof Error ? reason.message : '无法读取照片' });
    }
  },
  removePhoto(event: { currentTarget: { dataset: { index: number } } }) {
    const photos = [...this.data.photos];
    photos.splice(event.currentTarget.dataset.index, 1);
    this.setData({ photos, error: '' });
  },
  preview(event: { currentTarget: { dataset: { src: string } } }) {
    wx.previewImage({ current: event.currentTarget.dataset.src, urls: this.data.photos.map((photo) => photo.path) });
  },
  changeModel(event: { detail: { value: string } }) {
    const modelIndex = Number(event.detail.value);
    this.setData({ modelIndex, selectedModel: this.data.models[modelIndex] ?? null });
  },
  changeSelect(event: { currentTarget: { dataset: { index: number } }; detail: { value: string } }) {
    const index = event.currentTarget.dataset.index;
    const fields = [...this.data.parameterFields];
    const field = fields[index];
    const selected = field?.options[Number(event.detail.value)];
    if (!field || !selected) return;
    fields[index] = { ...field, value: selected.value, optionIndex: Number(event.detail.value) };
    this.setData({ parameterFields: fields, error: '' });
  },
  changeInput(event: { currentTarget: { dataset: { index: number } }; detail: { value: string } }) {
    const index = event.currentTarget.dataset.index;
    const fields = [...this.data.parameterFields];
    const field = fields[index];
    if (!field) return;
    const value: ParameterValue = field.type === 'number' && event.detail.value !== '' ? Number(event.detail.value) : event.detail.value;
    fields[index] = { ...field, value };
    this.setData({ parameterFields: fields, error: '' });
  },
  changeBoolean(event: { currentTarget: { dataset: { index: number } }; detail: { value: boolean } }) {
    const index = event.currentTarget.dataset.index;
    const fields = [...this.data.parameterFields];
    const field = fields[index];
    if (!field) return;
    fields[index] = { ...field, value: event.detail.value };
    this.setData({ parameterFields: fields, error: '' });
  },
  async generate() {
    const skill = this.data.skill;
    if (!skill) return;
    if (this.data.photos.length < skill.input.images.min) {
      this.setData({ error: `请至少选择 ${skill.input.images.min} 张照片` });
      return;
    }
    const selectedModel = this.data.selectedModel;
    if (!selectedModel) { this.setData({ error: '请先配置可用 AI 模型' }); return; }
    const parameters = skillService.toParameters(this.data.parameterFields);
    try { skillService.validateParameters(skill, parameters); } catch (reason) {
      this.setData({ error: reason instanceof Error ? reason.message : '参数无效' });
      return;
    }
    this.setData({ submitting: true, submitLabel: '正在处理照片…', error: '' });
    try {
      const uploads = await uploadService.prepareAndUpload(this.data.photos, ({ completed, total }) => this.setData({ submitLabel: `正在上传 ${completed}/${total}` }));
      this.setData({ submitLabel: '正在创建任务…' });
      const task = await taskService.create({ skillId: this.data.id, providerId: selectedModel.providerId, modelId: selectedModel.modelId, uploads, parameters });
      wx.redirectTo({ url: `/pages/task/index?id=${encodeURIComponent(task.taskId)}` });
    } catch (reason) {
      this.setData({ error: reason instanceof Error ? reason.message : '生成任务创建失败' });
    } finally {
      this.setData({ submitting: false, submitLabel: '开始生成' });
    }
  },
});
