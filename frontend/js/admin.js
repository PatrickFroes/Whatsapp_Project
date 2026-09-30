let inMemoryToken = null;
function getSortedOptionKeys(options) {
  if (!options) return [];
  return Object.keys(options).sort((a, b) => {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return a.localeCompare(b);
  });
}

function getAdminToken() {
  const isIframe = window.self !== window.top;
  if (!isIframe) return null;
  return inMemoryToken || null;
}

function getAuthHeaders(extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  const token = getAdminToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function getRequestHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const token = getAdminToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

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
  const isIframe = window.self !== window.top;
  if (!isIframe) {
    localStorage.removeItem('token');
  }

  async function startAdmin(user) {
    STATE.currentUser = user;
    
    // Ocultar link de Webchat se não houver licença contratada
    const webchatLink = document.getElementById('sidebarWebchatLink');
    if (webchatLink) {
      if (user.tenant && user.tenant.featureWebchat === false) {
        webchatLink.style.display = 'none';
      } else {
        webchatLink.style.display = '';
      }
    }

    const token = getAdminToken();

    // Fetch Configs (Users, Skills, Meta)
    const resConfig = await fetch('/api/admin/config', {
      headers: getRequestHeaders()
    });
    if (resConfig.status === 401) return logout();
    if (!resConfig.ok) {
      throw new Error(`Failed to load config: ${resConfig.status}`);
    }
    const dataConfig = await resConfig.json();

    // Fetch URAs (List)
    const resUras = await fetch('/api/admin/uras', {
      headers: getRequestHeaders()
    });
    if (!resUras.ok) {
      throw new Error(`Failed to load URAs: ${resUras.status}`);
    }
    const dataUras = await resUras.json();

    // Fetch Pauses
    const resPauses = await fetch('/api/admin/pauses', {
      headers: getRequestHeaders()
    });
    const dataPauses = resPauses.ok ? await resPauses.json() : { reasons: [] };

    // Fetch Dispositions
    const resDispositions = await fetch('/api/admin/dispositions', {
      headers: getRequestHeaders()
    });
    const dataDispositions = resDispositions.ok ? await resDispositions.json() : { dispositions: [] };

    // Populate State
    STATE.all_uras = dataUras.uras || {
      Padrão: { start: { type: 'menu', message: 'Início', options: {} } }
    };
    STATE.active_ura_id = dataUras.active || 'Padrão';
    STATE.timeRouting = dataUras.timeRouting || { enabled: false, rules: [] };
    STATE.users = dataConfig.users || [];
    STATE.skills = dataConfig.skills || [];
    STATE.meta = dataConfig.meta || {};
    STATE.pause_reasons = dataPauses.reasons || [];
    STATE.close_dispositions = dataDispositions.dispositions || [];

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
    renderDispositionConfig();
    await loadTemplates(); // Load Templates
    await renderSettings();

    document.getElementById('loading-overlay').style.display = 'none';
  }

  // Lógica de Autenticação em Iframe (window.name)
  if (isIframe) {
    const tokenFromWindowName = window.name;
    if (tokenFromWindowName && tokenFromWindowName.startsWith('eyJ')) {
      inMemoryToken = tokenFromWindowName;

      try {
        const resMe = await fetch('/api/auth/me', {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${inMemoryToken}`
          }
        });
        if (!resMe.ok) {
          window.name = '';
          return logout();
        }
        window.name = ''; // Limpa o window.name imediatamente após validação bem-sucedida
        const user = await resMe.json();
        if (user.role !== 'ADMIN' && user.role !== 'OWNER' && user.role !== 'SUPER_ADMIN') {
          return logout();
        }
        await startAdmin(user);
      } catch (err) {
        console.error('[Admin] Iframe auth check failed:', err);
        window.name = '';
        return logout();
      }
    } else {
      // Iframe sem token (ex: F5) -> redireciona para login no iframe
      return logout();
    }
  } else {
    // Modo tradicional seguro via Cookies HttpOnly (Aba normal)
    try {
      const resMe = await fetch('/api/auth/me');
      if (!resMe.ok) return logout();
      const user = await resMe.json();
      if (user.role !== 'ADMIN' && user.role !== 'OWNER' && user.role !== 'SUPER_ADMIN') {
        return logout();
      }
      await startAdmin(user);
    } catch (err) {
      console.error('[Admin] Initialization error:', err);
      document.getElementById('loading-overlay').style.display = 'none';
      Swal.fire('Erro ao Carregar', `Falha na inicialização: ${err.message}`, 'error');
    }
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
    active: STATE.active_ura_id,
    timeRouting: STATE.timeRouting
  };

  try {
    const res = await fetch('/api/admin/uras', {
      method: 'POST',
      headers: getAuthHeaders(),
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
  // Impedir navegação para Webchat se não possuir licença
  if (viewName === 'webchat' && STATE.currentUser && STATE.currentUser.tenant && STATE.currentUser.tenant.featureWebchat === false) {
    Swal.fire('Não Autorizado', 'O canal de Webchat não está habilitado no seu plano. Contrate a licença para ativar.', 'warning');
    return;
  }

  // Hide all
  document.querySelectorAll('.view-section').forEach((el) => el.classList.add('d-none'));
  // Show Target
  document.getElementById(`view-${viewName}`).classList.remove('d-none');

  // Update Title
  const titles = {
    dashboard: 'Editor de Fluxo',
    users: 'Gerenciar Usuários',
    settings: 'Configurações',
    templates: 'Modelos de Mensagem',
    webchat: 'Conexões Webchat',
    telegram: 'Canal Telegram Bot'
  };
  document.getElementById('page-title').innerText = titles[viewName] || 'Broker Admin';

  // Update Nav Active State
  document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
  
  // Highlight active link
  const activeLink = Array.from(document.querySelectorAll('.nav-link')).find(l => l.getAttribute('onclick') && l.getAttribute('onclick').includes(`'${viewName}'`));
  if (activeLink) {
    activeLink.classList.add('active');
  }

  if (viewName === 'webchat') {
    loadWebchatConnections();
  } else if (viewName === 'telegram') {
    loadTelegramConfig();
  }
};

window.toggleSidebar = () => {
  if (window.innerWidth < 768) {
    document.getElementById('mainSidebar').classList.toggle('active');
    document.getElementById('mobileOverlay').classList.toggle('active');
  } else {
    document.getElementById('mainSidebar').classList.toggle('collapsed');
  }
};

window.logout = () => {
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('token');
  window.location.href = '/login.html';
};

// --- CANVAS 2D & EDITOR DE URA 2.0 ---

function calculateInitialLayout(nodes) {
  const visited = new Set();
  const levelCounts = {};
  const queue = [['start', 0]];

  while (queue.length > 0) {
    const [nodeId, level] = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodes[nodeId];
    if (!node) continue;

    // Se já tiver x e y atribuídos, mantemos
    if (node.x !== undefined && node.y !== undefined) continue;

    if (levelCounts[level] === undefined) {
      levelCounts[level] = 0;
    }

    node.x = 80 + level * 260; // 260px horizontal por nível
    node.y = 80 + levelCounts[level] * 180; // 180px vertical por nível
    levelCounts[level]++;

    // Adiciona adjacentes na fila
    if (node.type === 'conditional') {
      if (node.if_true) queue.push([node.if_true, level + 1]);
      if (node.if_false) queue.push([node.if_false, level + 1]);
    } else if (node.type === 'menu' || !node.type) {
      if (node.options) {
        Object.values(node.options).forEach(childId => {
          if (childId) queue.push([childId, level + 1]);
        });
      }
    } else if (node.next) {
      queue.push([node.next, level + 1]);
    }
  }

  // Posicionar nós órfãos
  Object.keys(nodes).forEach((nodeId, idx) => {
    const node = nodes[nodeId];
    if (node.x === undefined || node.y === undefined) {
      node.x = 100;
      node.y = 100 + idx * 180;
    }
  });
}

function getNodeTypeInfo(type) {
  const typeLabels = {
    text: { label: 'Mensagem', icon: 'bi-chat-left-text text-secondary' },
    auto: { label: 'Mensagem', icon: 'bi-chat-left-text text-secondary' },
    menu: { label: 'Menu / Opções', icon: 'bi-list-stars text-primary' },
    collect_data: { label: 'Coletar Dados', icon: 'bi-input-cursor-text text-success' },
    conditional: { label: 'Condição', icon: 'bi-signpost-split text-warning' },
    math_operation: { label: 'Matemática', icon: 'bi-calculator text-dark' },
    transfer: { label: 'Transferir', icon: 'bi-headset text-info' },
    transfer_agent: { label: 'Transferir', icon: 'bi-headset text-info' },
    transfer_queue: { label: 'Enfileirar', icon: 'bi-people text-info' },
    switch_flow: { label: 'Mudar Fluxo', icon: 'bi-arrow-left-right text-info' },
    api_call: { label: 'Chamada API', icon: 'bi-cloud-arrow-up text-primary' },
    set_data: { label: 'Set Variável', icon: 'bi-database text-warning' },
    end: { label: 'Encerrar', icon: 'bi-stop-circle text-danger' }
  };
  return typeLabels[type] || { label: 'Mensagem', icon: 'bi-chat-left-text text-secondary' };
}

function getNodePreviewText(node) {
  if (node.type === 'conditional') {
    if (Array.isArray(node.rules) && node.rules.length > 0) {
      return `${node.rules.length} Regra(s) lógica(s)`;
    }
    return node.condition || 'Sem condição';
  }
  if (node.type === 'set_data') return `${node.data_key || '?'} = ${node.data_value || '?'}`;
  if (node.type === 'math_operation') return `${node.target_variable || '?'} = ${node.expression || '?'}`;
  if (node.type === 'collect_data') return `Coletar em ${node.data_key || '?'}`;
  if (node.type === 'api_call') return node.api_url ? `${node.api_method || 'GET'} ${node.api_url}` : 'Chamada HTTP';
  if (node.type === 'switch_flow') return `Ir para fluxo: ${node.target_flow_id || '?'}`;
  return node.message || '...';
}

function getAnchorCoords(anchorId) {
  const anchor = document.getElementById(anchorId);
  const canvas = document.getElementById('tree-canvas');
  if (!anchor || !canvas) return null;

  const aRect = anchor.getBoundingClientRect();
  const cRect = canvas.getBoundingClientRect();

  return {
    x: aRect.left - cRect.left + aRect.width / 2,
    y: aRect.top - cRect.top + aRect.height / 2
  };
}

function drawBezierCurve(x1, y1, x2, y2, color = '#64748b', isActive = false) {
  const svg = document.getElementById('canvas-connections-svg');
  if (!svg) return;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  
  // Curvatura com suavização vertical
  const controlY = y1 + (y2 - y1) / 2;
  const d = `M ${x1} ${y1} C ${x1} ${controlY}, ${x2} ${controlY}, ${x2} ${y2}`;
  
  path.setAttribute('d', d);
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', isActive ? '3' : '2');
  path.setAttribute('fill', 'none');
  path.setAttribute('marker-end', isActive ? 'url(#arrow-active)' : 'url(#arrow)');
  
  svg.appendChild(path);
}

function drawConnections() {
  const svg = document.getElementById('canvas-connections-svg');
  if (!svg) return;

  // Limpar caminhos SVG anteriores
  svg.querySelectorAll('path').forEach(p => p.remove());

  const nodes = STATE.ura;
  if (!nodes) return;

  Object.keys(nodes).forEach(nodeId => {
    const node = nodes[nodeId];
    
    // 1. Conexões lineares
    if (['text', 'auto', 'api_call', 'set_data', 'collect_data', 'math_operation'].includes(node.type)) {
      const nextId = node.next;
      if (nextId && nodes[nextId]) {
        const p1 = getAnchorCoords(`anchor-${nodeId}-next`);
        const p2 = getAnchorCoords(`anchor-${nextId}-input`);
        if (p1 && p2) {
          drawBezierCurve(p1.x, p1.y, p2.x, p2.y, '#64748b', STATE.selectedNode === nodeId);
        }
      }
      
      // Se for api_call, tem também branches opcionais de sucesso e erro
      if (node.type === 'api_call') {
        if (node.on_success_next && nodes[node.on_success_next]) {
          const p1 = getAnchorCoords(`anchor-${nodeId}-next`);
          const p2 = getAnchorCoords(`anchor-${node.on_success_next}-input`);
          if (p1 && p2) drawBezierCurve(p1.x, p1.y, p2.x, p2.y, '#10b981', STATE.selectedNode === nodeId);
        }
        if (node.on_error_next && nodes[node.on_error_next]) {
          const p1 = getAnchorCoords(`anchor-${nodeId}-next`);
          const p2 = getAnchorCoords(`anchor-${node.on_error_next}-input`);
          if (p1 && p2) drawBezierCurve(p1.x, p1.y, p2.x, p2.y, '#ef4444', STATE.selectedNode === nodeId);
        }
      }
    }

    // 2. Conexões de Condicional (Verd/Falso)
    if (node.type === 'conditional') {
      if (node.if_true && nodes[node.if_true]) {
        const p1 = getAnchorCoords(`anchor-${nodeId}-true`);
        const p2 = getAnchorCoords(`anchor-${node.if_true}-input`);
        if (p1 && p2) {
          drawBezierCurve(p1.x, p1.y, p2.x, p2.y, '#10b981', STATE.selectedNode === nodeId);
        }
      }
      if (node.if_false && nodes[node.if_false]) {
        const p1 = getAnchorCoords(`anchor-${nodeId}-false`);
        const p2 = getAnchorCoords(`anchor-${node.if_false}-input`);
        if (p1 && p2) {
          drawBezierCurve(p1.x, p1.y, p2.x, p2.y, '#ef4444', STATE.selectedNode === nodeId);
        }
      }
    }

    // 3. Conexões de Menu (Opções)
    if ((node.type === 'menu' || !node.type) && node.options) {
      getSortedOptionKeys(node.options).forEach(optKey => {
        const childId = node.options[optKey];
        if (childId && nodes[childId]) {
          const p1 = getAnchorCoords(`anchor-${nodeId}-opt-${optKey}`);
          const p2 = getAnchorCoords(`anchor-${childId}-input`);
          if (p1 && p2) {
            drawBezierCurve(p1.x, p1.y, p2.x, p2.y, '#6366f1', STATE.selectedNode === nodeId);
          }
        }
      });
    }
  });
}

function renderTree() {
  const root = document.getElementById('tree-canvas');
  if (!root) return;

  root.innerHTML = ''; // Limpa

  const nodes = STATE.ura;
  if (!nodes || Object.keys(nodes).length === 0) return;

  // Layout inicial automático se necessário
  calculateInitialLayout(nodes);

  Object.keys(nodes).forEach(nodeId => {
    const node = nodes[nodeId];
    const isSel = STATE.selectedNode === nodeId ? 'selected' : '';
    const typeInfo = getNodeTypeInfo(node.type || 'menu');
    const nodePreview = getNodePreviewText(node);

    const div = document.createElement('div');
    div.id = `node-${nodeId}`;
    div.className = `node-box ${isSel}`;
    div.style.left = `${node.x || 100}px`;
    div.style.top = `${node.y || 100}px`;
    div.onclick = (e) => {
      e.stopPropagation();
      selectNode(nodeId);
    };
    div.ondblclick = (e) => {
      e.stopPropagation();
      deleteNode(nodeId);
    };

    let outputsHtml = '';
    if (node.type === 'menu' || !node.type) {
      const options = node.options || {};
      outputsHtml = '<div class="node-outputs-container">';
      getSortedOptionKeys(options).forEach(optKey => {
        outputsHtml += `
          <div class="node-branch-output" title="Opção ${optKey}">
            ${escapeHtml(optKey)}
            <div class="node-branch-anchor" id="anchor-${nodeId}-opt-${optKey}" onmousedown="startCreateConnection(event, '${nodeId}', 'opt-${optKey}')"></div>
          </div>
        `;
      });
      outputsHtml += '</div>';
    } else if (node.type === 'conditional') {
      outputsHtml = `
        <div class="node-outputs-container">
          <div class="node-branch-output bg-success text-white px-2 py-0 border-0" title="Verdadero">
            ✓ Sim
            <div class="node-branch-anchor" id="anchor-${nodeId}-true" onmousedown="startCreateConnection(event, '${nodeId}', 'true')"></div>
          </div>
          <div class="node-branch-output bg-danger text-white px-2 py-0 border-0" title="Falso">
            ✗ Não
            <div class="node-branch-anchor" id="anchor-${nodeId}-false" onmousedown="startCreateConnection(event, '${nodeId}', 'false')"></div>
          </div>
        </div>
      `;
    } else if (node.type !== 'end' && node.type !== 'transfer' && node.type !== 'transfer_agent' && node.type !== 'transfer_queue' && node.type !== 'switch_flow') {
      outputsHtml = `<div class="node-anchor node-output-anchor" id="anchor-${nodeId}-next" onmousedown="startCreateConnection(event, '${nodeId}', 'next')"></div>`;
    }

    const inputHtml = nodeId !== 'start' ? `<div class="node-anchor node-input-anchor" id="anchor-${nodeId}-input"></div>` : '';

    div.innerHTML = `
      <div class="node-header" onmousedown="startDragNode(event, '${nodeId}')">
        <i class="bi ${typeInfo.icon}"></i> ${typeInfo.label}
      </div>
      <div class="node-body">
        <div class="node-id">${nodeId}</div>
        <div class="text-truncate" style="max-width:160px; font-size:0.75rem" title="${escapeHtml(nodePreview)}">
          ${escapeHtml(nodePreview)}
        </div>
        ${outputsHtml}
      </div>
      ${inputHtml}
    `;

    root.appendChild(div);
  });

  // Redesenhar conexões (espera o DOM renderizar)
  setTimeout(drawConnections, 0);
}

// Mecanismo Drag-and-Drop
let dragNodeId = null;
let dragStartX = 0;
let dragStartY = 0;
let nodeStartX = 0;
let nodeStartY = 0;

function startDragNode(e, nodeId) {
  if (e.button !== 0) return; // Apenas clique esquerdo
  dragNodeId = nodeId;
  const node = STATE.ura[nodeId];
  if (!node) return;

  nodeStartX = node.x || 100;
  nodeStartY = node.y || 100;
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  document.addEventListener('mousemove', dragNode);
  document.addEventListener('mouseup', stopDragNode);
}

function dragNode(e) {
  if (!dragNodeId) return;

  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  const node = STATE.ura[dragNodeId];
  if (node) {
    // Snap na grade de 12px
    node.x = Math.max(0, Math.round((nodeStartX + dx) / 12) * 12);
    node.y = Math.max(0, Math.round((nodeStartY + dy) / 12) * 12);

    const el = document.getElementById(`node-${dragNodeId}`);
    if (el) {
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
    }

    drawConnections();
  }
}

function stopDragNode() {
  document.removeEventListener('mousemove', dragNode);
  document.removeEventListener('mouseup', stopDragNode);
  dragNodeId = null;
  saveAllURAs(false); // Salvar posições silenciosamente
}

window.selectNode = (id) => {
  STATE.selectedNode = id;
  renderTree(); // Highlight
  renderPropsPanel(id);
};

window.addNodeToCanvas = (type) => {
  const nodeId = 'no_' + Math.random().toString(36).substring(2, 9);
  
  const wrapper = document.getElementById('ura-canvas-wrapper');
  const scrollLeft = wrapper ? wrapper.scrollLeft : 0;
  const scrollTop = wrapper ? wrapper.scrollTop : 0;

  const nodeDefaults = {
    text: { type: 'text', message: 'Nova Mensagem', next: '', x: scrollLeft + 120, y: scrollTop + 120 },
    menu: { type: 'menu', message: 'Escolha uma opção:', options: { '1': '' }, x: scrollLeft + 120, y: scrollTop + 120 },
    collect_data: { type: 'collect_data', message: 'Digite sua informação:', data_key: 'var_coleta', next: '', x: scrollLeft + 120, y: scrollTop + 120 },
    conditional: { type: 'conditional', rules: [], if_true: '', if_false: '', x: scrollLeft + 120, y: scrollTop + 120 },
    math_operation: { type: 'math_operation', target_variable: 'resultado', expression: '{{variavel}} + 1', next: '', x: scrollLeft + 120, y: scrollTop + 120 },
    transfer: { type: 'transfer', message: 'Aguarde um instante...', dept: '', x: scrollLeft + 120, y: scrollTop + 120 },
    transfer_queue: { type: 'transfer_queue', message: 'Aguarde na fila...', dept: '', x: scrollLeft + 120, y: scrollTop + 120 },
    switch_flow: { type: 'switch_flow', target_flow_id: '', x: scrollLeft + 120, y: scrollTop + 120 },
    api_call: { type: 'api_call', api_method: 'GET', api_url: 'https://api.exemplo.com/dados', next: '', x: scrollLeft + 120, y: scrollTop + 120 },
    set_data: { type: 'set_data', data_key: 'status', data_value: 'ativo', next: '', x: scrollLeft + 120, y: scrollTop + 120 },
    end: { type: 'end', message: 'Atendimento encerrado.', x: scrollLeft + 120, y: scrollTop + 120 }
  };

  const newNode = nodeDefaults[type] || nodeDefaults.text;
  STATE.ura[nodeId] = newNode;
  
  renderTree();
  selectNode(nodeId);
  saveAllURAs(false);
};

window.deleteNode = (nodeId) => {
  if (nodeId === 'start') {
    return Swal.fire('Aviso', 'Não é possível excluir o bloco inicial!', 'warning');
  }
  
  Swal.fire({
    title: 'Apagar bloco?',
    text: `Deseja realmente apagar o bloco "${nodeId}"?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, apagar',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      delete STATE.ura[nodeId];
      
      // Desvincular nos outros nós
      Object.keys(STATE.ura).forEach(id => {
        const node = STATE.ura[id];
        if (node.next === nodeId) node.next = '';
        if (node.if_true === nodeId) node.if_true = '';
        if (node.if_false === nodeId) node.if_false = '';
        if (node.options) {
          Object.keys(node.options).forEach(optKey => {
            if (node.options[optKey] === nodeId) {
              node.options[optKey] = '';
            }
          });
        }
      });

      if (STATE.selectedNode === nodeId) {
        STATE.selectedNode = null;
        document.getElementById('props-panel').innerHTML = '<p class="text-muted text-center mt-5">Selecione um nó para editar</p>';
      }

      renderTree();
      saveAllURAs(false);
    }
  });
};

function getNodeSelectorOptions(currentNodeId, currentValue) {
  let html = `<option value="">Escolha o bloco...</option>`;
  Object.keys(STATE.ura).forEach(id => {
    if (id !== currentNodeId) {
      html += `<option value="${id}" ${id === currentValue ? 'selected' : ''}>${id} (${getNodeTypeInfo(STATE.ura[id].type).label})</option>`;
    }
  });
  return html;
}

// QUERY BUILDER CONDICIONAL ACTIONS
window.addRuleToNode = (nodeId) => {
  const node = STATE.ura[nodeId];
  if (!node) return;
  if (!Array.isArray(node.rules)) {
    node.rules = [];
  }
  node.rules.push({ left: '{{system.agents_online}}', op: '>', right: '0', join: 'and' });
  renderPropsPanel(nodeId);
  renderTree();
  saveAllURAs(false);
};

window.removeRuleFromNode = (nodeId, idx) => {
  const node = STATE.ura[nodeId];
  if (!node) return;
  if (Array.isArray(node.rules)) {
    node.rules.splice(idx, 1);
  }
  renderPropsPanel(nodeId);
  renderTree();
  saveAllURAs(false);
};

window.updateRuleProp = (nodeId, ruleIdx, key, val) => {
  const node = STATE.ura[nodeId];
  if (!node || !Array.isArray(node.rules) || !node.rules[ruleIdx]) return;
  node.rules[ruleIdx][key] = val;
  renderTree();
  saveAllURAs(false);
};

// --- LIGAÇÃO VISUAL DE ANCORAS E CONEXÕES 2D ---
let connSourceId = null;
let connSourceKey = null; // 'next', 'true', 'false', ou 'opt-X'
let connStartPoint = null;

window.startCreateConnection = (e, nodeId, key) => {
  e.preventDefault();
  e.stopPropagation();
  
  connSourceId = nodeId;
  connSourceKey = key;
  connStartPoint = getAnchorCoords(e.target.id);

  if (!connStartPoint) return;

  document.addEventListener('mousemove', dragConnection);
  document.addEventListener('mouseup', stopCreateConnection);
};

function dragConnection(e) {
  if (!connStartPoint) return;

  const canvas = document.getElementById('tree-canvas');
  const cRect = canvas.getBoundingClientRect();
  const mx = e.clientX - cRect.left;
  const my = e.clientY - cRect.top;

  // Redesenhar conexões existentes
  drawConnections();

  // Linha guia verde para a conexão temporária
  drawBezierCurve(connStartPoint.x, connStartPoint.y, mx, my, '#005c53', true);
}

function stopCreateConnection(e) {
  document.removeEventListener('mousemove', dragConnection);
  document.removeEventListener('mouseup', stopCreateConnection);

  const targetEl = document.elementFromPoint(e.clientX, e.clientY);
  const inputAnchor = targetEl ? targetEl.closest('.node-input-anchor') : null;

  if (inputAnchor) {
    const match = inputAnchor.id.match(/^anchor-(.+)-input$/);
    if (match) {
      const targetNodeId = match[1];
      connectNodes(connSourceId, connSourceKey, targetNodeId);
    }
  }

  // Limpar
  connSourceId = null;
  connSourceKey = null;
  connStartPoint = null;

  renderTree();
}

function connectNodes(sourceId, sourceKey, targetId) {
  const node = STATE.ura[sourceId];
  if (!node) return;

  if (sourceKey === 'next') {
    node.next = targetId;
  } else if (sourceKey === 'true') {
    node.if_true = targetId;
  } else if (sourceKey === 'false') {
    node.if_false = targetId;
  } else if (sourceKey.startsWith('opt-')) {
    const optKey = sourceKey.substring(4);
    if (node.options) {
      node.options[optKey] = targetId;
    }
  }

  renderPropsPanel(sourceId);
  saveAllURAs(false);
}

window.renameNodeId = (oldId, newId) => {
  newId = newId.trim().replace(/\s+/g, '_');
  if (!newId) return Swal.fire('Erro', 'O nome do bloco não pode estar vazio.', 'error');
  if (oldId === newId) return;
  if (STATE.ura[newId]) {
    return Swal.fire('Erro', `Já existe um bloco chamado "${newId}". Escolha outro nome.`, 'error');
  }

  // Copia os dados para a nova chave e apaga a chave antiga
  STATE.ura[newId] = STATE.ura[oldId];
  delete STATE.ura[oldId];

  // Atualizar referências
  Object.keys(STATE.ura).forEach(id => {
    const node = STATE.ura[id];
    if (node.next === oldId) node.next = newId;
    if (node.if_true === oldId) node.if_true = newId;
    if (node.if_false === oldId) node.if_false = newId;
    if (node.options) {
      Object.keys(node.options).forEach(optKey => {
        if (node.options[optKey] === oldId) {
          node.options[optKey] = newId;
        }
      });
    }
  });

  if (STATE.selectedNode === oldId) {
    STATE.selectedNode = newId;
  }

  renderTree();
  renderPropsPanel(newId);
  saveAllURAs(false);
  Swal.fire('Renomeado!', `O bloco foi renomeado para "${newId}".`, 'success');
};

function renderPropsPanel(id) {
  const pane = document.getElementById('props-panel');
  const node = STATE.ura[id];
  if (!node) return;

  const mkInput = (lbl, key, type = 'text', placeholder = '') => `
    <div class="mb-3">
        <label class="form-label small fw-bold">${lbl}</label>
        <input type="${type}" class="form-control form-control-sm" 
               value="${node[key] || ''}" onchange="updateNodeProp('${id}', '${key}', this.value)" placeholder="${placeholder}">
    </div>
  `;
  
  const mkSel = (lbl, key, opts) => {
    const hasValue = node[key] !== undefined && node[key] !== null && node[key] !== '';
    return `
      <div class="mb-3">
          <label class="form-label small fw-bold">${lbl}</label>
          <select class="form-select form-select-sm" onchange="updateNodeProp('${id}', '${key}', this.value)">
              ${key === 'dept' ? `<option value="" ${!hasValue ? 'selected' : ''}>Selecione um departamento...</option>` : ''}
              ${opts.map((o) => `<option value="${o.val}" ${node[key] === o.val ? 'selected' : ''}>${o.txt}</option>`).join('')}
          </select>
      </div>
    `;
  };

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

  if (node.type === 'auto') node.type = 'text';

  let content = `
    <h6 class="border-bottom pb-2 mb-3">Editar Bloco</h6>
    <div class="mb-3">
      <label class="form-label small fw-bold">ID / Nome do Bloco</label>
      <div class="input-group input-group-sm">
        <input type="text" id="rename-node-input" class="form-control" value="${id}" ${id === 'start' ? 'disabled' : ''}>
        <button class="btn btn-primary" ${id === 'start' ? 'disabled' : ''} onclick="renameNodeId('${id}', document.getElementById('rename-node-input').value)">Salvar</button>
      </div>
      <small class="text-muted" style="font-size:0.7rem">O ID identifica este bloco nas conexões do fluxo.</small>
    </div>
  `;

  content += mkSel('Tipo de Passo', 'type', [
    { val: 'text', txt: '📝 Mensagem (Texto)' },
    { val: 'menu', txt: '📋 Menu Interativo' },
    { val: 'collect_data', txt: '📥 Coletar Dados do Usuário' },
    { val: 'conditional', txt: '🔀 Condicional (Se/Senão)' },
    { val: 'math_operation', txt: '🧮 Operação Matemática' },
    { val: 'transfer', txt: '🎧 Transferir p/ Agente' },
    { val: 'transfer_queue', txt: '👥 Transferir p/ Fila' },
    { val: 'switch_flow', txt: '🔄 Mudar Fluxo URA' },
    { val: 'api_call', txt: '🌐 Chamada API (HTTP)' },
    { val: 'set_data', txt: '💾 Definir Variável' },
    { val: 'end', txt: '🔴 Finalizar Fluxo' }
  ]);

  const nodeType = node.type || 'menu';

  // Mensagens
  if (['text', 'menu', 'collect_data', 'transfer', 'transfer_queue', 'end'].includes(nodeType)) {
    content += mkTextarea('Mensagem', 'message', 3, 'Texto enviado ao usuário...');
  }

  // collect_data
  if (nodeType === 'collect_data') {
    content += mkInput('Nome da Variável', 'data_key', 'text', 'ex: nome, email, cpf');
    content += mkSel('Tipo da Variável', 'data_type', [
      { val: 'string', txt: 'Texto (String)' },
      { val: 'int', txt: 'Número Inteiro (Integer)' },
      { val: 'float', txt: 'Número Decimal (Float)' },
      { val: 'boolean', txt: 'Verdadeiro/Falso (Boolean)' },
      { val: 'date', txt: 'Data (Date)' },
      { val: 'json', txt: 'JSON (Objeto/Array)' }
    ]);
    content += `<div class="alert alert-light border py-1 px-2 mb-3" style="font-size:0.7rem">
            <i class="bi bi-info-circle"></i> A resposta será salva em <code>{{var_coleta}}</code>.
        </div>`;
    content += mkInput('Validação RegEx (opcional)', 'validation_pattern', 'text', 'ex: ^[\\d]{11}$');
    content += mkInput('Mensagem de Erro (validação)', 'validation_error', 'text', 'ex: CPF inválido.');
  }

  // math_operation
  if (nodeType === 'math_operation') {
    content += mkInput('Variável de Destino', 'target_variable', 'text', 'ex: total_fatura');
    content += mkInput('Expressão Aritmética', 'expression', 'text', 'ex: {{subtotal}} * 1.1');
    content += `<div class="alert alert-light border py-1 px-2 mb-3" style="font-size:0.7rem">
            <i class="bi bi-info-circle"></i> Use variáveis como <code>{{system.agents_online}}</code> ou <code>{{system.queue_size}}</code>.
        </div>`;
  }

  // switch_flow
  if (nodeType === 'switch_flow') {
    let flowOpts = '';
    Object.keys(STATE.all_uras).forEach(flowId => {
      flowOpts += `<option value="${flowId}" ${flowId === node.target_flow_id ? 'selected' : ''}>${flowId}</option>`;
    });
    content += `
      <div class="mb-3">
        <label class="form-label small fw-bold">Fluxo de Destino</label>
        <select class="form-select form-select-sm" onchange="updateNodeProp('${id}', 'target_flow_id', this.value)">
          <option value="">Selecione um fluxo...</option>
          ${flowOpts}
        </select>
      </div>
    `;
  }

  // transfer / transfer_queue
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

  // api_call
  if (nodeType === 'api_call') {
    content += mkInput('URL da API', 'api_url', 'text', 'https://api.exemplo.com/endpoint');
    content += mkSel('Método HTTP', 'api_method', [
      { val: 'GET', txt: 'GET' },
      { val: 'POST', txt: 'POST' },
      { val: 'PUT', txt: 'PUT' },
      { val: 'DELETE', txt: 'DELETE' }
    ]);
    content += mkJsonArea('Headers (JSON)', 'api_headers', 3, '{"API-KEY": "{{api_key}}"}');
    content += mkJsonArea('Body (JSON)', 'api_body', 4, '{"name": "{{nome}}"}');
    content += mkInput('Salvar Resposta na Variável', 'api_save_var', 'text', 'api_response');
    content += mkJsonArea('Mapear Campos (JSON)', 'api_map_fields', 2, '{"ticket_id": "data.id"}');
    content += mkInput('Mensagem de Sucesso (opcional)', 'on_success_message', 'text');
    content += mkInput('Mensagem de Erro (opcional)', 'on_error_message', 'text');
  }

  // set_data
  if (nodeType === 'set_data') {
    content += mkInput('Nome da Chave', 'data_key', 'text', 'ex: status');
    content += mkSel('Tipo da Variável', 'data_type', [
      { val: 'string', txt: 'Texto (String)' },
      { val: 'int', txt: 'Número Inteiro (Integer)' },
      { val: 'float', txt: 'Número Decimal (Float)' },
      { val: 'boolean', txt: 'Verdadeiro/Falso (Boolean)' },
      { val: 'date', txt: 'Data (Date)' },
      { val: 'json', txt: 'JSON (Objeto/Array)' }
    ]);
    content += mkInput('Valor', 'data_value', 'text', 'ex: ativo');
  }

  // === CONEXÕES ===
  content += `<h6 class="border-bottom pb-2 mb-3 mt-4">Conexões</h6>`;

  // Tipos com fluxo linear
  if (['text', 'collect_data', 'set_data', 'math_operation'].includes(nodeType)) {
    content += `
      <div class="mb-3">
        <label class="form-label small fw-bold">Próximo Bloco</label>
        <select class="form-select form-select-sm" onchange="updateNodeProp('${id}', 'next', this.value)">
          ${getNodeSelectorOptions(id, node.next)}
        </select>
      </div>
      <button class="btn btn-sm btn-outline-primary w-100 mb-2" onclick="createChildNode('${id}', 'next')">+ Criar Novo Bloco</button>
    `;
  }
  // api_call
  else if (nodeType === 'api_call') {
    content += `
      <div class="mb-3">
        <label class="form-label small fw-bold">Próximo Bloco (Padrão)</label>
        <select class="form-select form-select-sm" onchange="updateNodeProp('${id}', 'next', this.value)">
          ${getNodeSelectorOptions(id, node.next)}
        </select>
      </div>
      <button class="btn btn-sm btn-outline-primary w-100 mb-2" onclick="createChildNode('${id}', 'next')">+ Criar Novo Bloco</button>
      
      <div class="mb-3">
        <label class="form-label small fw-bold text-success">Se Sucesso, Ir Para</label>
        <select class="form-select form-select-sm border-success" onchange="updateNodeProp('${id}', 'on_success_next', this.value)">
          ${getNodeSelectorOptions(id, node.on_success_next)}
        </select>
      </div>
      <div class="mb-3">
        <label class="form-label small fw-bold text-danger">Se Erro, Ir Para</label>
        <select class="form-select form-select-sm border-danger" onchange="updateNodeProp('${id}', 'on_error_next', this.value)">
          ${getNodeSelectorOptions(id, node.on_error_next)}
        </select>
      </div>
    `;
  }
  // conditional: Query Builder de Regras
  else if (nodeType === 'conditional') {
    const rules = node.rules || [];
    let rulesHtml = '<div class="fw-bold small text-muted mb-2">Regras de Decisão</div>';
    
    rules.forEach((rule, idx) => {
      rulesHtml += `
        <div class="card p-2 mb-2 bg-light border">
          <div class="d-flex justify-content-between mb-1">
            <span class="small fw-bold text-secondary">Regra #${idx + 1}</span>
            <button class="btn btn-xs btn-outline-danger py-0 px-1" onclick="removeRuleFromNode('${id}', ${idx})"><i class="bi bi-trash" style="font-size: 0.7rem;"></i></button>
          </div>
          ${idx > 0 ? `
            <div class="mb-2">
              <select class="form-select form-select-sm" style="font-size:0.7rem;" onchange="updateRuleProp('${id}', ${idx}, 'join', this.value)">
                <option value="and" ${rule.join === 'and' ? 'selected' : ''}>E (AND)</option>
                <option value="or" ${rule.join === 'or' ? 'selected' : ''}>OU (OU)</option>
              </select>
            </div>
          ` : ''}
          <div class="mb-1">
            <input type="text" class="form-control form-control-sm" style="font-size:0.75rem;" value="${rule.left || ''}" onchange="updateRuleProp('${id}', ${idx}, 'left', this.value)" placeholder="Variável (ex: {{system.agents_online}})">
          </div>
          <div class="mb-1">
            <select class="form-select form-select-sm" style="font-size:0.75rem;" onchange="updateRuleProp('${id}', ${idx}, 'op', this.value)">
              <option value="==" ${rule.op === '==' ? 'selected' : ''}>Igual (==)</option>
              <option value="!=" ${rule.op === '!=' ? 'selected' : ''}>Diferente (!=)</option>
              <option value=">" ${rule.op === '>' ? 'selected' : ''}>Maior que (&gt;)</option>
              <option value="<" ${rule.op === '<' ? 'selected' : ''}>Menor que (&lt;)</option>
              <option value=">=" ${rule.op === '>=' ? 'selected' : ''}>Maior ou igual (&gt;=)</option>
              <option value="<=" ${rule.op === '<=' ? 'selected' : ''}>Menor ou igual (&lt;=)</option>
              <option value="contains" ${rule.op === 'contains' ? 'selected' : ''}>Contém</option>
            </select>
          </div>
          <div>
            <input type="text" class="form-control form-control-sm" style="font-size:0.75rem;" value="${rule.right || ''}" onchange="updateRuleProp('${id}', ${idx}, 'right', this.value)" placeholder="Valor (ex: 0)">
          </div>
        </div>
      `;
    });

    rulesHtml += `<button class="btn btn-sm btn-outline-primary w-100 mb-3" onclick="addRuleToNode('${id}')"><i class="bi bi-plus-lg"></i> Adicionar Regra</button>`;

    content += `
      ${rulesHtml}
      <div class="mb-3">
        <label class="form-label small fw-bold text-success">Se VERDADEIRO (✓)</label>
        <select class="form-select form-select-sm border-success" onchange="updateNodeProp('${id}', 'if_true', this.value)">
          ${getNodeSelectorOptions(id, node.if_true)}
        </select>
      </div>
      <button class="btn btn-sm btn-outline-success w-100 mb-2" onclick="createChildNode('${id}', 'if_true')">+ Criar Bloco (Verdadeiro)</button>
      
      <div class="mb-3">
        <label class="form-label small fw-bold text-danger">Se FALSO (✗)</label>
        <select class="form-select form-select-sm border-danger" onchange="updateNodeProp('${id}', 'if_false', this.value)">
          ${getNodeSelectorOptions(id, node.if_false)}
        </select>
      </div>
      <button class="btn btn-sm btn-outline-danger w-100 mb-2" onclick="createChildNode('${id}', 'if_false')">+ Criar Bloco (Falso)</button>
    `;
  }
  // menu
  else if (nodeType === 'menu') {
    content += `<div id="options-list">`;
    getSortedOptionKeys(node.options).forEach((opt) => {
      content += `
        <div class="card p-2 mb-2 bg-light border">
          <div class="input-group input-group-sm mb-2">
            <span class="input-group-text small fw-bold">Opção</span>
            <input type="text" class="form-control" value="${opt}" onchange="renameOption('${id}', '${opt}', this.value)">
            <button class="btn btn-outline-danger" onclick="deleteOption('${id}', '${opt}')"><i class="bi bi-trash"></i></button>
          </div>
          <div class="mb-1">
            <select class="form-select form-select-sm" onchange="updateMenuOptionDest('${id}', '${opt}', this.value)">
              ${getNodeSelectorOptions(id, node.options[opt])}
            </select>
          </div>
          <button class="btn btn-xs btn-outline-primary py-0 px-2 text-start" style="font-size:0.7rem;" onclick="createMenuChildNode('${id}', '${opt}')">+ Criar bloco para opção ${opt}</button>
        </div>
      `;
    });
    content += `</div>`;
    content += `<button class="btn btn-sm btn-outline-primary w-100" onclick="addOption('${id}')">+ Adicionar Opção</button>`;
  }
  // switch_flow, transfer, transfer_queue, end
  else if (['transfer', 'transfer_queue', 'switch_flow', 'end'].includes(nodeType)) {
    content += `<p class="text-muted small text-center"><i class="bi bi-info-circle"></i> Este tipo de bloco finaliza o fluxo local.</p>`;
  }

  // Delete
  if (id !== 'start') {
    content += `<hr><button class="btn btn-danger btn-sm w-100 mb-3" onclick="deleteNode('${id}')">Excluir Bloco</button>`;
  }

  pane.innerHTML = content;
}

window.updateMenuOptionDest = (parentId, optionKey, targetNodeId) => {
  STATE.ura[parentId].options[optionKey] = targetNodeId;
  renderTree();
  saveAllURAs(false);
};

window.createMenuChildNode = (parentId, optionKey) => {
  const childId = 'no_' + Math.random().toString(36).substring(2, 9);
  const pNode = STATE.ura[parentId];
  
  STATE.ura[childId] = {
    type: 'text',
    message: 'Nova Mensagem',
    next: '',
    x: (pNode.x || 100) + 260,
    y: (pNode.y || 100) + 120
  };
  pNode.options[optionKey] = childId;
  
  renderTree();
  selectNode(childId);
  saveAllURAs(false);
};

window.updateNodeProp = (id, key, val) => {
  STATE.ura[id][key] = val;

  if (key === 'type') {
    const typeProps = {
      text: ['message', 'next', 'x', 'y'],
      menu: ['message', 'options', 'x', 'y'],
      collect_data: ['message', 'data_key', 'data_type', 'validation_pattern', 'validation_error', 'next', 'x', 'y'],
      conditional: ['condition', 'rules', 'if_true', 'if_false', 'x', 'y'],
      transfer: ['message', 'dept', 'x', 'y'],
      transfer_queue: ['message', 'dept', 'x', 'y'],
      math_operation: ['target_variable', 'expression', 'next', 'x', 'y'],
      switch_flow: ['target_flow_id', 'x', 'y'],
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
        'next',
        'x',
        'y'
      ],
      set_data: ['data_key', 'data_value', 'data_type', 'next', 'x', 'y'],
      end: ['message', 'x', 'y']
    };
    
    // Preservar x e y e type ao limpar
    const allowed = new Set(['type', 'x', 'y', ...(typeProps[val] || [])]);
    Object.keys(STATE.ura[id]).forEach((k) => {
      if (!allowed.has(k)) delete STATE.ura[id][k];
    });
    
    if (val === 'menu' && !STATE.ura[id].options) STATE.ura[id].options = {};
    if (val === 'conditional' && !STATE.ura[id].rules) STATE.ura[id].rules = [];
    
    renderPropsPanel(id);
  }
  
  renderTree();
};

window.updateNodeJsonProp = (id, key, raw) => {
  try {
    STATE.ura[id][key] = JSON.parse(raw);
  } catch (e) {
    STATE.ura[id][key] = raw;
  }
  renderTree();
};

window.createChildNode = (parentId, relationKey) => {
  const childId = 'no_' + Math.random().toString(36).substring(2, 9);
  const parentNode = STATE.ura[parentId];
  
  STATE.ura[childId] = {
    type: 'text',
    message: 'Nova Mensagem',
    next: '',
    x: (parentNode.x || 100) + 260,
    y: (parentNode.y || 100) + (relationKey === 'if_false' ? 150 : 0)
  };
  
  parentNode[relationKey] = childId;
  
  renderTree();
  selectNode(childId);
  saveAllURAs(false);
};

window.addOption = (parentId) => {
  const opts = STATE.ura[parentId].options || {};
  const nextNum = Object.keys(opts).length + 1;
  STATE.ura[parentId].options[String(nextNum)] = '';
  renderTree();
  renderPropsPanel(parentId);
  saveAllURAs(false);
};

window.deleteOption = (parentId, key) => {
  delete STATE.ura[parentId].options[key];
  renderTree();
  renderPropsPanel(parentId);
  saveAllURAs(false);
};

window.renameOption = (parentId, oldKey, newKey) => {
  if (!newKey || STATE.ura[parentId].options[newKey]) return;
  const target = STATE.ura[parentId].options[oldKey];
  delete STATE.ura[parentId].options[oldKey];
  STATE.ura[parentId].options[newKey] = target;
  renderTree();
  renderPropsPanel(parentId);
  saveAllURAs(false);
};

window.navToNode = (id) => selectNode(id);

// --- SETTINGS & USERS RENDERERS ---

function renderUsers() {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  tbody.innerHTML = STATE.users
    .map((u) => {
      // 1. Processar Avatar e Email Redundante
      const hasName = u.name && u.name.trim() !== '';
      const name = hasName ? u.name.trim() : u.email;
      const initials = name.split(/[\s@._]+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase().substring(0, 2) || 'US';
      const showSubEmail = hasName && u.name !== u.email;
      
      // 2. Padronizar Regra/Role
      let roleClass = 'badge-role-agent';
      let roleLabel = 'ATENDENTE';
      if (u.role === 'OWNER' || u.role === 'ADMIN') {
        roleClass = 'badge-role-owner';
        roleLabel = u.role === 'OWNER' ? 'PROPRIETÁRIO' : 'ADMINISTRADOR';
      } else if (u.role === 'SUPERVISOR') {
        roleClass = 'badge-role-supervisor';
        roleLabel = 'SUPERVISOR';
      }

      // 3. Processar Departamentos (Skills)
      const skillsArr = u.skills && Array.isArray(u.skills)
        ? u.skills.map((s) => (typeof s === 'string' ? s : s.skill?.name || s.name || '?'))
        : [];
      const skillsHtml = skillsArr.length > 0 
        ? skillsArr.map(s => `<span class="badge-user-skill">${escapeHtml(s)}</span>`).join('')
        : `<span class="text-muted small italic">—</span>`;

      // 4. Limites com Contraste
      const limitActive = u.maxActiveChats !== undefined ? u.maxActiveChats : 5;
      const limitReceived = u.maxReceivedChats !== undefined ? u.maxReceivedChats : 5;

      return `
        <tr>
            <td>
                <div class="user-avatar-container">
                    <div class="user-avatar-circle" title="${escapeHtml(name)}">${escapeHtml(initials)}</div>
                    <div>
                        <div class="fw-bold text-dark">${escapeHtml(name)}</div>
                        ${showSubEmail ? `<div class="text-muted small">${escapeHtml(u.email)}</div>` : ''}
                    </div>
                </div>
            </td>
            <td><span class="badge-role-custom ${roleClass}">${escapeHtml(roleLabel)}</span></td>
            <td>${skillsHtml}</td>
            <td>
                <span class="badge-limit badge-limit-active" title="Chats Ativos"><i class="bi bi-chat-fill me-1"></i>${limitActive} Ativos</span>
                <span class="badge-limit badge-limit-received" title="Chats Recebidos"><i class="bi bi-box-arrow-in-down me-1"></i>${limitReceived} Recebidos</span>
            </td>
            <td>
                <div class="d-flex gap-2">
                    <button class="btn-action-edit" onclick="showNewUserModal('${u.id}')" title="Editar Usuário">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                    <button class="btn-action-delete" onclick="deleteUser('${u.id}')" title="Excluir Usuário">
                        <i class="bi bi-trash3"></i>
                    </button>
                </div>
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
        <div class="skill-card">
            <span class="skill-icon"><i class="bi bi-diagram-2-fill"></i></span>
            <span class="skill-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <button class="skill-delete-btn" onclick="deleteSkill('${escapeHtml(id)}')" title="Remover Departamento">
                <i class="bi bi-x"></i>
            </button>
        </div>`;
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
  await loadGeneralSettings();
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
    const res = await fetch('/api/admin/pauses', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ list: newList })
    });
    if (res.ok) Swal.fire('Salvo', 'Pausas atualizadas com sucesso!', 'success');
    else throw new Error('Falha ao salvar');
  } catch (e) {
    Swal.fire('Erro', e.message, 'error');
  }
};

