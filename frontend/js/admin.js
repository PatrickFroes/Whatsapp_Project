// GLOBAL STATE
const STATE = {
  all_uras: {}, // All available flows
  current_ura_id: '', // ID being edited (e.g. 'Padrão', 'Campanha Natal')
  active_ura_id: '', // ID currently live on Bot
  ura: {}, // Object of current flow (for rendering)
  users: [],
  skills: [],
  meta: {},
  templates: [], // Initialize templates array
  selectedNode: null
};

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Sem token de autenticação');

    // Fetch Configs (Users, Skills, Meta)
    const resConfig = await fetch('/api/admin/config', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (resConfig.status === 401) return logout();
    if (!resConfig.ok) {
      throw new Error(`Failed to load config: ${resConfig.status}`);
    }
    const dataConfig = await resConfig.json();

    // Fetch URAs (List)
    const resUras = await fetch('/api/admin/uras', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resUras.ok) {
      throw new Error(`Failed to load URAs: ${resUras.status}`);
    }
    const dataUras = await resUras.json();

    // Fetch Pauses
    const resPauses = await fetch('/api/admin/pauses', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const dataPauses = resPauses.ok ? await resPauses.json() : { reasons: [] };

    // Populate State
    STATE.all_uras = dataUras.uras || {
      Padrão: { start: { type: 'menu', message: 'Início', options: {} } }
    };
    STATE.active_ura_id = dataUras.active || 'Padrão';
    STATE.users = dataConfig.users || [];
    STATE.skills = dataConfig.skills || [];
    STATE.meta = dataConfig.meta || {};
    STATE.pause_reasons = dataPauses.reasons || [];

    // Default to active or first available
    STATE.current_ura_id = STATE.active_ura_id;
    if (!STATE.all_uras[STATE.current_ura_id])
      STATE.current_ura_id = Object.keys(STATE.all_uras)[0];

    // Load current into editor
    loadURA(STATE.current_ura_id);

    // Render Views
    renderSelector();
    renderUsers();
    renderPauseConfig();
    await loadTemplates(); // Load Templates
    await renderSettings();

    document.getElementById('loading-overlay').style.display = 'none';
  } catch (err) {
    console.error('[Admin] Initialization error:', err);
    document.getElementById('loading-overlay').style.display = 'none';
    Swal.fire('Erro ao Carregar', `Falha na inicialização: ${err.message}`, 'error');
  }
}

// --- URA MANAGEMENT ---

// Helper to save entire configuration
async function saveAllURAs(showSuccess = true) {
  // Sync current
  if (STATE.current_ura_id) {
    STATE.all_uras[STATE.current_ura_id] = STATE.ura;
  }

  const payload = {
    uras: STATE.all_uras,
    active: STATE.active_ura_id
  };

  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/uras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Falha na API');

    if (showSuccess) Swal.fire('Salvo', 'Configuração de fluxos atualizada.', 'success');
    return true;
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', 'Não foi possível salvar os fluxos.', 'error');
    return false;
  }
}

function loadURA(id) {
  STATE.current_ura_id = id;
  // Deep copy to avoid mutating STATE.all_uras directly until save
  STATE.ura = JSON.parse(
    JSON.stringify(
      STATE.all_uras[id] || { start: { type: 'menu', message: 'Broken Flow', options: {} } }
    )
  );
  STATE.selectedNode = null;

  // Update UI indicators
  document.getElementById('ura-selector').value = id;
  const isLive = id === STATE.active_ura_id;
  const badge = document.getElementById('active-indicator');
  badge.className = isLive ? 'badge bg-success me-2' : 'badge bg-secondary me-2';
  badge.innerText = isLive ? 'ONLINE' : 'Offline';

  document.getElementById('btn-activate').disabled = isLive;
  document.getElementById('props-panel').innerHTML =
    '<p class="text-muted text-center mt-5">Selecione um nó para editar</p>';

  renderTree();
}

window.switchURA = (id) => {
  // Save current changes to memory
  STATE.all_uras[STATE.current_ura_id] = STATE.ura;
  loadURA(id);
};

window.createNewURA = async () => {
  const name = prompt('Nome do novo fluxo:');
  if (!name || STATE.all_uras[name]) return;

  STATE.all_uras[name] = { start: { type: 'menu', message: `Fluxo: ${name}`, options: {} } };
  renderSelector();
  loadURA(name); // Load it
  await saveAllURAs(false); // Persis immediately
};

window.deleteCurrentURA = async () => {
  const id = STATE.current_ura_id;
  if (id === STATE.active_ura_id)
    return Swal.fire('Erro', 'Não pode excluir o fluxo ativo!', 'error');
  if (!confirm(`Excluir fluxo "${id}"?`)) return;

  delete STATE.all_uras[id];

  // Pick next
  const next = Object.keys(STATE.all_uras)[0];
  if (next) {
    loadURA(next);
    renderSelector();
    await saveAllURAs();
  } else {
    // Create default if empty
    STATE.all_uras['Padrão'] = { start: { type: 'menu', message: 'Início', options: {} } };
    loadURA('Padrão');
    renderSelector();
    await saveAllURAs();
  }
};

