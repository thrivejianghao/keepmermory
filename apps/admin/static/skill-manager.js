const STYLE_ID = 'skill-manager-styles';
const STATUSES = [
  ['DRAFT', '草稿'], ['TESTING', '测试中'], ['PUBLISHED', '已发布'],
  ['OFFLINE', '已下线'], ['DEPRECATED', '已废弃'],
];

export function mountSkillManager(root, apiBase, options = {}) {
  installStyles();
  root.className = 'skill-manager';
  root.innerHTML = `
    <section class="skill-toolbar">
      <div><h2>全部 Skill</h2><span class="skill-count">0 项</span></div>
      <button type="button" class="skill-create">新建 Skill</button>
    </section>
    <div class="skill-feedback" role="status"></div>
    <div class="skill-error" role="alert"></div>
    <div class="skill-list"><div class="skill-state">正在加载…</div></div>
    <dialog class="skill-editor-dialog"><form class="skill-form">
      <header><div><span class="skill-dialog-kicker">SKILL EDITOR</span><h2 class="skill-editor-title">新建 Skill</h2></div><button type="button" class="skill-close" aria-label="关闭">×</button></header>
      <div class="skill-form-grid">
        <label>Skill ID<input id="skill-id" name="id" autocomplete="off" placeholder="portrait-studio" required /></label>
        <label>版本<input id="skill-version" name="version" autocomplete="off" value="1.0.0" required /></label>
        <label class="skill-span-2">名称<input id="skill-name" name="name" autocomplete="off" required /></label>
        <label class="skill-span-2">描述<textarea id="skill-description" name="description" rows="3" required></textarea></label>
        <label>分类<input id="skill-category" name="category" autocomplete="off" placeholder="portrait" required /></label>
        <label>状态<select id="skill-status" name="status">${STATUSES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
        <label>排序<input id="skill-sort" name="sort" type="number" min="0" max="9999" value="0" required /></label>
        <fieldset><legend>输入图片数量</legend><div class="skill-inline"><label>最少<input id="skill-image-min" name="imageMin" type="number" min="1" max="8" value="1" required /></label><label>最多<input id="skill-image-max" name="imageMax" type="number" min="1" max="8" value="1" required /></label></div></fieldset>
        <label class="skill-span-2">封面 URL<input id="skill-cover" name="coverUrl" type="url" autocomplete="off" /></label>
        <label class="skill-span-2">执行指令<textarea id="skill-instructions" name="instructions" rows="7" required></textarea></label>
      </div>
      <div class="skill-form-error" role="alert"></div>
      <footer><button type="button" class="skill-cancel">取消</button><button type="submit" class="skill-save">保存 Skill</button></footer>
    </form></dialog>
    <dialog class="skill-detail-dialog"><article><header><div><span class="skill-dialog-kicker">SKILL DETAIL</span><h2>Skill 详情</h2></div><button type="button" class="skill-detail-close" aria-label="关闭">×</button></header><dl></dl><footer><button type="button" class="skill-detail-done">关闭</button></footer></article></dialog>`;

  const list = root.querySelector('.skill-list');
  const count = root.querySelector('.skill-count');
  const feedback = root.querySelector('.skill-feedback');
  const error = root.querySelector('.skill-error');
  const editor = root.querySelector('.skill-editor-dialog');
  const detailDialog = root.querySelector('.skill-detail-dialog');
  const form = root.querySelector('.skill-form');
  let skills = [];
  let editingId;
  let disposed = false;

  async function request(path, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(apiBase + path, {
        ...init,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Admin-Config': '1', ...init.headers },
      });
      const body = await response.json();
      if (!response.ok || body.code !== 0) throw new Error(body.message || `HTTP ${response.status}`);
      return body.data;
    } finally {
      clearTimeout(timer);
    }
  }

  function showError(reason, target = error) {
    const message = reason instanceof Error ? reason.message : String(reason);
    target.textContent = message === 'SKILL_ALREADY_EXISTS' ? 'Skill ID 已存在' : message === 'SKILL_IN_USE' ? '该 Skill 已被任务引用，不能删除' : message.startsWith('INVALID_INPUT:') ? `输入有误：${message.slice(14)}` : message;
  }

  function clearMessages() {
    error.textContent = '';
    feedback.textContent = '';
  }

  function render() {
    count.textContent = `${skills.length} 项`;
    list.replaceChildren();
    if (!skills.length) {
      const empty = document.createElement('div');
      empty.className = 'skill-state';
      empty.textContent = '还没有 Skill';
      list.append(empty);
      return;
    }
    const tableWrap = document.createElement('div');
    tableWrap.className = 'skill-table-wrap';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Skill</th><th>分类</th><th>版本</th><th>状态</th><th>排序</th><th>操作</th></tr></thead>';
    const body = document.createElement('tbody');
    skills.forEach((skill) => {
      const row = document.createElement('tr');
      row.dataset.skillRow = skill.id;
      const identity = document.createElement('td');
      identity.dataset.label = 'Skill';
      const name = document.createElement('strong');
      name.textContent = skill.name;
      const id = document.createElement('small');
      id.textContent = skill.id;
      identity.append(name, id);
      const category = cell(skill.category, '分类');
      const version = cell(skill.currentVersion || '—', '版本');
      const statusCell = document.createElement('td');
      statusCell.dataset.label = '状态';
      const status = document.createElement('span');
      status.className = `skill-status skill-status-${skill.status.toLowerCase()}`;
      status.textContent = skill.status;
      statusCell.append(status);
      const sort = cell(String(skill.sort ?? 0), '排序');
      const actions = document.createElement('td');
      actions.className = 'skill-row-actions';
      actions.dataset.label = '操作';
      actions.append(actionButton('查看', () => void openDetail(skill.id)), actionButton('编辑', () => void openEditor(skill.id)), actionButton('删除', () => void removeSkill(skill)));
      row.append(identity, category, version, statusCell, sort, actions);
      body.append(row);
    });
    table.append(body);
    tableWrap.append(table);
    list.append(tableWrap);
  }

  async function load() {
    clearMessages();
    list.innerHTML = '<div class="skill-state">正在加载…</div>';
    try {
      skills = await request('/admin/skills');
      if (!disposed) render();
    } catch (reason) {
      list.replaceChildren();
      showError(reason);
    }
  }

  async function openEditor(id) {
    clearMessages();
    form.reset();
    root.querySelector('#skill-version').value = '1.0.0';
    root.querySelector('#skill-sort').value = '0';
    root.querySelector('#skill-image-min').value = '1';
    root.querySelector('#skill-image-max').value = '1';
    editingId = id;
    root.querySelector('.skill-editor-title').textContent = id ? '编辑 Skill' : '新建 Skill';
    root.querySelector('#skill-id').disabled = Boolean(id);
    root.querySelector('.skill-form-error').textContent = '';
    if (id) {
      try {
        const skill = await request(`/admin/skills/${encodeURIComponent(id)}`);
        setValue('skill-id', skill.id);
        setValue('skill-version', skill.version);
        setValue('skill-name', skill.name);
        setValue('skill-description', skill.description);
        setValue('skill-category', skill.category);
        setValue('skill-status', skill.status);
        setValue('skill-sort', skill.sort);
        setValue('skill-image-min', skill.imageMin);
        setValue('skill-image-max', skill.imageMax);
        setValue('skill-cover', skill.coverUrl || '');
        setValue('skill-instructions', skill.instructions);
      } catch (reason) {
        showError(reason);
        return;
      }
    }
    editor.showModal();
  }

  async function openDetail(id) {
    clearMessages();
    try {
      const skill = await request(`/admin/skills/${encodeURIComponent(id)}`);
      const fields = [
        ['Skill ID', skill.id], ['名称', skill.name], ['描述', skill.description],
        ['分类', skill.category], ['状态', skill.status], ['版本', skill.version],
        ['排序', String(skill.sort)], ['图片数量', `${skill.imageMin} - ${skill.imageMax}`],
        ['封面 URL', skill.coverUrl || '—'], ['执行指令', skill.instructions],
      ];
      const descriptionList = detailDialog.querySelector('dl');
      descriptionList.replaceChildren(...fields.flatMap(([label, value]) => {
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = label;
        description.textContent = value;
        return [term, description];
      }));
      detailDialog.showModal();
    } catch (reason) {
      showError(reason);
    }
  }

  async function save(event) {
    event.preventDefault();
    const formError = root.querySelector('.skill-form-error');
    formError.textContent = '';
    const button = root.querySelector('.skill-save');
    button.disabled = true;
    const payload = {
      id: root.querySelector('#skill-id').value,
      version: root.querySelector('#skill-version').value,
      name: root.querySelector('#skill-name').value,
      description: root.querySelector('#skill-description').value,
      category: root.querySelector('#skill-category').value,
      status: root.querySelector('#skill-status').value,
      sort: Number(root.querySelector('#skill-sort').value),
      imageMin: Number(root.querySelector('#skill-image-min').value),
      imageMax: Number(root.querySelector('#skill-image-max').value),
      coverUrl: root.querySelector('#skill-cover').value,
      instructions: root.querySelector('#skill-instructions').value,
    };
    try {
      await request(editingId ? `/admin/skills/${encodeURIComponent(editingId)}` : '/admin/skills', {
        method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      editor.close();
      feedback.textContent = editingId ? 'Skill 已更新' : 'Skill 已创建';
      await load();
      feedback.textContent = editingId ? 'Skill 已更新' : 'Skill 已创建';
      options.onChanged?.();
    } catch (reason) {
      showError(reason, formError);
    } finally {
      button.disabled = false;
    }
  }

  async function removeSkill(skill) {
    clearMessages();
    if (!window.confirm(`确定删除“${skill.name}”吗？`)) return;
    try {
      await request(`/admin/skills/${encodeURIComponent(skill.id)}`, { method: 'DELETE' });
      skills = skills.filter((item) => item.id !== skill.id);
      render();
      feedback.textContent = 'Skill 已删除';
      options.onChanged?.();
    } catch (reason) {
      showError(reason);
    }
  }

  root.querySelector('.skill-create').addEventListener('click', () => void openEditor());
  root.querySelector('.skill-close').addEventListener('click', () => editor.close());
  root.querySelector('.skill-cancel').addEventListener('click', () => editor.close());
  root.querySelector('.skill-detail-close').addEventListener('click', () => detailDialog.close());
  root.querySelector('.skill-detail-done').addEventListener('click', () => detailDialog.close());
  form.addEventListener('submit', save);
  void load();

  return () => {
    disposed = true;
    if (editor.open) editor.close();
    if (detailDialog.open) detailDialog.close();
    root.replaceChildren();
  };

  function setValue(id, value) { root.querySelector(`#${id}`).value = String(value); }
}

function cell(value, label) {
  const element = document.createElement('td');
  element.textContent = value;
  element.dataset.label = label;
  return element;
}

function actionButton(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .skill-manager { margin:28px 0; color:#171717; font-size:14px; }
    .skill-manager * { box-sizing:border-box; letter-spacing:0; }
    .skill-toolbar { min-height:64px; padding:14px 18px; display:flex; align-items:center; justify-content:space-between; gap:16px; background:#fff; border:1px solid #deded8; }
    .skill-toolbar > div { display:flex; align-items:baseline; gap:10px; }
    .skill-toolbar h2, .skill-manager dialog h2 { margin:0; font-size:16px; }
    .skill-count { color:#737373; font-size:12px; }
    .skill-manager button { min-height:36px; padding:0 13px; border:1px solid #d4d4d4; border-radius:4px; background:#fff; color:#171717; font:inherit; cursor:pointer; }
    .skill-manager button:focus-visible, .skill-manager input:focus-visible, .skill-manager textarea:focus-visible, .skill-manager select:focus-visible { outline:2px solid #176b39; outline-offset:2px; }
    .skill-manager button:disabled { opacity:.55; cursor:wait; }
    .skill-manager .skill-create, .skill-manager .skill-save { background:#171717; color:#fff; border-color:#171717; }
    .skill-feedback { min-height:22px; padding-top:8px; color:#176b39; }
    .skill-error, .skill-form-error { color:#b42318; white-space:pre-wrap; overflow-wrap:anywhere; }
    .skill-error:not(:empty), .skill-form-error:not(:empty) { padding:10px 0; }
    .skill-list { background:#fff; border:1px solid #deded8; }
    .skill-state { min-height:220px; display:grid; place-items:center; color:#737373; }
    .skill-table-wrap { overflow-x:auto; }
    .skill-manager table { width:100%; border-collapse:collapse; font-size:13px; }
    .skill-manager th { padding:11px 14px; color:#737373; background:#fafaf8; font-weight:500; text-align:left; }
    .skill-manager td { padding:13px 14px; border-top:1px solid #efefeb; vertical-align:middle; }
    .skill-manager td:first-child strong, .skill-manager td:first-child small { display:block; }
    .skill-manager td:first-child small { margin-top:4px; color:#85857e; }
    .skill-row-actions { display:flex; gap:6px; white-space:nowrap; }
    .skill-row-actions button:last-child { color:#b42318; }
    .skill-status { display:inline-flex; min-height:24px; align-items:center; padding:0 8px; background:#ededeb; font-size:11px; font-weight:700; white-space:nowrap; }
    .skill-status-published { color:#176b39; background:#e4f5e9; }
    .skill-status-testing { color:#805500; background:#fff2cb; }
    .skill-status-offline, .skill-status-deprecated { color:#737373; }
    .skill-manager dialog { width:min(760px, calc(100vw - 32px)); max-height:calc(100vh - 32px); margin:auto; padding:0; border:1px solid #cfcfc9; border-radius:6px; background:#fff; color:#171717; overflow:auto; }
    .skill-manager dialog::backdrop { background:rgba(0,0,0,.42); }
    .skill-manager dialog header { position:sticky; top:0; z-index:1; padding:18px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; background:#fff; border-bottom:1px solid #e5e5df; }
    .skill-dialog-kicker { display:block; margin-bottom:5px; color:#737373; font-size:10px; }
    .skill-manager .skill-close, .skill-manager .skill-detail-close { width:36px; min-width:36px; padding:0; font-size:22px; }
    .skill-form-grid { padding:20px; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; }
    .skill-form-grid label { min-width:0; display:grid; gap:7px; color:#525252; font-size:12px; }
    .skill-form-grid input, .skill-form-grid textarea, .skill-form-grid select { width:100%; min-width:0; padding:9px 10px; border:1px solid #d4d4d4; border-radius:4px; background:#fff; color:#171717; font:inherit; }
    .skill-form-grid input, .skill-form-grid select { min-height:40px; }
    .skill-form-grid textarea { resize:vertical; line-height:1.5; }
    .skill-form-grid input:disabled { color:#737373; background:#f2f2ef; }
    .skill-span-2 { grid-column:1 / -1; }
    .skill-form-grid fieldset { min-width:0; margin:0; padding:0; border:0; }
    .skill-form-grid legend { margin-bottom:7px; color:#525252; font-size:12px; }
    .skill-inline { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .skill-manager dialog footer { padding:14px 20px; display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #e5e5df; }
    .skill-form-error { margin:0 20px; }
    .skill-detail-dialog article dl { margin:0; padding:20px; display:grid; grid-template-columns:130px minmax(0,1fr); gap:0; }
    .skill-detail-dialog dt, .skill-detail-dialog dd { margin:0; padding:10px 0; border-bottom:1px solid #efefeb; overflow-wrap:anywhere; }
    .skill-detail-dialog dt { color:#737373; }
    .skill-detail-dialog dd { white-space:pre-wrap; }
    @media(max-width:620px) {
      .skill-manager { margin-top:20px; }
      .skill-toolbar { align-items:flex-start; }
      .skill-table-wrap table, .skill-table-wrap tbody { display:block; width:100%; }
      .skill-table-wrap thead { display:none; }
      .skill-table-wrap tr { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px 16px; padding:16px; border-top:1px solid #efefeb; }
      .skill-table-wrap tr:first-child { border-top:0; }
      .skill-manager .skill-table-wrap td { min-width:0; padding:0; border:0; overflow-wrap:anywhere; }
      .skill-manager .skill-table-wrap td::before { content:attr(data-label); display:block; margin-bottom:5px; color:#737373; font-size:11px; font-weight:400; }
      .skill-manager .skill-table-wrap td:first-child, .skill-manager .skill-row-actions { grid-column:1 / -1; }
      .skill-manager .skill-row-actions { display:flex; flex-wrap:wrap; padding-top:2px; }
      .skill-manager .skill-row-actions::before { flex:0 0 100%; }
      .skill-form-grid { grid-template-columns:minmax(0,1fr); padding:16px; }
      .skill-span-2 { grid-column:auto; }
      .skill-manager dialog header, .skill-manager dialog footer { padding:14px 16px; }
      .skill-form-error { margin:0 16px; }
      .skill-detail-dialog article dl { padding:16px; grid-template-columns:1fr; }
      .skill-detail-dialog dt { padding-bottom:2px; border-bottom:0; }
      .skill-detail-dialog dd { padding-top:2px; }
    }`;
  document.head.append(style);
}