// --- DISPOSITIONS CONFIGURATION ---

function renderDispositionConfig() {
  const tbody = document.getElementById('dispositions-table-body');
  if (!tbody) return;

  const list = STATE.close_dispositions || [];
  tbody.innerHTML = list
    .map(
      (d, index) => `
        <tr>
            <td><input type="text" class="form-control form-control-sm disposition-label" value="${d.label}" placeholder="Motivo (ex: Dúvida Sanada)"></td>
            <td class="text-end">
                <button class="btn btn-link btn-sm text-danger p-0" onclick="removeDispositionRow(${index})" title="Remover">
                    <i class="bi bi-x-circle-fill"></i>
                </button>
            </td>
        </tr>
    `
    )
    .join('');
}

window.addDispositionRow = () => {
  if (!STATE.close_dispositions) STATE.close_dispositions = [];
  STATE.close_dispositions.push({ label: '' });
  renderDispositionConfig();
};

window.removeDispositionRow = (index) => {
  STATE.close_dispositions.splice(index, 1);
  renderDispositionConfig();
};

window.saveDispositions = async () => {
  // Harvest data from inputs to sync state
  const rows = document.querySelectorAll('#dispositions-table-body tr');
  const newList = [];
  rows.forEach((row) => {
    const label = row.querySelector('.disposition-label').value.trim();
    if (label) newList.push({ label });
  });
  STATE.close_dispositions = newList;

  try {
    const res = await fetch('/api/admin/dispositions', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ list: newList })
    });
    if (res.ok) Swal.fire('Salvo', 'Encerramentos atualizados com sucesso!', 'success');
    else throw new Error('Falha ao salvar');
  } catch (e) {
    Swal.fire('Erro', e.message, 'error');
  }
};