window.activateURA = async () => {
  STATE.active_ura_id = STATE.current_ura_id;
  loadURA(STATE.current_ura_id); // Refresh UI (button disables)
  renderSelector(); // Refresh list indicators
  await saveAllURAs();
  Swal.fire('Ativado!', `O fluxo "${STATE.current_ura_id}" agora está ONLINE.`, 'success');
};

function renderSelector() {
  const sel = document.getElementById('ura-selector');
  sel.innerHTML = Object.keys(STATE.all_uras)
    .map(
      (k) =>
        `<option value="${k}" ${k === STATE.current_ura_id ? 'selected' : ''}>${k} ${k === STATE.active_ura_id ? '(Ativo)' : ''}</option>`
    )
    .join('');
}

// --- NAVIGATION ---

window.navTo = (viewName) => {
  // Hide all
  document.querySelectorAll('.view-section').forEach((el) => el.classList.add('d-none'));
  // Show Target
  document.getElementById(`view-${viewName}`).classList.remove('d-none');

  // Update Title
  const titles = {
    dashboard: 'Editor de Fluxo',
    users: 'Gerenciar Usuários',
    settings: 'Configurações',
    templates: 'Modelos de Mensagem'
  };
  document.getElementById('page-title').innerText = titles[viewName];

  // Update Nav Active State
  document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
  // (Simple logic, can be improved to match exact clicked element)
};

window.toggleSidebar = () => {
  document.getElementById('mainSidebar').classList.toggle('active');
  document.getElementById('mobileOverlay').classList.toggle('active');
};

window.logout = () => {
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('token');
  window.location.href = '/login.html';
};

// --- TREE RENDERER & EDITOR ---

function renderTree() {
  const root = document.getElementById('tree-canvas');
  if (!root) return;

  // Start recursion
  root.innerHTML = `<ul>${buildTreeHtml('start', [])}</ul>`;
}

function buildTreeHtml(nodeId, visited) {
  if (visited.includes(nodeId)) {
    return `<li><div class="node-box border-danger text-danger">Loop Detectado<br><small>${nodeId}</small></div></li>`;
  }

  const node = STATE.ura[nodeId];
  if (!node) {
    return `<li><div class="node-box bg-warning">Nó Perdido<br><small>${nodeId}</small></div></li>`;
  }

  const isSel = STATE.selectedNode === nodeId ? 'selected' : '';
  let icon = 'bi-circle';
  if (nodeId === 'start') icon = 'bi-play-circle-fill text-success';
  else if (node.type === 'text' || node.type === 'auto') icon = 'bi-chat-dots text-secondary';
  else if (node.type === 'collect_data') icon = 'bi-input-cursor-text text-success';
  else if (node.type === 'conditional') icon = 'bi-signpost-split text-warning';
  else if (node.type === 'transfer' || node.type === 'transfer_agent')
    icon = 'bi-headset text-info';
  else if (node.type === 'transfer_queue') icon = 'bi-people text-info';
  else if (node.type === 'api_call') icon = 'bi-cloud-arrow-up text-primary';
  else if (node.type === 'set_data') icon = 'bi-database text-warning';
  else if (node.type === 'end') icon = 'bi-stop-circle text-danger';

  // Preview inteligente por tipo
  let nodePreview = node.message || '...';
  if (node.type === 'conditional') nodePreview = node.condition || 'Sem condição';
  else if (node.type === 'set_data')
    nodePreview = `${node.data_key || '?'} = ${node.data_value || '?'}`;
  else if (node.type === 'collect_data') nodePreview = `📥 ${node.data_key || '?'}`;
  else if (node.type === 'api_call')
    nodePreview = node.api_url
      ? (node.api_method || 'GET') + ' ' + node.api_url.substring(0, 25)
      : '...';

  const typeLabels = {
    text: 'Texto',
    auto: 'Texto',
    menu: 'Menu',
    collect_data: 'Coletar Dados',
    conditional: 'Condicional',
    transfer: 'Transferir',
    transfer_agent: 'Transferir',
    transfer_queue: 'Fila',
    api_call: 'API Call',
    set_data: 'Set Data',
    end: 'Fim'
  };

  let html = `
        <li>
            <div class="node-box ${isSel}" onclick="selectNode('${nodeId}')">
                <span class="node-type"><i class="bi ${icon}"></i> ${typeLabels[node.type] || node.type || 'Menu'}</span>
                <div class="node-id">${nodeId}</div>
                <div class="text-truncate" style="max-width:140px; font-size:0.8rem">${nodePreview}</div>
            </div>
    `;

  // Children
  const nextVisited = [...visited, nodeId];

  // Tipos com fluxo linear (next)
  if (['text', 'auto', 'api_call', 'set_data', 'collect_data'].includes(node.type) && node.next) {
    html += `<ul>${buildTreeHtml(node.next, nextVisited)}</ul>`;
  }
  // Condicional (if_true / if_false)
  else if (node.type === 'conditional') {
    const branches = [];
    if (node.if_true) branches.push({ label: '✓ Verdadeiro', id: node.if_true, cls: 'bg-success' });
    if (node.if_false) branches.push({ label: '✗ Falso', id: node.if_false, cls: 'bg-danger' });
    if (branches.length > 0) {
      html += `<ul>`;
      branches.forEach((b) => {
        html += `<li><span class="badge ${b.cls} mb-2">${b.label}</span>
                    <ul>${buildTreeHtml(b.id, nextVisited).replace(/^<li>|<\/li>$/g, '')}</ul></li>`;
      });
      html += `</ul>`;
    }
  }
  // Menu (opções interativas)
  else if (node.type === 'menu' || !node.type) {
    if (node.options && Object.keys(node.options).length > 0) {
      html += `<ul>`;
      Object.keys(node.options).forEach((optKey) => {
        const childId = node.options[optKey];
        html += `
                    <li>
                        <span class="badge bg-secondary mb-2">${optKey}</span>
                        <ul>${buildTreeHtml(childId, nextVisited).replace(/^<li>|<\/li>$/g, '')}</ul>
                    </li>
                `;
      });
      html += `</ul>`;
    }
  }

  html += `</li>`;
  return html;
}

