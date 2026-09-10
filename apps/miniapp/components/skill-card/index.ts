Component({
  properties: { skill: { type: Object, value: {} }, index: { type: Number, value: 0 }, featured: { type: Boolean, value: false } },
  methods: {
    open() {
      const skill = this.data.skill as { id: string };
      wx.navigateTo({ url: `/pages/skill-detail/index?id=${encodeURIComponent(skill.id)}` });
    },
  },
});