// --- TEMPLATES ---

window.syncTemplates = async () => {
  Swal.fire({ title: 'Sincronizando...', didOpen: () => Swal.showLoading() });

  try {
    const res = await fetch('/api/templates/sync', {
      method: 'POST',
      headers: getAuthHeaders()
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
  try {
    const res = await fetch('/api/templates', {
      headers: getRequestHeaders()
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
  document.getElementById('frmUserMaxActiveChats').value = user.maxActiveChats !== undefined ? user.maxActiveChats : 5;
  document.getElementById('frmUserMaxReceivedChats').value = user.maxReceivedChats !== undefined ? user.maxReceivedChats : 5;

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
  const maxActiveChats = parseInt(document.getElementById('frmUserMaxActiveChats').value, 10) || 5;
  const maxReceivedChats = parseInt(document.getElementById('frmUserMaxReceivedChats').value, 10) || 5;

  let skills = [];
  if (role === 'AGENT') {
    document.querySelectorAll('#frmUserSkills input:checked').forEach((c) => skills.push(c.value));
  }

  if (!name || !email) return Swal.fire('Erro', 'Nome e Email obrigatórios', 'error');

  const payload = { name, email, role, skills, maxActiveChats, maxReceivedChats };
  if (pass) payload.password = pass;

  try {
    let url = '/api/admin/agents';
    let method = 'POST';

    if (mode === 'edit' && id) {
      url = `/api/admin/agents/${id}`;
      method = 'PUT';
    }

    const res = await fetch(url, {
      method: method,
      headers: getAuthHeaders(),
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
    const res = await fetch('/api/admin/skills', {
      method: 'POST',
      headers: getAuthHeaders(),
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
    const res = await fetch(`/api/admin/skills/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
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
    const res = await fetch(`/api/admin/agents/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
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

  // Backend expects phoneNumberId, whatsappToken, metaAppSecret, verifyToken
  const payload = {
    phoneNumberId: document.getElementById('metaPhoneId').value || undefined,
    whatsappToken: document.getElementById('metaAccessToken').value || undefined
  };

  try {
    const token = getAdminToken();
    const res = await fetch('/api/configuration', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });

    if (res.ok) Swal.fire('Sucesso', 'Configurações salvas!', 'success');
    else {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Falha ao salvar');
    }
  } catch (e) {
    Swal.fire('Erro', e.message, 'error');
  }
};

// ============================================================
// NEW CONFIGURATION MANAGEMENT (WhatsApp API)
// ============================================================

window.loadConfiguration = async () => {
  try {
    const token = getAdminToken();
    const res = await fetch('/api/admin/configuration', {
      headers: getRequestHeaders()
    });

    if (!res.ok) {
      console.warn('Configuration not found (404)');
      return;
    }

    const data = await res.json();
    STATE.configurations = data || [];
    renderConnectionsTable();
  } catch (error) {
    console.error('Error loading configuration:', error);
  }
};

function renderConnectionsTable() {
  const tbody = document.getElementById('connections-table-body');
  if (!tbody) return;

  const list = STATE.configurations || [];
  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-muted py-4">Nenhuma conexão configurada.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(c => {
    let statusClass = 'bg-secondary';
    let statusText = c.status || 'DESCONECTADO';
    if (c.status === 'CONNECTED') {
      statusClass = 'bg-success';
      statusText = 'Conectado';
    } else if (c.status === 'ERROR') {
      statusClass = 'bg-danger';
      statusText = 'Erro';
    }

    return `
      <tr>
        <td><strong>${escapeHtml(c.name || 'Conexão')}</strong></td>
        <td><code>${escapeHtml(c.phoneNumberId || '')}</code></td>
        <td><code>${escapeHtml(c.wabaId || '-')}</code></td>
        <td><span class="badge ${statusClass}">${statusText}</span></td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-info me-1" onclick="validateConfig('${c.id}')" title="Validar Conexão">
            <i class="bi bi-check-circle"></i> Validar
          </button>
          <button class="btn btn-sm btn-outline-primary me-1" onclick="showEditConnectionModal('${c.id}')" title="Editar">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteConnection('${c.id}')" title="Excluir">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.showNewConnectionModal = () => {
  document.getElementById('connId').value = '';
  document.getElementById('connName').value = '';
  document.getElementById('connPhoneNumberId').value = '';
  document.getElementById('connWabaId').value = '';
  document.getElementById('connVerifyToken').value = '';
  document.getElementById('connWhatsappToken').value = '';
  document.getElementById('connMetaAppSecret').value = '';

  document.getElementById('connectionModalTitle').innerHTML = '<i class="bi bi-telephone"></i> Nova Conexão WhatsApp';
  
  // Set required attributes for new connection
  document.getElementById('connVerifyToken').required = true;
  document.getElementById('connWhatsappToken').required = true;
  document.getElementById('connMetaAppSecret').required = true;

  document.getElementById('connVerifyTokenHelp').innerText = 'Token configurado no webhook Meta.';
  document.getElementById('connWhatsappTokenHelp').innerText = 'Token de acesso permanente de sua app Meta.';
  document.getElementById('connMetaAppSecretHelp').innerText = 'Usado para validar assinatura HMAC dos webhooks.';

  new bootstrap.Modal('#connectionModal').show();
};

window.showEditConnectionModal = (id) => {
  const c = (STATE.configurations || []).find(x => x.id === id);
  if (!c) return;

  document.getElementById('connId').value = c.id;
  document.getElementById('connName').value = c.name || '';
  document.getElementById('connPhoneNumberId').value = c.phoneNumberId || '';
  document.getElementById('connWabaId').value = c.wabaId || '';
  document.getElementById('connVerifyToken').value = '';
  document.getElementById('connWhatsappToken').value = '';
  document.getElementById('connMetaAppSecret').value = '';

  document.getElementById('connectionModalTitle').innerHTML = '<i class="bi bi-telephone"></i> Editar Conexão WhatsApp';
  
  // Remove required attributes for editing
  document.getElementById('connVerifyToken').required = false;
  document.getElementById('connWhatsappToken').required = false;
  document.getElementById('connMetaAppSecret').required = false;

  document.getElementById('connVerifyTokenHelp').innerText = 'Deixe em branco para manter o atual.';
  document.getElementById('connWhatsappTokenHelp').innerText = 'Deixe em branco para manter o atual.';
  document.getElementById('connMetaAppSecretHelp').innerText = 'Deixe em branco para manter o atual.';

  new bootstrap.Modal('#connectionModal').show();
};

window.handleConnectionSave = async (e) => {
  e.preventDefault();

  const id = document.getElementById('connId').value;
  const payload = {
    name: document.getElementById('connName').value || undefined,
    phoneNumberId: document.getElementById('connPhoneNumberId').value || undefined,
    wabaId: document.getElementById('connWabaId').value || null
  };

  if (id) {
    payload.id = id;
  }

  const verifyToken = document.getElementById('connVerifyToken').value;
  const whatsappToken = document.getElementById('connWhatsappToken').value;
  const metaAppSecret = document.getElementById('connMetaAppSecret').value;

  if (verifyToken) payload.verifyToken = verifyToken;
  if (whatsappToken) payload.whatsappToken = whatsappToken;
  if (metaAppSecret) payload.metaAppSecret = metaAppSecret;

  try {
    const saveBtn = document.getElementById('saveConnBtn');
    if (saveBtn) saveBtn.disabled = true;

    const token = getAdminToken();
    const res = await fetch('/api/admin/configuration', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Falha ao salvar');
    }

    Swal.fire('Sucesso!', 'Conexão salva e sincronizada!', 'success');

    // Close modal
    const modalEl = document.getElementById('connectionModal');
    const modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) {
      modalInstance.hide();
    }

    await loadConfiguration();
  } catch (error) {
    console.error('Error saving connection:', error);
    Swal.fire('Erro', error.message || 'Falha ao salvar conexão', 'error');
  } finally {
    const saveBtn = document.getElementById('saveConnBtn');
    if (saveBtn) saveBtn.disabled = false;
  }
};

window.validateConfig = async (id = null) => {
  try {
    const token = getAdminToken();
    const res = await fetch('/api/admin/configuration/validate', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ id })
    });

    const data = await res.json();

    if (data.valid) {
      Swal.fire(
        'Conexão Válida!',
        'A API do WhatsApp respondeu com sucesso para esta conexão!',
        'success'
      );
    } else {
      Swal.fire('Falha na Validação', data.message || 'Erro de validação', 'error');
    }
    await loadConfiguration();
  } catch (error) {
    console.error('Error validating configuration:', error);
    Swal.fire('Erro', 'Falha ao validar conexão', 'error');
  }
};

window.deleteConnection = async (id) => {
  const result = await Swal.fire({
    title: 'Confirmar exclusão?',
    text: 'Tem certeza que deseja excluir esta conexão de WhatsApp?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#3085d6',
    confirmButtonText: 'Sim, excluir!',
    cancelButtonText: 'Cancelar'
  });

  if (!result.isConfirmed) return;

  try {
    const token = getAdminToken();
    const res = await fetch(`/api/admin/configuration/${id}`, {
      method: 'DELETE',
      headers: getRequestHeaders()
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.details || err.error || 'Falha ao deletar');
    }

    Swal.fire('Deletado!', 'A conexão foi removida com sucesso.', 'success');
    await loadConfiguration();
  } catch (error) {
    console.error('Error deleting connection:', error);
    Swal.fire('Erro', error.message, 'error');
  }
};

window.resetConfigForm = () => {
  if (confirm('Deseja limpar o formulário? Isso não apagará os dados salvos.')) {
    document.getElementById('connName').value = '';
    document.getElementById('connPhoneNumberId').value = '';
    document.getElementById('connWabaId').value = '';
    document.getElementById('connVerifyToken').value = '';
    document.getElementById('connWhatsappToken').value = '';
    document.getElementById('connMetaAppSecret').value = '';
  }
};

function updateConfigurationStatus(config) {
  // Mantido para compatibilidade, sem efeitos colaterais
}

window.openModal = (modalId) => {
  const modal = new bootstrap.Modal(document.getElementById(modalId));
  modal.show();
};

window.toggleSurveyFlowSelect = () => {
  const enabled = document.getElementById('surveyEnabledInput').checked;
  const select = document.getElementById('surveyFlowSelect');
  if (select) select.disabled = !enabled;
};

window.loadGeneralSettings = async () => {
  try {
    const token = getAdminToken();

    // 1. Carregar fluxos da URA para popular o select
    const urasRes = await fetch('/api/admin/uras', {
      headers: getRequestHeaders()
    });
    if (urasRes.ok) {
      const urasData = await urasRes.json();
      const allUras = urasData.uras || {};
      const surveySelect = document.getElementById('surveyFlowSelect');
      if (surveySelect) {
        surveySelect.innerHTML = '<option value="">Selecione um fluxo de pesquisa...</option>';
        Object.keys(allUras).forEach(key => {
          const opt = document.createElement('option');
          opt.value = key;
          opt.textContent = key;
          surveySelect.appendChild(opt);
        });
      }
    }

    // 2. Carregar configurações gerais
    const res = await fetch('/api/admin/settings', {
      headers: getRequestHeaders()
    });

    if (!res.ok) {
      throw new Error('Failed to load settings');
    }

    const data = await res.json();
    const timeoutInput = document.getElementById('inboundTimeoutInput');
    if (timeoutInput) {
      timeoutInput.value = data.inboundTimeoutMinutes !== undefined ? data.inboundTimeoutMinutes : 60;
    }

    const surveyEnabledInput = document.getElementById('surveyEnabledInput');
    const surveyFlowSelect = document.getElementById('surveyFlowSelect');
    if (surveyEnabledInput) {
      surveyEnabledInput.checked = !!data.surveyEnabled;
    }
    if (surveyFlowSelect) {
      surveyFlowSelect.value = data.surveyFlowId || '';
      surveyFlowSelect.disabled = !data.surveyEnabled;
    }

    // Alertas de Fila
    const queueHasLicense = !!data.featureQueueAlert;
    const alertConfig = data.queueAlertConfig || {};
    const queueEnabled = queueHasLicense && !!alertConfig.enabled;
    
    const queueAlertEnabledInput = document.getElementById('queueAlertEnabledInput');
    const queueAlertWaitInput = document.getElementById('queueAlertWaitInput');
    const queueAlertTypeSelect = document.getElementById('queueAlertTypeSelect');
    const queueAlertTargetInput = document.getElementById('queueAlertTargetInput');
    
    queueAlertEnabledInput.checked = queueEnabled;
    queueAlertWaitInput.value = alertConfig.maxWaitMinutes || 10;
    queueAlertTypeSelect.value = alertConfig.notificationType || 'EMAIL';
    queueAlertTargetInput.value = alertConfig.target || '';
    
    // Limpar avisos antigos de licença
    const oldQueueLicenseAlert = document.getElementById('queueLicenseAlert');
    if (oldQueueLicenseAlert) oldQueueLicenseAlert.remove();
    
    if (!queueHasLicense) {
      queueAlertEnabledInput.checked = false;
      queueAlertEnabledInput.disabled = true;
      queueAlertWaitInput.disabled = true;
      queueAlertTypeSelect.disabled = true;
      queueAlertTargetInput.disabled = true;
      document.getElementById('queueAlertFields').style.display = 'none';
      
      const alertEl = document.createElement('div');
      alertEl.id = 'queueLicenseAlert';
      alertEl.className = 'text-danger small mt-1 fw-bold';
      alertEl.innerHTML = '<i class="fas fa-lock me-1"></i> Funcionalidade não inclusa no seu plano.';
      document.getElementById('queueAlertSwitchWrapper').appendChild(alertEl);
    } else {
      queueAlertEnabledInput.disabled = false;
      queueAlertWaitInput.disabled = false;
      queueAlertTypeSelect.disabled = false;
      queueAlertTargetInput.disabled = false;
      toggleQueueAlertFields();
      updateQueueAlertPlaceholder();
    }

    // Webhook de Encerramento (CRM)
    const closeHasLicense = !!data.featureCloseWebhook;
    const closeConfig = data.closeWebhookConfig || {};
    const closeEnabled = closeHasLicense && !!closeConfig.enabled;
    
    const closeWebhookEnabledInput = document.getElementById('closeWebhookEnabledInput');
    const closeWebhookUrlInput = document.getElementById('closeWebhookUrlInput');
    const closeWebhookTokenInput = document.getElementById('closeWebhookTokenInput');
    
    closeWebhookEnabledInput.checked = closeEnabled;
    closeWebhookUrlInput.value = closeConfig.url || '';
    closeWebhookTokenInput.value = closeConfig.secretToken || '';
    
    // Limpar avisos antigos de licença
    const oldCloseLicenseAlert = document.getElementById('closeLicenseAlert');
    if (oldCloseLicenseAlert) oldCloseLicenseAlert.remove();
    
    if (!closeHasLicense) {
      closeWebhookEnabledInput.checked = false;
      closeWebhookEnabledInput.disabled = true;
      closeWebhookUrlInput.disabled = true;
      closeWebhookTokenInput.disabled = true;
      document.getElementById('closeWebhookFields').style.display = 'none';
      
      const alertEl = document.createElement('div');
      alertEl.id = 'closeLicenseAlert';
      alertEl.className = 'text-danger small mt-1 fw-bold';
      alertEl.innerHTML = '<i class="fas fa-lock me-1"></i> Funcionalidade não inclusa no seu plano.';
      document.getElementById('closeWebhookSwitchWrapper').appendChild(alertEl);
    } else {
      closeWebhookEnabledInput.disabled = false;
      closeWebhookUrlInput.disabled = false;
      closeWebhookTokenInput.disabled = false;
      toggleCloseWebhookFields();
    }
  } catch (error) {
    console.error('Error loading general settings:', error);
  }
};

window.toggleQueueAlertFields = () => {
  const enabled = document.getElementById('queueAlertEnabledInput').checked;
  const fields = document.getElementById('queueAlertFields');
  if (fields) fields.style.display = enabled ? 'block' : 'none';
};

window.updateQueueAlertPlaceholder = () => {
  const typeSelect = document.getElementById('queueAlertTypeSelect');
  const label = document.getElementById('queueAlertTargetLabel');
  const input = document.getElementById('queueAlertTargetInput');
  if (!typeSelect || !label || !input) return;

  if (typeSelect.value === 'EMAIL') {
    label.innerText = 'Destinatário (E-mail):';
    input.placeholder = 'ex: alerta@empresa.com';
  } else {
    label.innerText = 'Webhook URL:';
    input.placeholder = 'ex: https://n8n.empresa.com/webhook/queue-alert';
  }
};

window.toggleCloseWebhookFields = () => {
  const enabled = document.getElementById('closeWebhookEnabledInput').checked;
  const fields = document.getElementById('closeWebhookFields');
  if (fields) fields.style.display = enabled ? 'block' : 'none';
};

window.saveGeneralSettings = async (event) => {
  if (event) event.preventDefault();

  const timeoutInput = document.getElementById('inboundTimeoutInput');
  const surveyEnabledInput = document.getElementById('surveyEnabledInput');
  const surveyFlowSelect = document.getElementById('surveyFlowSelect');
  if (!timeoutInput) return;

  const inboundTimeoutMinutes = parseInt(timeoutInput.value, 10);
  if (isNaN(inboundTimeoutMinutes) || inboundTimeoutMinutes < 1) {
    return Swal.fire('Erro', 'Por favor, insira um tempo limite válido (mínimo 1 minuto).', 'error');
  }

  const surveyEnabled = surveyEnabledInput ? surveyEnabledInput.checked : false;
  const surveyFlowId = (surveyFlowSelect && surveyFlowSelect.value) ? surveyFlowSelect.value : null;

  if (surveyEnabled && !surveyFlowId) {
    return Swal.fire('Erro', 'Por favor, selecione um fluxo de pesquisa caso a pesquisa esteja ativa.', 'error');
  }

  // Alertas de Fila
  const queueAlertEnabled = document.getElementById('queueAlertEnabledInput').checked;
  const queueAlertWait = parseInt(document.getElementById('queueAlertWaitInput').value, 10);
  const queueAlertType = document.getElementById('queueAlertTypeSelect').value;
  const queueAlertTarget = document.getElementById('queueAlertTargetInput').value.trim();

  if (queueAlertEnabled) {
    if (isNaN(queueAlertWait) || queueAlertWait < 1) {
      return Swal.fire('Erro', 'Por favor, insira um tempo limite de fila válido.', 'error');
    }
    if (!queueAlertTarget) {
      return Swal.fire('Erro', 'Por favor, insira o destinatário de e-mail ou URL do webhook.', 'error');
    }
  }

  const queueAlertConfig = {
    enabled: queueAlertEnabled,
    maxWaitMinutes: queueAlertWait,
    notificationType: queueAlertType,
    target: queueAlertTarget
  };

  // Webhook de Encerramento (CRM)
  const closeWebhookEnabled = document.getElementById('closeWebhookEnabledInput').checked;
  const closeWebhookUrl = document.getElementById('closeWebhookUrlInput').value.trim();
  const closeWebhookToken = document.getElementById('closeWebhookTokenInput').value.trim();

  if (closeWebhookEnabled) {
    if (!closeWebhookUrl) {
      return Swal.fire('Erro', 'Por favor, insira a URL do CRM externo para o webhook de encerramento.', 'error');
    }
  }

  const closeWebhookConfig = {
    enabled: closeWebhookEnabled,
    url: closeWebhookUrl || null,
    secretToken: closeWebhookToken || null
  };

  Swal.fire({
    title: 'Salvando...',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  try {
    const token = getAdminToken();
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ inboundTimeoutMinutes, surveyEnabled, surveyFlowId, queueAlertConfig, closeWebhookConfig })
    });

    Swal.close();

    if (res.ok) {
      Swal.fire('Sucesso', 'Configurações gerais salvas com sucesso!', 'success');
    } else {
      const data = await res.json();
      throw new Error(data.error || 'Erro ao salvar configurações');
    }
  } catch (error) {
    Swal.close();
    Swal.fire('Erro', error.message, 'error');
  }
};

// --- TIME ROUTING (CAMPANHAS POR HORÁRIO) ---

window.openTimeRoutingModal = () => {
  const modalEl = document.getElementById('timeRoutingModal');
  if (!modalEl) return;

  const config = STATE.timeRouting || { enabled: false, rules: [] };

  const switchInput = document.getElementById('time-routing-enabled');
  if (switchInput) {
    switchInput.checked = config.enabled;
  }

  toggleTimeRoutingUI(config.enabled);

  const tbody = document.getElementById('time-routing-rules-tbody');
  if (tbody) {
    tbody.innerHTML = '';
  }

  if (Array.isArray(config.rules)) {
    config.rules.forEach(rule => {
      addTimeRoutingRuleRow(rule);
    });
  }

  const modal = new bootstrap.Modal(modalEl);
  modal.show();
};

window.toggleTimeRoutingUI = (enabled) => {
  const container = document.getElementById('time-routing-rules-container');
  const disabledMsg = document.getElementById('time-routing-disabled-msg');
  
  if (enabled) {
    container.classList.remove('d-none');
    disabledMsg.classList.add('d-none');
  } else {
    container.classList.add('d-none');
    disabledMsg.classList.remove('d-none');
  }
};

window.addTimeRoutingRuleRow = (rule = { flowId: '', start: '08:00', end: '18:00' }) => {
  const tbody = document.getElementById('time-routing-rules-tbody');
  if (!tbody) return;

  let selectHtml = `<select class="form-select form-select-sm fw-bold rule-flow-select">`;
  selectHtml += `<option value="">Escolha um fluxo...</option>`;
  Object.keys(STATE.all_uras).forEach(flowId => {
    selectHtml += `<option value="${flowId}" ${flowId === rule.flowId ? 'selected' : ''}>${flowId}</option>`;
  });
  selectHtml += `</select>`;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${selectHtml}</td>
    <td><input type="time" class="form-control form-control-sm rule-start-input" value="${rule.start}"></td>
    <td><input type="time" class="form-control form-control-sm rule-end-input" value="${rule.end}"></td>
    <td class="text-center">
      <button class="btn btn-sm btn-outline-danger" onclick="deleteTimeRoutingRuleRow(this)"><i class="bi bi-trash"></i></button>
    </td>
  `;

  tbody.appendChild(tr);
};

window.deleteTimeRoutingRuleRow = (button) => {
  button.closest('tr').remove();
};

window.saveTimeRoutingConfig = async () => {
  const switchInput = document.getElementById('time-routing-enabled');
  const enabled = switchInput ? switchInput.checked : false;

  const rules = [];
  const tbody = document.getElementById('time-routing-rules-tbody');
  
  if (tbody && enabled) {
    const rows = tbody.querySelectorAll('tr');
    let hasInvalid = false;

    rows.forEach(row => {
      const flowId = row.querySelector('.rule-flow-select').value;
      const start = row.querySelector('.rule-start-input').value;
      const end = row.querySelector('.rule-end-input').value;

      if (!flowId || !start || !end) {
        hasInvalid = true;
      } else {
        rules.push({ flowId, start, end });
      }
    });

    if (hasInvalid) {
      return Swal.fire('Aviso', 'Preencha todos os campos das regras (Fluxo, Hora Inicial e Hora Final) ou remova a regra vazia.', 'warning');
    }
  }

  STATE.timeRouting = { enabled, rules };

  Swal.fire({
    title: 'Salvando...',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  const success = await saveAllURAs(false);
  Swal.close();

  if (success) {
    Swal.fire('Salvo!', 'Configurações de agendamento de URA atualizadas com sucesso.', 'success');
    const modalEl = document.getElementById('timeRoutingModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
  }
};

// --- WEBCHAT CONNECTIONS MANAGEMENT ---

window.loadWebchatConnections = async () => {
  try {
    const tbody = document.getElementById('webchat-connections-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Carregando conexões...</td></tr>';

    const [res, urasRes] = await Promise.all([
      fetch('/api/admin/webchat', { headers: getRequestHeaders() }),
      fetch('/api/admin/uras', { headers: getRequestHeaders() })
    ]);

    if (!res.ok) throw new Error('Falha ao obter conexões do Webchat');

    const connections = await res.json();
    let allUras = {};
    if (urasRes.ok) {
      const urasData = await urasRes.json();
      allUras = urasData.uras || {};
    }

    // Popular select do modal de criação
    const flowSelect = document.getElementById('webchatFlowId');
    if (flowSelect) {
      flowSelect.innerHTML = '<option value="">Roteamento Padrão (Por Horários)</option>';
      Object.keys(allUras).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = key;
        flowSelect.appendChild(opt);
      });
    }

    if (connections.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Nenhuma conexão de Webchat criada ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = connections.map(conn => {
      const statusBadge = conn.status === 'CONNECTED' 
        ? '<span class="badge bg-success">Ativo</span>' 
        : '<span class="badge bg-danger">Inativo</span>';
      
      const flowLabel = conn.flowId ? `<span class="badge bg-primary">${escapeHtml(conn.flowId)}</span>` : '<span class="text-muted">Horários</span>';
      
      return `
        <tr>
          <td>
            <div class="fw-bold text-dark">${escapeHtml(conn.name)}</div>
            <div class="text-muted small">Criado em: ${new Date(conn.createdAt).toLocaleDateString()}</div>
          </td>
          <td>
            <div class="d-flex align-items-center gap-2">
              <code style="font-size:0.8rem">${escapeHtml(conn.token)}</code>
              <button class="btn btn-sm btn-link p-0 text-muted" onclick="navigator.clipboard.writeText('${conn.token}'); Swal.fire('Copiado!', 'Token copiado para a área de transferência.', 'success')" title="Copiar Token">
                <i class="bi bi-clipboard"></i>
              </button>
            </div>
          </td>
          <td>${flowLabel}</td>
          <td>${statusBadge}</td>
          <td class="text-end">
            <div class="d-flex justify-content-end gap-2">
              <button class="btn-action-edit" onclick="showEditWebchatConnection('${conn.id}', '${escapeHtml(conn.name)}', '${conn.flowId || ''}', '${escapeHtml(conn.welcomeMessage || '')}', '${escapeHtml((conn.allowedDomains || []).join(', '))}')" title="Editar Canal">
                <i class="bi-pencil-square"></i>
              </button>
              <button class="btn-action-edit" onclick="showWebchatSnippet('${conn.token}')" title="Código de Integração" style="color:var(--color-primary);">
                <i class="bi-code-slash"></i>
              </button>
              <button class="btn-action-delete" onclick="deleteWebchatConnection('${conn.id}')" title="Excluir Canal">
                <i class="bi-trash3"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    logger.error('[WebchatAdmin] loadWebchatConnections error:', error);
    Swal.fire('Erro!', 'Falha ao carregar conexões de Webchat.', 'error');
  }
};

window.showNewWebchatConnectionModal = () => {
  document.getElementById('webchatConnectionId').value = '';
  document.getElementById('webchatName').value = '';
  document.getElementById('webchatWelcomeMessage').value = '';
  document.getElementById('webchatAllowedDomains').value = '';
  document.getElementById('webchatFlowId').value = '';
  document.getElementById('webchatModalTitle').innerHTML = '<i class="bi bi-chat-square-text-fill text-primary"></i> Nova Conexão Webchat';
  
  const modal = new bootstrap.Modal(document.getElementById('webchatConnectionModal'));
  modal.show();
};

window.showEditWebchatConnection = (id, name, flowId, welcomeMessage, allowedDomains) => {
  document.getElementById('webchatConnectionId').value = id;
  document.getElementById('webchatName').value = name;
  document.getElementById('webchatWelcomeMessage').value = welcomeMessage === 'null' || welcomeMessage === 'undefined' ? '' : welcomeMessage;
  document.getElementById('webchatAllowedDomains').value = allowedDomains === 'null' || allowedDomains === 'undefined' ? '' : allowedDomains;
  document.getElementById('webchatFlowId').value = flowId;
  document.getElementById('webchatModalTitle').innerHTML = '<i class="bi bi-chat-square-text-fill text-primary"></i> Editar Conexão Webchat';
  
  const modal = new bootstrap.Modal(document.getElementById('webchatConnectionModal'));
  modal.show();
};

window.saveWebchatConnection = async (event) => {
  event.preventDefault();
  try {
    const id = document.getElementById('webchatConnectionId').value;
    const name = document.getElementById('webchatName').value;
    const welcomeMessage = document.getElementById('webchatWelcomeMessage').value;
    const allowedDomainsRaw = document.getElementById('webchatAllowedDomains').value;
    const flowId = document.getElementById('webchatFlowId').value;

    const allowedDomains = allowedDomainsRaw 
      ? allowedDomainsRaw.split(',').map(d => d.trim()).filter(Boolean) 
      : [];

    const payload = {
      name,
      welcomeMessage: welcomeMessage || null,
      allowedDomains,
      flowId: flowId || null
    };

    if (id) {
      payload.id = id;
    }

    const res = await fetch('/api/admin/webchat', {
      method: 'POST',
      headers: getRequestHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Falha ao salvar conexão.');
    }

    Swal.fire('Sucesso!', 'Conexão de Webchat salva com sucesso!', 'success');
    
    // Esconder modal
    const modalEl = document.getElementById('webchatConnectionModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    loadWebchatConnections();
  } catch (error) {
    logger.error('[WebchatAdmin] saveWebchatConnection error:', error);
    Swal.fire('Erro!', error.message, 'error');
  }
};

window.deleteWebchatConnection = async (id) => {
  try {
    const confirm = await Swal.fire({
      title: 'Tem certeza?',
      text: 'Isso removerá esta conexão de Webchat e desativará os scripts do seu site!',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#475569',
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar'
    });

    if (!confirm.isConfirmed) return;

    const res = await fetch(`/api/admin/webchat/${id}`, {
      method: 'DELETE',
      headers: getRequestHeaders()
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Falha ao deletar conexão.');
    }

    Swal.fire('Excluído!', 'Conexão Webchat removida.', 'success');
    loadWebchatConnections();
  } catch (error) {
    logger.error('[WebchatAdmin] deleteWebchatConnection error:', error);
    Swal.fire('Erro!', error.message, 'error');
  }
};

window.showWebchatSnippet = (token) => {
  const origin = window.location.origin;
  const snippet = `<!-- Início do Widget Broker Webchat -->
<script
  src="${origin}/webchat/widget.js"
  data-token="${token}"
  data-color="#01745E"
  defer>
</script>
<!-- Fim do Widget Broker Webchat -->`;

  document.getElementById('webchatSnippetTextarea').value = snippet;
  const modal = new bootstrap.Modal(document.getElementById('webchatSnippetModal'));
  modal.show();
};

window.copyWebchatSnippet = () => {
  const textarea = document.getElementById('webchatSnippetTextarea');
  textarea.select();
  document.execCommand('copy');
  Swal.fire('Copiado!', 'Snippet HTML copiado para a área de transferência.', 'success');
};

// --- TELEGRAM BOT CONFIGURATION ---

window.loadTelegramConfig = async () => {
  try {
    // 1. Carregar lista de fluxos no select
    const flowSelect = document.getElementById('telegramFlowId');
    if (flowSelect && STATE.flows) {
      flowSelect.innerHTML = '<option value="">Padrão da Empresa (Primeiro Fluxo Ativo)</option>';
      STATE.flows.forEach((flow) => {
        const opt = document.createElement('option');
        opt.value = flow.id;
        opt.innerText = `${flow.name || 'Fluxo sem nome'} (${flow.active ? 'Ativo' : 'Inativo'})`;
        flowSelect.appendChild(opt);
      });
    }

    // 2. Buscar configuração atual do Telegram
    const res = await fetch('/api/telegram/config', { headers: getHeaders() });
    if (!res.ok) throw new Error('Erro ao carregar configurações do Telegram');

    const config = await res.json();
    const isConnected = config.status === 'CONNECTED' && config.enabled;

    const statusCard = document.getElementById('telegramStatusCard');
    const statusIcon = document.getElementById('telegramStatusIcon');
    const botTitle = document.getElementById('telegramBotTitle');
    const botSubtitle = document.getElementById('telegramBotSubtitle');
    const btnDisconnect = document.getElementById('btnDisconnectTelegram');
    const tokenInput = document.getElementById('telegramBotToken');
    const welcomeInput = document.getElementById('telegramWelcomeMessage');

    if (isConnected) {
      statusCard.className = 'alert alert-success d-flex align-items-center justify-content-between mb-4 border-success';
      statusIcon.className = 'fs-2 text-success';
      statusIcon.innerHTML = '<i class="bi bi-check-circle-fill"></i>';
      botTitle.innerText = `Bot Conectado: ${config.botName || 'Telegram Bot'} (@${config.botUsername || ''})`;
      botSubtitle.innerText = `Webhook ativo em: ${config.webhookUrl || 'broker'}`;
      btnDisconnect.classList.remove('d-none');
      
      if (tokenInput && config.botTokenMasked) {
        tokenInput.value = config.botTokenMasked;
      }
      if (flowSelect && config.flowId) {
        flowSelect.value = config.flowId;
      }
      if (welcomeInput && config.welcomeMessage) {
        welcomeInput.value = config.welcomeMessage;
      }
    } else {
      statusCard.className = 'alert alert-secondary d-flex align-items-center justify-content-between mb-4';
      statusIcon.className = 'fs-2 text-secondary';
      statusIcon.innerHTML = '<i class="bi bi-robot"></i>';
      botTitle.innerText = 'Nenhum bot conectado';
      botSubtitle.innerText = 'Insira o token gerado pelo @BotFather abaixo';
      btnDisconnect.classList.add('d-none');
    }
  } catch (error) {
    console.error('Erro ao carregar config do Telegram:', error);
  }
};

window.saveTelegramConfig = async (event) => {
  event.preventDefault();
  const tokenInput = document.getElementById('telegramBotToken');
  const flowSelect = document.getElementById('telegramFlowId');
  const welcomeInput = document.getElementById('telegramWelcomeMessage');
  const btnSave = document.getElementById('btnSaveTelegram');

  const botToken = tokenInput.value.trim();
  if (!botToken) {
    Swal.fire('Atenção', 'Informe o Token do Bot gerado pelo @BotFather.', 'warning');
    return;
  }

  // Se o usuário não alterou o token mascarado
  if (botToken.includes('...')) {
    Swal.fire('Info', 'O bot já está conectado com este token.', 'info');
    return;
  }

  const originalBtnHtml = btnSave.innerHTML;
  btnSave.disabled = true;
  btnSave.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Conectando com Telegram...';

  try {
    const res = await fetch('/api/telegram/config', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        botToken,
        flowId: flowSelect ? flowSelect.value : null,
        welcomeMessage: welcomeInput ? welcomeInput.value.trim() : null,
        enabled: true
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Falha ao conectar bot do Telegram');
    }

    Swal.fire('Sucesso!', data.message || 'Bot do Telegram conectado com sucesso!', 'success');
    loadTelegramConfig();
  } catch (error) {
    console.error('Erro ao salvar Telegram:', error);
    Swal.fire('Erro na Conexão', error.message, 'error');
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = originalBtnHtml;
  }
};

window.disconnectTelegram = async () => {
  const result = await Swal.fire({
    title: 'Desconectar Bot do Telegram?',
    text: 'O Broker deixará de receber e responder mensagens deste bot.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Sim, Desconectar',
    cancelButtonText: 'Cancelar'
  });

  if (!result.isConfirmed) return;

  try {
    const res = await fetch('/api/telegram/config', {
      method: 'DELETE',
      headers: getHeaders()
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Falha ao desconectar');
    }

    Swal.fire('Desconectado!', 'Canal Telegram desconectado com sucesso.', 'success');
    document.getElementById('telegramBotToken').value = '';
    document.getElementById('telegramWelcomeMessage').value = '';
    loadTelegramConfig();
  } catch (error) {
    console.error('Erro ao desconectar Telegram:', error);
    Swal.fire('Erro!', error.message, 'error');
  }
};