window.selectNode = (id) => {
  STATE.selectedNode = id;
  renderTree(); // Update highlight
  renderPropsPanel(id);
};

function renderPropsPanel(id) {
  const pane = document.getElementById('props-panel');
  const node = STATE.ura[id];
  if (!node) return;

  // Helper for inputs
  const mkInput = (lbl, key, type = 'text', placeholder = '') => `
        <div class="mb-3">
            <label class="form-label small fw-bold">${lbl}</label>
            <input type="${type}" class="form-control form-control-sm" 
                   value="${node[key] || ''}" onchange="updateNodeProp('${id}', '${key}', this.value)" placeholder="${placeholder}">
        </div>
    `;
  const mkSel = (lbl, key, opts) => `
        <div class="mb-3">
            <label class="form-label small fw-bold">${lbl}</label>
            <select class="form-select form-select-sm" onchange="updateNodeProp('${id}', '${key}', this.value)">
                ${opts.map((o) => `<option value="${o.val}" ${node[key] === o.val ? 'selected' : ''}>${o.txt}</option>`).join('')}
            </select>
        </div>
    `;

  // Helpers extras
  const mkTextarea = (lbl, key, rows = 3, placeholder = '') => `
        <div class="mb-3">
            <label class="form-label small fw-bold">${lbl}</label>
            <textarea class="form-control form-control-sm" rows="${rows}" placeholder="${placeholder}"
                onchange="updateNodeProp('${id}', '${key}', this.value)">${node[key] || ''}</textarea>
        </div>
    `;
  const mkJsonArea = (lbl, key, rows = 3, placeholder = '') => {
    const val = node[key]
      ? typeof node[key] === 'object'
        ? JSON.stringify(node[key], null, 2)
        : node[key]
      : '';
    return `
        <div class="mb-3">
            <label class="form-label small fw-bold">${lbl}</label>
            <textarea class="form-control form-control-sm font-monospace" rows="${rows}" placeholder="${placeholder}"
                onchange="updateNodeJsonProp('${id}', '${key}', this.value)">${val}</textarea>
        </div>`;
  };

  // Normalizar tipo 'auto' → 'text' (equivalentes no FlowEngine)
  if (node.type === 'auto') node.type = 'text';

  let content = `<h6 class="border-bottom pb-2 mb-3">Editando: <span class="text-primary">${id}</span></h6>`;

  // Type Selector - Todos os 9 tipos do FlowEngine
  content += mkSel('Tipo de Passo', 'type', [
    { val: 'text', txt: '📝 Mensagem (Texto)' },
    { val: 'menu', txt: '📋 Menu Interativo' },
    { val: 'collect_data', txt: '📥 Coletar Dados do Usuário' },
    { val: 'conditional', txt: '🔀 Condicional (Se/Senão)' },
    { val: 'transfer', txt: '🎧 Transferir p/ Agente' },
    { val: 'transfer_queue', txt: '👥 Transferir p/ Fila' },
    { val: 'api_call', txt: '🌐 Chamada API (HTTP)' },
    { val: 'set_data', txt: '💾 Definir Variável' },
    { val: 'end', txt: '🔴 Finalizar Fluxo' }
  ]);

  const nodeType = node.type || 'menu';

  // === CAMPOS POR TIPO ===

  // Mensagem (comum a vários tipos)
  if (['text', 'menu', 'collect_data', 'transfer', 'transfer_queue', 'end'].includes(nodeType)) {
    content += mkTextarea('Mensagem', 'message', 3, 'Texto enviado ao usuário...');
  }

  // collect_data: campo a coletar + validação
  if (nodeType === 'collect_data') {
    content += mkInput('Nome da Variável', 'data_key', 'text', 'ex: nome, email, cpf');
    content += `<div class="alert alert-light border py-1 px-2 mb-3" style="font-size:0.75rem">
            <i class="bi bi-info-circle"></i> A resposta do usuário será salva em <code>{{nome_da_variavel}}</code> para uso posterior (ex: em chamadas API).
        </div>`;
    content += mkInput(
      'Validação RegEx (opcional)',
      'validation_pattern',
      'text',
      'ex: ^[\\d]{11}$ para CPF'
    );
    content += mkInput(
      'Mensagem de Erro (validação)',
      'validation_error',
      'text',
      'ex: ❌ CPF inválido, tente novamente.'
    );
  }

  // conditional: condição e branches
  if (nodeType === 'conditional') {
    content += mkInput('Condição', 'condition', 'text', "ex: {{status}} === 'ok'");
    content += `<div class="alert alert-light border py-1 px-2 mb-3" style="font-size:0.75rem">
            <i class="bi bi-info-circle"></i> Use <code>{{variavel}}</code> para referenciar dados coletados.<br>
            Operadores: <code>===</code>, <code>!==</code>, <code>&gt;</code>, <code>&lt;</code>, <code>includes()</code>
        </div>`;
  }

  // transfer / transfer_queue: departamento
  if (['transfer', 'transfer_queue'].includes(nodeType)) {
    content += mkSel(
      'Departamento Destino',
      'dept',
      STATE.skills.map((s) => {
        const val = typeof s === 'object' ? s.name : s;
        return { val: val, txt: val };
      })
    );
  }

  // api_call: configuração completa
  if (nodeType === 'api_call') {
    content += mkInput('URL da API', 'api_url', 'text', 'https://api.exemplo.com/endpoint');
    content += mkSel('Método HTTP', 'api_method', [
      { val: 'GET', txt: 'GET' },
      { val: 'POST', txt: 'POST' },
      { val: 'PUT', txt: 'PUT' },
      { val: 'DELETE', txt: 'DELETE' }
    ]);
    content += mkJsonArea(
      'Headers (JSON)',
      'api_headers',
      3,
      '{"Content-Type": "application/json", "API-KEY": "{{api_key}}"}'
    );
    content += mkJsonArea(
      'Body (JSON)',
      'api_body',
      4,
      '{"name": "{{nome}}", "email": "{{email}}"}'
    );
    content += mkInput('Salvar Resposta na Variável', 'api_save_var', 'text', 'ex: api_response');
    content += mkJsonArea(
      'Mapear Campos da Resposta (JSON)',
      'api_map_fields',
      2,
      '{"ticket_id": "data.id", "status": "data.status"}'
    );
    content += `<hr class="my-2">`;
    content += mkInput(
      'Mensagem de Sucesso (opcional)',
      'on_success_message',
      'text',
      'ex: ✅ Ticket criado! ID: {{ticket_id}}'
    );
    content += mkInput(
      'Mensagem de Erro (opcional)',
      'on_error_message',
      'text',
      'ex: ❌ Falha na requisição.'
    );
    content += `<div class="alert alert-info py-1 px-2 mb-3" style="font-size:0.75rem">
            <i class="bi bi-lightbulb"></i> Use <code>{{variavel}}</code> em URLs, headers, body e mensagens para interpolar dados coletados.
        </div>`;
  }

  // set_data: chave e valor
  if (nodeType === 'set_data') {
    content += mkInput('Nome da Chave', 'data_key', 'text', 'ex: status');
    content += mkInput('Valor', 'data_value', 'text', 'ex: ativo ou {{outra_var}}');
  }

  // === CONEXÕES ===
  content += `<h6 class="border-bottom pb-2 mb-3 mt-4">Conexões</h6>`;

  const allNodes = Object.keys(STATE.ura).map((k) => ({ val: k, txt: k }));
  allNodes.unshift({ val: '', txt: '(Fim do Fluxo)' });

  // Tipos com fluxo linear
  if (['text', 'collect_data', 'set_data'].includes(nodeType)) {
    content += mkSel('Próximo Passo', 'next', allNodes);
    content += `<button class="btn btn-sm btn-outline-primary w-100 mb-2" onclick="createChildNode('${id}', 'next')">+ Criar Novo Passo</button>`;
  }
  // api_call: next + branches de sucesso/erro
  else if (nodeType === 'api_call') {
    content += mkSel('Próximo Passo (padrão)', 'next', allNodes);
    content += `<button class="btn btn-sm btn-outline-primary w-100 mb-2" onclick="createChildNode('${id}', 'next')">+ Criar Novo Passo</button>`;
    content += mkSel('Se Sucesso, Ir Para (opcional)', 'on_success_next', allNodes);
    content += mkSel('Se Erro, Ir Para (opcional)', 'on_error_next', allNodes);
  }
  // conditional: if_true / if_false
  else if (nodeType === 'conditional') {
    content += mkSel('Se VERDADEIRO →', 'if_true', allNodes);
    content += `<button class="btn btn-sm btn-outline-success w-100 mb-2" onclick="createChildNode('${id}', 'if_true')">+ Criar Passo (Verdadeiro)</button>`;
    content += mkSel('Se FALSO →', 'if_false', allNodes);
    content += `<button class="btn btn-sm btn-outline-danger w-100 mb-2" onclick="createChildNode('${id}', 'if_false')">+ Criar Passo (Falso)</button>`;
  }
  // menu: opções interativas
  else if (nodeType === 'menu') {
    content += `<div id="options-list">`;
    Object.keys(node.options || {}).forEach((opt) => {
      content += `
                <div class="input-group input-group-sm mb-2">
                    <input type="text" class="form-control" value="${opt}" onchange="renameOption('${id}', '${opt}', this.value)">
                    <button class="btn btn-outline-danger" onclick="deleteOption('${id}', '${opt}')"><i class="bi bi-trash"></i></button>
                    <button class="btn btn-outline-secondary" onclick="navToNode('${node.options[opt]}')">Ir ➜</button>
                </div>
            `;
    });
    content += `</div>`;
    content += `<button class="btn btn-sm btn-outline-primary w-100" onclick="addOption('${id}')">+ Adicionar Opção</button>`;
  }
  // transfer, transfer_queue, end: nós terminais
  else if (['transfer', 'transfer_queue', 'end'].includes(nodeType)) {
    content += `<p class="text-muted small text-center"><i class="bi bi-info-circle"></i> Este tipo de nó finaliza o fluxo.</p>`;
  }

  // Delete Node
  if (id !== 'start') {
    content += `<hr><button class="btn btn-danger btn-sm w-100" onclick="deleteNode('${id}')">Excluir Este Passo</button>`;
  }

  pane.innerHTML = content;
}

