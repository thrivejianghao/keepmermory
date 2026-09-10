export function mountModelConfig(container, apiBase) {
  let disposed = false;
  let busy = false;
  let config;
  let controller;
  const style = document.createElement('style');
  style.textContent = `
    .model-config { max-width:1000px; margin:24px 0; color:#171717; font-size:14px; }
    .model-config * { box-sizing:border-box; letter-spacing:0; }
    .model-config form { margin:0; }
    .model-config label { display:grid; gap:8px; color:#525252; font-size:13px; min-width:0; }
    .model-config input:not([type=checkbox]), .model-config select { width:100%; min-width:0; height:40px; padding:0 10px; color:#171717; background:#fff; border:1px solid #d4d4d4; border-radius:4px; font:inherit; }
    .model-config input:focus-visible, .model-config select:focus-visible, .model-config button:focus-visible { outline:2px solid #176b39; outline-offset:2px; }
    .model-config input[type=checkbox] { width:16px; height:16px; margin:0; accent-color:#176b39; }
    .model-config label.model-check { display:flex; align-items:center; gap:8px; }
    .model-config fieldset { min-width:0; margin:0; padding:0; border:0; }
    .model-config .model-default { display:grid; gap:12px; max-width:300px; margin:0 0 8px; }
    .model-config .model-help { margin:0 0 20px; color:#737373; font-size:12px; line-height:1.7; }
    .model-config .model-provider { padding:24px 0; border-top:1px solid #d4d4d4; }
    .model-config .skill-agent { margin-top:20px; border-top:2px solid #171717; }
    .model-config .model-provider-header { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:16px; }
    .model-config h2 { font-size:16px; margin:0; }
    .model-config .model-role { display:block; margin-top:5px; color:#737373; font-size:12px; font-weight:400; }
    .model-config .model-fields { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,2fr); gap:16px; }
    .model-config .model-key-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; align-items:end; margin-top:16px; }
    .model-config .model-key-label { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
    .model-config .model-key-state { color:#737373; font-size:12px; }
    .model-config .model-key-state.configured { color:#176b39; }
    .model-config .model-clear { min-height:40px; }
    .model-config .model-actions { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding-top:20px; border-top:1px solid #d4d4d4; }
    .model-config button { border:1px solid #d4d4d4; border-radius:4px; min-height:40px; padding:0 18px; background:#fff; color:#171717; font:inherit; cursor:pointer; }
    .model-config button[type=submit] { background:#171717; color:#fff; border-color:#171717; }
    .model-config button:disabled { opacity:.55; cursor:wait; }
    .model-config-status { min-height:20px; color:#176b39; font-size:13px; }
    .model-config-error { color:#b42318; font-size:13px; white-space:pre-wrap; overflow-wrap:anywhere; }
    .model-config-error:not(:empty) { padding:12px 0; }
    .model-config-loading { padding:32px 0; color:#737373; }
    @media(max-width:620px) { .model-config .model-fields { grid-template-columns:minmax(0,1fr); } .model-config .model-key-row { grid-template-columns:minmax(0,1fr); gap:8px; } .model-config .model-default { max-width:none; } }
  `;
  const root = document.createElement('section');
  root.className = 'model-config';
  container.replaceChildren(style, root);

  async function request(init) {
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 15000);
    try {
      const response = await fetch(apiBase + '/admin/model-config', { ...init, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Admin-Config': '1' }, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || body.code !== 0) throw new Error(body.message);
      return body.data;
    } finally { clearTimeout(timeout); }
  }

  function showError(error) {
    const message = error instanceof Error ? error.message : '';
    const target = root.querySelector('.model-config-error');
    if (!target) return;
    target.textContent = message.includes('default-provider') ? '默认模型必须已启用且已配置密钥。' :
      message.includes('skill-agent') ? 'Skill 编排模型配置无效：启用时必须填写有效的模型 ID、OpenAI 兼容 Base URL 和 API Key。' :
      message.includes('INVALID_INPUT') ? '配置无效：模型名称请填模型 ID（例如 qwen-image-edit-plus），接口地址和 API Key 请检查完整性。' :
      message.includes('FORBIDDEN') ? '模型配置仅允许本机后台访问。' :
      message.includes('WRITE_FAILED') ? '保存失败，请检查服务端配置目录的写入权限。' :
      '无法连接配置服务，请检查本地服务后重试。';
  }

  function render() {
    root.innerHTML = `<form autocomplete="off"><fieldset class="model-editor"><label class="model-default" for="default-provider">默认图片模型<select id="default-provider"><option value="mock">Mock / 本地测试</option><option value="openai">OpenAI 兼容</option><option value="gemini">Gemini</option><option value="qwen">Qwen 原生</option></select></label><p class="model-help">API Key 不会回显：输入新 Key 并保存会覆盖旧 Key；留空表示保留旧 Key；勾选“清除密钥”才会删除。模型名称必须填模型 ID，不能填 URL。</p><div class="skill-agent-slot"></div><div class="model-providers"></div></fieldset><div class="model-config-error" role="alert"></div><div class="model-actions"><button type="submit">保存配置</button><button type="button" class="model-reload">重新加载</button><span class="model-config-status" role="status"></span></div></form>`;
    root.querySelector('#default-provider').value = config.defaultProvider;
    const agent = config.skillAgent;
    const agentSection = document.createElement('section');
    agentSection.className = 'model-provider skill-agent';
    agentSection.innerHTML = `<div class="model-provider-header"><h2>Skill 编排模型<span class="model-role">OpenAI 兼容 · Chat Completions · Tool Calling</span></h2><label class="model-check"><input type="checkbox" id="skill-agent-enabled">启用</label></div><p class="model-help">用于先理解当前 Skill 和参数，再调用 execute_image_skill 生成图片执行提示词。阿里云百炼 Token Plan 的套餐专属配置填写在这里。</p><div class="model-fields"><label for="skill-agent-model">文本模型 ID<input id="skill-agent-model" required maxlength="200" spellcheck="false" placeholder="填写套餐支持的模型 ID"></label><label for="skill-agent-endpoint">OpenAI 兼容 Base URL<input id="skill-agent-endpoint" type="url" required spellcheck="false" placeholder="https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"></label></div><div class="model-key-row"><label for="skill-agent-key"><span class="model-key-label">套餐专属 API Key <span class="model-key-state" id="skill-agent-key-status"></span></span><input id="skill-agent-key" type="password" autocomplete="new-password" placeholder="输入新 Key 可覆盖，留空保留旧 Key" maxlength="4096"></label><label class="model-check model-clear"><input id="skill-agent-clear-key" type="checkbox">清除密钥</label></div>`;
    agentSection.querySelector('#skill-agent-model').value = agent.modelId;
    agentSection.querySelector('#skill-agent-endpoint').value = agent.endpoint;
    agentSection.querySelector('#skill-agent-enabled').checked = agent.enabled;
    const agentStatus = agentSection.querySelector('#skill-agent-key-status');
    agentStatus.textContent = agent.keyConfigured ? '已配置' : '未配置';
    agentStatus.classList.toggle('configured', agent.keyConfigured);
    agentSection.querySelector('#skill-agent-clear-key').addEventListener('change', (event) => {
      const key = agentSection.querySelector('#skill-agent-key');
      key.disabled = event.target.checked;
      if (event.target.checked) key.value = '';
    });
    root.querySelector('.skill-agent-slot').append(agentSection);
    const providers = root.querySelector('.model-providers');
    for (const provider of config.providers) {
      const id = provider.providerId;
      if (!['openai', 'gemini', 'qwen'].includes(id)) continue;
      const section = document.createElement('section');
      section.className = 'model-provider';
      section.dataset.provider = id;
      section.innerHTML = `<div class="model-provider-header"><h2></h2><label class="model-check"><input type="checkbox" id="${id}-enabled">启用</label></div><div class="model-fields"><label for="${id}-model">图像模型 ID<input id="${id}-model" required maxlength="200" spellcheck="false" placeholder="例如 qwen-image-edit-plus"></label><label for="${id}-endpoint">${id === 'qwen' ? 'DashScope 完整请求地址' : id === 'gemini' ? 'Gemini 原生 API Base URL' : 'OpenAI 兼容 Base URL'}<input id="${id}-endpoint" type="url" required spellcheck="false"></label></div><div class="model-key-row"><label for="${id}-key"><span class="model-key-label">API Key <span class="model-key-state" id="${id}-key-status"></span></span><input id="${id}-key" type="password" autocomplete="new-password" placeholder="输入新 Key 可覆盖，留空保留旧 Key" maxlength="4096"></label><label class="model-check model-clear"><input id="${id}-clear-key" type="checkbox">清除密钥</label></div>`;
      section.querySelector('h2').textContent = provider.name;
      section.querySelector(`#${id}-model`).value = provider.modelId;
      section.querySelector(`#${id}-endpoint`).value = provider.endpoint;
      section.querySelector(`#${id}-enabled`).checked = provider.enabled;
      const status = section.querySelector(`#${id}-key-status`);
      status.textContent = provider.keyConfigured ? '已配置' : '未配置';
      status.classList.toggle('configured', provider.keyConfigured);
      section.querySelector(`#${id}-clear-key`).addEventListener('change', (event) => {
        const key = section.querySelector(`#${id}-key`);
        key.disabled = event.target.checked;
        if (event.target.checked) key.value = '';
      });
      providers.append(section);
    }
    root.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const body = { defaultProvider: root.querySelector('#default-provider').value,
        skillAgent: {
          enabled: root.querySelector('#skill-agent-enabled').checked,
          protocol: config.skillAgent.protocol,
          modelId: root.querySelector('#skill-agent-model').value,
          endpoint: root.querySelector('#skill-agent-endpoint').value,
          apiKey: root.querySelector('#skill-agent-key').value,
          clearApiKey: root.querySelector('#skill-agent-clear-key').checked,
        },
        providers: config.providers.map(({ providerId }) => ({ providerId,
          enabled: root.querySelector(`#${providerId}-enabled`).checked,
          modelId: root.querySelector(`#${providerId}-model`).value,
          endpoint: root.querySelector(`#${providerId}-endpoint`).value,
          apiKey: root.querySelector(`#${providerId}-key`).value,
          clearApiKey: root.querySelector(`#${providerId}-clear-key`).checked,
        })) };
      const updatedKeys = body.providers.filter((provider) => provider.apiKey.trim()).map((provider) => provider.providerId.toUpperCase());
      const clearedKeys = body.providers.filter((provider) => provider.clearApiKey).map((provider) => provider.providerId.toUpperCase());
      if (body.skillAgent.apiKey.trim()) updatedKeys.unshift('SKILL AGENT');
      if (body.skillAgent.clearApiKey) clearedKeys.unshift('SKILL AGENT');
      root.querySelector('.model-config-error').textContent = '';
      root.querySelector('.model-config-status').textContent = '';
      root.querySelector('.model-editor').disabled = true;
      root.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      root.querySelector('[type=submit]').textContent = '保存中…';
      try {
        config = await request({ method: 'POST', body: JSON.stringify(body) });
        if (disposed) return;
        render();
        root.querySelector('.model-config-status').textContent = updatedKeys.length ? `已保存，${updatedKeys.join('、')} API Key 已更新` : clearedKeys.length ? `已保存，${clearedKeys.join('、')} API Key 已清除` : '已保存';
      } catch (error) { if (!disposed) showError(error); }
      finally {
        busy = false;
        body.providers.forEach((provider) => { provider.apiKey = ''; });
        body.skillAgent.apiKey = '';
        if (!disposed) {
          root.querySelector('.model-editor').disabled = false;
          root.querySelectorAll('button').forEach((button) => { button.disabled = false; });
          root.querySelector('[type=submit]').textContent = '保存配置';
        }
      }
    });
    root.querySelector('.model-reload').addEventListener('click', () => void load());
  }

  async function load() {
    if (busy) return;
    busy = true;
    root.innerHTML = '<div class="model-config-loading" role="status">正在加载模型配置…</div><div class="model-config-error" role="alert"></div>';
    try {
      config = await request();
      if (!disposed) render();
    } catch (error) {
      if (disposed) return;
      root.querySelector('.model-config-loading').remove();
      showError(error);
      const retry = document.createElement('button');
      retry.textContent = '重试';
      retry.addEventListener('click', () => void load());
      root.append(retry);
    } finally { busy = false; }
  }
  void load();
  return () => { disposed = true; controller?.abort(); container.replaceChildren(); };
}