// --- LOGIC ACTIONS ---

window.updateNodeProp = (id, key, val) => {
  STATE.ura[id][key] = val;

  // Limpar propriedades do tipo anterior ao trocar tipo
  if (key === 'type') {
    const typeProps = {
      text: ['message', 'next'],
      menu: ['message', 'options'],
      collect_data: ['message', 'data_key', 'validation_pattern', 'validation_error', 'next'],
      conditional: ['condition', 'if_true', 'if_false'],
      transfer: ['message', 'dept'],
      transfer_queue: ['message', 'dept'],
      api_call: [
        'api_url',
        'api_method',
        'api_headers',
        'api_body',
        'api_save_var',
        'api_map_fields',
        'on_success_message',
        'on_success_next',
        'on_error_message',
        'on_error_next',
        'next'
      ],
      set_data: ['data_key', 'data_value', 'next'],
      end: ['message']
    };
    const allowed = new Set(['type', ...(typeProps[val] || [])]);
    Object.keys(STATE.ura[id]).forEach((k) => {
      if (!allowed.has(k)) delete STATE.ura[id][k];
    });
    // Inicializar propriedades necessárias
    if (val === 'menu' && !STATE.ura[id].options) STATE.ura[id].options = {};
    renderPropsPanel(id);
  }
  renderTree();
};

window.updateNodeJsonProp = (id, key, raw) => {
  try {
    STATE.ura[id][key] = JSON.parse(raw);
  } catch (e) {
    STATE.ura[id][key] = raw; // Manter como string se JSON inválido
  }
  renderTree();
};

window.createChildNode = (parentId, linkType) => {
  // Generate ID
  let i = 1;
  while (STATE.ura[`step_${i}`]) i++;
  const newId = `step_${i}`;

  // Criar nó (texto simples como padrão)
  STATE.ura[newId] = { type: 'text', message: '...' };

  // Linkar genérico (funciona para next, if_true, if_false, on_success_next, etc.)
  STATE.ura[parentId][linkType] = newId;

  // Refresh
  STATE.selectedNode = newId;
  renderTree();
  renderPropsPanel(newId);
};

window.addOption = (parentId) => {
  let i = 1;
  while (STATE.ura[parentId].options[`Opção ${i}`]) i++;
  const key = `Opção ${i}`;

  let j = 1;
  while (STATE.ura[`step_${j}`]) j++;
  const newId = `step_${j}`;

  STATE.ura[newId] = { type: 'menu', message: '...', options: {} };
  STATE.ura[parentId].options[key] = newId;

  renderTree();
  renderPropsPanel(parentId);
};

window.deleteOption = (parentId, key) => {
  delete STATE.ura[parentId].options[key];
  renderTree();
  renderPropsPanel(parentId);
};

window.renameOption = (parentId, oldKey, newKey) => {
  if (!newKey || STATE.ura[parentId].options[newKey]) return; // Conflict or empty
  const target = STATE.ura[parentId].options[oldKey];
  delete STATE.ura[parentId].options[oldKey];
  STATE.ura[parentId].options[newKey] = target;
  renderTree();
};

window.navToNode = (id) => selectNode(id);

window.deleteNode = (id) => {
  if (!confirm('Tem certeza? Isso pode quebrar links.')) return;
  delete STATE.ura[id];
  STATE.selectedNode = null;
  document.getElementById('props-panel').innerHTML = '';
  renderTree();
};

// --- SETTINGS & USERS RENDERERS ---

function renderUsers() {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  tbody.innerHTML = STATE.users
    .map((u) => {
      const roleBadge =
        u.role === 'SUPERVISOR' ? 'bg-primary' : u.role === 'ADMIN' ? 'bg-danger' : 'bg-secondary';
      const roleText = u.role === 'SUPERVISOR' ? 'Supervisor' : u.role;
      const userSkills =
        u.skills && Array.isArray(u.skills)
          ? u.skills
              .map((s) => (typeof s === 'string' ? s : s.skill?.name || s.name || '?'))
              .join(', ')
          : '';

      return `
        <tr>
            <td>
                <div class="fw-bold">${escapeHtml(u.name)}</div>
                <div class="text-muted small">${escapeHtml(u.email)}</div>
            </td>
            <td><span class="badge ${roleBadge}">${escapeHtml(roleText)}</span></td>
            <td><small>${escapeHtml(userSkills)}</small></td>
            <td>
                <button class="btn btn-sm btn-link" onclick="showNewUserModal('${u.id}')">Editar</button>
                <button class="btn btn-sm btn-link text-danger" onclick="deleteUser('${u.id}')">Excluir</button>
            </td>
        </tr>
    `;
    })
    .join('');

  const skillList = document.getElementById('skills-list');
  skillList.innerHTML = STATE.skills
    .map((s) => {
      const name = s.name || s;
      const id = s.id || s;
      return `
        <span class="badge bg-info text-dark p-2">
            ${escapeHtml(name)} <i class="bi bi-x-circle ms-1" style="cursor:pointer" onclick="deleteSkill('${escapeHtml(id)}')"></i>
        </span>`;
    })
    .join('');
}

async function renderSettings() {
  // Safely populate old meta fields if they exist (for backward compatibility)
  const metaPhoneIdEl = document.getElementById('metaPhoneId');
  if (metaPhoneIdEl) {
    metaPhoneIdEl.value = STATE.meta.phoneNumberId || '';
  }

  const metaVerifyTokenEl = document.getElementById('metaVerifyToken');
  if (metaVerifyTokenEl) {
    metaVerifyTokenEl.value = STATE.meta.verifyToken || '';
  }

  // Load new configuration (if it exists)
  await loadConfiguration();
}

// --- PAUSE CONFIGURATION ---

function renderPauseConfig() {
  const tbody = document.getElementById('pauses-table-body');
  if (!tbody) return;

  const list = STATE.pause_reasons || [];
  tbody.innerHTML = list
    .map(
      (p, index) => `
        <tr>
            <td><input type="text" class="form-control form-control-sm pause-label" value="${p.label}" placeholder="Motivo (ex: Banheiro)"></td>
            <td><input type="number" class="form-control form-control-sm pause-max" value="${p.maxMinutes}" min="0"></td>
            <td class="text-end">
                <button class="btn btn-link btn-sm text-danger p-0" onclick="removePauseRow(${index})" title="Remover">
                    <i class="bi bi-x-circle-fill"></i>
                </button>
            </td>
        </tr>
    `
    )
    .join('');
}

window.addPauseRow = () => {
  if (!STATE.pause_reasons) STATE.pause_reasons = [];
  STATE.pause_reasons.push({ label: '', maxMinutes: 0 });
  renderPauseConfig();
};

window.removePauseRow = (index) => {
  STATE.pause_reasons.splice(index, 1);
  renderPauseConfig();
};

window.savePauses = async () => {
  // Harvest data from inputs to sync state
  const rows = document.querySelectorAll('#pauses-table-body tr');
  const newList = [];
  rows.forEach((row) => {
    const label = row.querySelector('.pause-label').value.trim();
    const max = parseInt(row.querySelector('.pause-max').value) || 0;
    if (label) newList.push({ label, maxMinutes: max });
  });
  STATE.pause_reasons = newList;

  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/pauses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ list: newList })
    });
    if (res.ok) Swal.fire('Salvo', 'Pausas atualizadas com sucesso!', 'success');
    else throw new Error('Falha ao salvar');
  } catch (e) {
    Swal.fire('Erro', e.message, 'error');
  }
};

// --- TEMPLATES ---

window.syncTemplates = async () => {
  Swal.fire({ title: 'Sincronizando...', didOpen: () => Swal.showLoading() });

  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/templates/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    Swal.fire('Sucesso', `Sincronizados ${data.count} modelos.`, 'success');
    loadTemplates(); // Reload list
  } catch (e) {
    Swal.fire('Erro', e.message, 'error');
  }
};

async function loadTemplates() {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch('/api/templates', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      console.warn('Failed to load templates:', res.status);
      STATE.templates = [];
      return;
    }

    const list = await res.json();
    STATE.templates = Array.isArray(list) ? list : [];

    const tbody = document.getElementById('templates-table-body');
    if (!tbody) return;

    tbody.innerHTML = STATE.templates
      .map((t) => {
        let statusBadge = '<span class="badge bg-secondary">Unknown</span>';
        if (t.status === 'APPROVED') statusBadge = '<span class="badge bg-success">Aprovado</span>';
        if (t.status === 'REJECTED') statusBadge = '<span class="badge bg-danger">Rejeitado</span>';
        if (t.status === 'PENDING')
          statusBadge = '<span class="badge bg-warning text-dark">Pendente</span>';

        return `
            <tr>
                <td><strong>${t.name}</strong></td>
                <td>${t.category}</td>
                <td>${t.language}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-sm btn-outline-info" onclick="viewTemplateDetails('${t.name}')">Ver</button>
                </td>
            </tr>`;
      })
      .join('');
  } catch (e) {
    console.error('Load Templates Error:', e);
    STATE.templates = [];
  }
}

window.viewTemplateDetails = (name) => {
  if (!STATE.templates || !Array.isArray(STATE.templates)) {
    return Swal.fire('Erro', 'Templates não carregados', 'error');
  }

  const t = STATE.templates.find((x) => x.name === name);
  if (!t) {
    return Swal.fire('Erro', 'Template não encontrado', 'error');
  }

  // Simple alert for now, elaborate modal later
  const jsonStr = JSON.stringify(t.components, null, 2);
  Swal.fire({
    title: t.name,
    html: `<pre style="text-align:left; font-size:0.8rem; max-height:300px; overflow:auto">${jsonStr}</pre>`,
    width: '600px'
  });
};

// Hook into init to load templates if view is active?
// Or just let navTo handle it (if we implemented lazy loading).
// For now, let's call loadTemplates() inside init() just in case user Navs there.
// Add to init function below.

// --- SAVE ACTIONS ---

window.saveConfig = async () => {
  await saveAllURAs();
};

// --- USERS MANAGEMENT (EDIT) ---

window.showNewUserModal = (userId = null) => {
  const isEdit = !!userId;
  const user = isEdit ? STATE.users.find((u) => u.id === userId) : {};

  document.getElementById('frmUserName').value = user.name || '';
  document.getElementById('frmUserEmail').value = user.email || '';
  // document.getElementById('frmUserEmail').disabled = isEdit; // Allow email edit
  document.getElementById('frmUserPass').value = '';
  document.getElementById('frmUserRole').value = user.role || 'AGENT';

  const container = document.getElementById('frmUserSkills');
  const userSkillNames = user.skills && Array.isArray(user.skills) ? user.skills : [];

  container.innerHTML = STATE.skills
    .map((skill) => {
      const isChecked = userSkillNames.includes(skill.name);
      return `
        <div class="form-check">
            <input class="form-check-input" type="checkbox" value="${skill.id}" ${isChecked ? 'checked' : ''}>
            <label class="form-check-label">${skill.name}</label>
        </div>`;
    })
    .join('');

  // Store edit mode and ID
  const modalEl = document.getElementById('userModal');
  modalEl.dataset.mode = isEdit ? 'edit' : 'create';
  modalEl.dataset.id = isEdit ? userId : '';

  toggleSkillsVisibility(); // Set initial state based on selected role
  new bootstrap.Modal('#userModal').show();
};

window.toggleSkillsVisibility = () => {
  const role = document.getElementById('frmUserRole').value;
  const container = document.getElementById('containerSkills');
  if (container) {
    if (role === 'AGENT') {
      container.style.display = 'block';
    } else {
      container.style.display = 'none';
    }
  }
};

window.saveUser = async () => {
  const modalEl = document.getElementById('userModal');
  const modalInstance = bootstrap.Modal.getInstance(modalEl);
  const mode = modalEl.dataset.mode;
  const id = modalEl.dataset.id;

  const name = document.getElementById('frmUserName').value;
  const email = document.getElementById('frmUserEmail').value;
  const pass = document.getElementById('frmUserPass').value;
  const role = document.getElementById('frmUserRole').value;

  let skills = [];
  if (role === 'AGENT') {
    document.querySelectorAll('#frmUserSkills input:checked').forEach((c) => skills.push(c.value));
  }

  if (!name || !email) return Swal.fire('Erro', 'Nome e Email obrigatórios', 'error');

  const payload = { name, email, role, skills };
  if (pass) payload.password = pass;

  try {
    const token = localStorage.getItem('token');
    let url = '/api/admin/agents';
    let method = 'POST';

    if (mode === 'edit' && id) {
      url = `/api/admin/agents/${id}`;
      method = 'PUT';
    }

    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Erro API');
    const data = await res.json();

    // Dynamic Update
    if (mode === 'edit') {
      const idx = STATE.users.findIndex((u) => u.id === id);
      if (idx !== -1) STATE.users[idx] = data;
    } else {
      STATE.users.push(data);
    }

    renderUsers();
    modalInstance.hide();
    Swal.fire('Sucesso', 'Usuário salvo!', 'success');
  } catch (e) {
    Swal.fire('Erro', 'Falha ao salvar usuário.', 'error');
  }
};

// --- DATA MANIPULATION (Helpers) ---

window.addSkill = async () => {
  const val = document.getElementById('newSkillInput').value;
  if (!val) return;

  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: val })
    });

    if (!res.ok) throw new Error('Erro ao criar skill');
    const newSkill = await res.json();

    STATE.skills.push(newSkill);
    renderUsers(); // Update list

    document.getElementById('newSkillInput').value = '';
  } catch (e) {
    Swal.fire('Erro', 'Falha ao adicionar skill.', 'error');
  }
};

window.deleteSkill = async (id) => {
  if (!confirm('Remover este departamento?')) return;
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/skills/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Erro');

    STATE.skills = STATE.skills.filter((s) => s.id !== id && s !== id);
    renderUsers();
  } catch (e) {
    Swal.fire('Erro', 'Falha ao remover skill.', 'error');
  }
};

window.deleteUser = async (id) => {
  if (!confirm('Remover este usuário permanentemente?')) return;

  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/agents/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      STATE.users = STATE.users.filter((u) => u.id !== id);
      renderUsers();
      Swal.fire('Removido', 'Usuário excluído.', 'success');
    } else {
      Swal.fire('Erro', 'Falha ao excluir.', 'error');
    }
  } catch (e) {
    console.error(e);
  }
};

window.handleMetaSave = async (e) => {
  e.preventDefault();

  // Backend expects waPhoneId, waAccessToken.
  const payload = {
    waPhoneId: document.getElementById('metaPhoneId').value,
    waAccessToken: document.getElementById('metaAccessToken').value || undefined
  };

  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    if (res.ok) Swal.fire('Sucesso', 'Configurações salvas!', 'success');
    else throw new Error('Falha ao salvar');
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', 'Falha ao salvar configurações.', 'error');
  }
};

// ============================================================
// NEW CONFIGURATION MANAGEMENT (WhatsApp API)
// ============================================================

window.loadConfiguration = async () => {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/configuration', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      // Configuration not found, leave form empty
      console.warn('Configuration not found (404)');
      return;
    }

    const data = await res.json();

    // IMPORTANTE: Nunca carregamos valores sensíveis no formulário
    // O backend NÃO retorna os valores, apenas o status
    // Formulário sempre começa vazio - admin deve preencher completo

    // Atualizar apenas status visual
    if (data.isConfigured) {
      updateConfigurationStatus(data.isConfigured);
    }
  } catch (error) {
    console.error('Error loading configuration:', error);
    // Don't throw - allow page to continue loading
  }
};

window.handleConfigSave = async (e) => {
  e.preventDefault();

  const payload = {
    phoneNumberId: document.getElementById('configPhoneNumberId').value,
    verifyToken: document.getElementById('configVerifyToken').value,
    whatsappToken: document.getElementById('configWhatsappToken').value,
    metaAppSecret: document.getElementById('configMetaAppSecret').value
  };

  // Validate all fields are filled
  if (
    !payload.phoneNumberId ||
    !payload.verifyToken ||
    !payload.whatsappToken ||
    !payload.metaAppSecret
  ) {
    return Swal.fire('Aviso', 'Todos os campos são obrigatórios!', 'warning');
  }

  try {
    const saveBtn = document.getElementById('saveConfigBtn');
    if (saveBtn) saveBtn.disabled = true;

    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/configuration', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Falha ao salvar');
    }

    const data = await res.json();
    updateConfigurationStatus(data.isConfigured);

    Swal.fire(
      'Sucesso!',
      'Configurações salvas e sincronizadas com sucesso! Webhooks já devem estar funcionando.',
      'success'
    );

    // Reload configuration
    await loadConfiguration();
  } catch (error) {
    console.error('Error saving configuration:', error);
    Swal.fire('Erro', error.message || 'Falha ao salvar configurações', 'error');
  } finally {
    const saveBtn = document.getElementById('saveConfigBtn');
    if (saveBtn) saveBtn.disabled = false;
  }
};

window.validateConfig = async () => {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/configuration/validate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await res.json();

    if (data.valid) {
      Swal.fire(
        'Configuração Válida!',
        'Todos os campos estão configurados corretamente. Webhooks funcionarão perfeitamente.',
        'success'
      );
    } else {
      const missing = data.missingFields.join(', ');
      Swal.fire('Campos Faltando', `Configure os seguintes campos: ${missing}`, 'warning');
    }
  } catch (error) {
    console.error('Error validating configuration:', error);
    Swal.fire('Erro', 'Falha ao validar configuração', 'error');
  }
};

window.resetConfigForm = () => {
  if (confirm('Deseja limpar o formulário? Isso não apagará os dados salvos.')) {
    document.getElementById('configPhoneNumberId').value = '';
    document.getElementById('configVerifyToken').value = '';
    document.getElementById('configWhatsappToken').value = '';
    document.getElementById('configMetaAppSecret').value = '';
  }
};

function updateConfigurationStatus(config) {
  const statusEl = document.getElementById('configStatus');
  if (!statusEl) return;

  if (config.allRequired) {
    statusEl.innerHTML =
      '<i class="bi bi-check-circle" style="color: #28a745"></i> Completa e funcionando!';
    statusEl.style.color = '#28a745';
  } else {
    const missing = [];
    if (!config.phoneNumberId) missing.push('Phone ID');
    if (!config.verifyToken) missing.push('Verify Token');
    if (!config.whatsappToken) missing.push('Access Token');
    if (!config.metaAppSecret) missing.push('App Secret');

    statusEl.innerHTML = `<i class="bi bi-exclamation-circle"></i> Faltam campos: ${missing.join(', ')}`;
    statusEl.style.color = '#dc3545';
  }
}

window.openModal = (modalId) => {
  const modal = new bootstrap.Modal(document.getElementById(modalId));
  modal.show();
};
