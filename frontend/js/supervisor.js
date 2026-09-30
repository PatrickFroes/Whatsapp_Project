let currentSpyPhone = null;
let currentSpyConversationId = null;
let currentAuditConversationId = null;
let socket = null;

let inMemoryToken = null;
function getSupervisorToken() {
  const isIframe = window.self !== window.top;
  if (!isIframe) return null;
  return inMemoryToken || null;
}

function getAuthHeaders(extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  const token = getSupervisorToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function getRequestHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const token = getSupervisorToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function initSupervisor() {
  document.body.style.display = 'none';

  const isIframe = window.self !== window.top;
  if (!isIframe) {
    localStorage.removeItem('token');
  }

  async function startSupervisor(user) {
    document.getElementById('supervisorName').innerText = user.name || user.email;

    await Promise.all([loadTeam(), loadLiveChats(), loadHistory(), loadChartsConfig()]);

    const socketOptions = {};
    if (inMemoryToken) {
      socketOptions.auth = { token: inMemoryToken };
    }
    socket = io('/', socketOptions);

    socket.on('connect_error', (err) => {
      console.error('🔌 Socket.io erro:', err.message);
      if (err.message.includes('Token') || err.message.includes('Autenticação')) {
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        window.location.href = '/login.html';
      }
    });

    // Escuta os eventos reais emitidos pelo backend
    socket.on('agent_status_changed', () => {
      console.log('🔄 Status do agente alterado, atualizando equipe...');
      loadTeam();
      loadDashboardStats();
    });

    const reloadChats = () => {
      console.log('🔄 Fila de chats alterada, atualizando painel...');
      loadLiveChats();
      loadHistory();
      loadDashboardStats();
    };

    socket.on('chat_list_update', reloadChats);
    socket.on('chat_assigned', reloadChats);
    socket.on('conversation_resolved', reloadChats);
    socket.on('conversation-transferred', reloadChats);
    socket.on('conversation-queued-skill', reloadChats);

    socket.on('conversation_ai_updated', (data) => {
      if (currentAuditConversationId === data.conversationId) {
        const aiCard = document.getElementById('auditMetaAiCard');
        if (aiCard) {
          aiCard.style.display = 'block';
          document.getElementById('auditMetaAiSummary').textContent = data.aiSummary || 'Sem resumo.';
          
          const sentiment = data.aiSentiment || 'NEUTRO';
          const sentimentBadge = document.getElementById('auditMetaAiSentiment');
          sentimentBadge.textContent = sentiment;
          sentimentBadge.className = 'badge ' + 
            (sentiment === 'MUITO_POSITIVO' ? 'bg-success' : 
             sentiment === 'POSITIVO' ? 'bg-success bg-opacity-75' : 
             sentiment === 'NEUTRO' ? 'bg-warning text-dark' : 
             sentiment === 'NEGATIVO' ? 'bg-danger bg-opacity-75' : 
             'bg-danger');

          const tagsContainer = document.getElementById('auditMetaAiTags');
          tagsContainer.innerHTML = '';
          const tags = data.aiTags || [];
          if (tags.length > 0) {
            tags.forEach(t => {
              const span = document.createElement('span');
              span.className = 'badge bg-secondary me-1 mb-1';
              span.textContent = t;
              tagsContainer.appendChild(span);
            });
          } else {
            tagsContainer.innerHTML = '<small class="text-muted" style="font-size:0.8em">Sem tags.</small>';
          }
        }
      }
      reloadChats();
    });

    socket.on('new_message', (data) => {
      if (currentSpyConversationId && data.conversationId === currentSpyConversationId) {
        appendSpyMessage(data);
      }
    });

    socket.on('whisper_message', (data) => {
      if (currentSpyConversationId && data.conversationId === currentSpyConversationId) {
        appendSpyMessage(data);
      }
    });

    socket.on('message_sent', (data) => {
      if (currentSpyConversationId && data.conversationId === currentSpyConversationId) {
        appendSpyMessage(data);
      }
    });
  }

  try {
    // Lógica de Autenticação em Iframe (window.name)
    if (isIframe) {
      const tokenFromWindowName = window.name;
      if (tokenFromWindowName && tokenFromWindowName.startsWith('eyJ')) {
        inMemoryToken = tokenFromWindowName;

        const res = await fetch('/api/auth/me', {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${inMemoryToken}`
          }
        });
        if (!res.ok) {
          window.name = '';
          window.location.href = '/login.html';
          return;
        }
        window.name = ''; // Limpa o window.name imediatamente após validação bem-sucedida
        const user = await res.json();
        if (user.role !== 'SUPERVISOR' && user.role !== 'ADMIN' && user.role !== 'OWNER' && user.role !== 'SUPER_ADMIN') {
          window.location.href = '/login.html';
          return;
        }
        await startSupervisor(user);
      } else {
        // Iframe sem token (ex: F5) -> redireciona para login no iframe
        window.location.href = '/login.html';
      }
    } else {
      // Modo tradicional seguro via Cookies HttpOnly (Aba normal)
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        window.location.href = '/login.html';
        return;
      }
      const user = await res.json();
      if (user.role !== 'SUPERVISOR' && user.role !== 'ADMIN' && user.role !== 'OWNER' && user.role !== 'SUPER_ADMIN') {
        window.location.href = '/login.html';
        return;
      }
      await startSupervisor(user);
    }

    // Listener para limpar a escuta ao fechar a modal
    const spyModalEl = document.getElementById('spyModal');
    if (spyModalEl) {
      spyModalEl.addEventListener('hidden.bs.modal', () => {
        if (currentSpyConversationId && socket) {
          socket.emit('leave_conversation', currentSpyConversationId);
        }
        currentSpyPhone = null;
        currentSpyConversationId = null;
      });
    }

    // Listener para limpar a auditoria ativa ao fechar a modal
    const auditModalEl = document.getElementById('auditChatModal');
    if (auditModalEl) {
      auditModalEl.addEventListener('hidden.bs.modal', () => {
        currentAuditConversationId = null;
      });
    }

    setInterval(() => {
      loadTeam();
      loadLiveChats();
    }, 30000);

    document.body.style.display = '';
  } catch (err) {
    console.error('Session validation failed:', err);
    window.location.href = '/login.html';
  }
}

async function loadTeam() {
  try {
    const res = await fetch('/api/supervisor/team', {
      headers: getRequestHeaders()
    });
    const data = await res.json();

    document.getElementById('statOnline').innerText = data.stats.online;
    document.getElementById('statBusy').innerText = data.stats.busy;
    document.getElementById('statOffline').innerText = data.stats.offline;

    const list = document.getElementById('agentList');
    list.innerHTML = data.agents
      .map(
        (a) => `
            <li class="list-group-item d-flex justify-content-between align-items-center">
                <div>
                    <i class="bi bi-person-circle text-secondary"></i> ${escapeHtml(a.name)}
                    <div style="font-size:0.75em" class="text-muted">${escapeHtml(a.email)}</div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <span class="badge ${getStatusBadge(a.workStatus)}">${escapeHtml(a.workStatus)}</span>
                    ${getForceActionButtons(a)}
                </div>
            </li>
        `
      )
      .join('');
  } catch (e) {
    console.error(e);
  }
}

function getStatusBadge(status) {
  const map = {
    ONLINE: 'bg-success',
    BUSY: 'bg-danger',
    OFFLINE: 'bg-secondary',
    AWAY: 'bg-warning'
  };
  return map[status] || 'bg-light text-dark';
}

function getForceActionButtons(agent) {
  if (agent.workStatus === 'OFFLINE') return '';
  return `
        <div class="dropdown">
            <button class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown">Ação</button>
            <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="#" onclick="forceStatus('${agent.id}', 'OFFLINE')">Derrubar (Offline)</a></li>
                <li><a class="dropdown-item" href="#" onclick="forceStatus('${agent.id}', 'AWAY')">Colocar em Pausa</a></li>
            </ul>
        </div>
    `;
}

async function forceStatus(id, status) {
  if (!confirm(`Forçar status ${status} para este agente?`)) return;
  await fetch(`/api/supervisor/agent/${id}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getSupervisorToken()}`
    },
    body: JSON.stringify({ status })
  });
  loadTeam();
  Swal.fire('Comando Enviado', 'O status do agente foi atualizado.', 'success');
}

async function loadLiveChats() {
  try {
    const res = await fetch('/api/supervisor/live-chats', {
      headers: getRequestHeaders()
    });
    const chats = await res.json();

    document.getElementById('statQueued').innerText = chats.filter(
      (c) => c.status === 'QUEUED'
    ).length;

    const container = document.getElementById('liveChatsList');
    if (chats.length === 0) {
      container.innerHTML =
        '<p class="text-center text-muted py-3">Nenhum atendimento ativo no momento.</p>';
      return;
    }

    container.innerHTML = chats
      .map(
        (c) => `
            <div class="live-chat-preview" onclick="openSpyModal('${escapeHtml(c.contact.phone)}', '${escapeHtml(c.contact.name || c.contact.phone)}', '${c.id}')">
                <div class="d-flex justify-content-between align-items-center">
                    <strong>${escapeHtml(c.contact.name || c.contact.phone)}</strong>
                    <div>
                      <span class="badge bg-light text-primary border me-1">${escapeHtml(c.channelName || 'Padrão')}</span>
                      <span class="badge bg-info">${escapeHtml(c.status)}</span>
                    </div>
                </div>
                <div class="small text-muted text-truncate mt-1">
                    ${c.messages && c.messages[0] ? escapeHtml(c.messages[0].content) : 'Iniciando conversa...'}
                </div>
                <div class="small text-primary mt-1">
                    <i class="bi bi-person"></i> ${c.assignedTo ? escapeHtml(c.assignedTo.name) : 'Bot/Fila'}
                </div>
            </div>
        `
      )
      .join('');
  } catch (e) {
    console.error(e);
  }
}

async function openSpyModal(phone, name, conversationId) {
  currentSpyPhone = phone;
  currentSpyConversationId = conversationId;
  document.getElementById('spyModalLabel').innerText = `Espionando: ${name}`;
  const modal = new bootstrap.Modal(document.getElementById('spyModal'));
  modal.show();

  const body = document.getElementById('spyModalBody');
  body.innerHTML = '<div class="text-center"><div class="spinner-border"></div></div>';

  // Tratar visualização dos dados da IA
  const foundChat = STATE_HISTORY_CHATS.find((c) => c.id === conversationId);
  const aiSummaryContainer = document.getElementById('aiSummaryContainer');
  if (foundChat && (foundChat.aiSummary || foundChat.aiSentiment)) {
    aiSummaryContainer.style.display = 'block';
    document.getElementById('aiSummaryText').innerText = foundChat.aiSummary || 'Sem resumo gerado pela IA.';

    const sentiment = foundChat.aiSentiment || 'NEUTRO';
    const sentimentBadge = document.getElementById('aiSentimentBadge');
    sentimentBadge.innerText = `Sentimento: ${sentiment}`;
    
    // Classes de cores do bootstrap para sentimentos
    sentimentBadge.className = 'badge ' + 
      (sentiment === 'MUITO_POSITIVO' ? 'bg-success' : 
       sentiment === 'POSITIVO' ? 'bg-success bg-opacity-75' : 
       sentiment === 'NEUTRO' ? 'bg-warning text-dark' : 
       sentiment === 'NEGATIVO' ? 'bg-danger bg-opacity-75' : 
       'bg-danger');

    const tagsContainer = document.getElementById('aiTagsContainer');
    tagsContainer.innerHTML = '';
    const tags = foundChat.aiTags || [];
    if (tags.length > 0) {
      tags.forEach((t) => {
        const span = document.createElement('span');
        span.className = 'badge bg-secondary me-1 mb-1';
        span.innerText = t;
        tagsContainer.appendChild(span);
      });
    } else {
      tagsContainer.innerHTML = '<small class="text-muted" style="font-size:0.8em">Sem tags identificadas.</small>';
    }
  } else {
    aiSummaryContainer.style.display = 'none';
  }

  if (conversationId && socket) {
    socket.emit('join_conversation', conversationId);
  }

  try {
    const res = await fetch(`/api/chats/${phone}/messages?includeClosed=true`, {
      headers: getRequestHeaders()
    });
    const msgs = await res.json();

    body.innerHTML = '';
    msgs.forEach((m) => appendSpyMessage(m));
    scrollToBottom();
  } catch (e) {
    body.innerHTML = '<p class="text-danger">Erro ao carregar mensagens.</p>';
  }
}

async function sendSpyWhisper() {
  const input = document.getElementById('spyWhisperInput');
  if (!input) return;
  const content = input.value.trim();
  if (!content || !currentSpyPhone) return;

  input.value = '';

  try {
    const token = getSupervisorToken();
    const res = await fetch(`/api/chats/${currentSpyPhone}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        content,
        type: 'whisper',
        isPrivate: true,
        conversationId: currentSpyConversationId
      })
    });

    if (!res.ok) {
      Swal.fire('Erro', 'Não foi possível enviar o sussurro', 'error');
    }
  } catch (e) {
    console.error('Erro ao enviar sussurro do supervisor:', e);
  }
}

function appendSpyMessage(msg) {
  const body = document.getElementById('spyModalBody');
  if (!body) return;

  // 🛡️ Proteção contra mensagens/sussurros duplicados
  if (msg.id) {
    const existingMsg = document.getElementById(`spy_msg_${msg.id}`);
    if (existingMsg) return;
  }

  // 🛡️ Renderização de Sussurro na Mesa de Controle
  if (msg.contentType === 'whisper' || msg.isPrivate) {
    const divWhisper = document.createElement('div');
    if (msg.id) divWhisper.id = `spy_msg_${msg.id}`;
    divWhisper.className = 'w-100 my-2 px-2 d-flex justify-content-center';
    const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const senderName = msg.senderName || 'Supervisor';
    const roleBadge = msg.senderRole === 'SUPERVISOR' ? 'bg-warning text-dark' : 'bg-secondary text-white';

    divWhisper.innerHTML = `
      <div class="card border-warning shadow-sm" style="background-color: #fff9e6; max-width: 90%; width: 100%; border-left: 4px solid #f59e0b !important; border-radius: 8px;">
        <div class="card-body py-2 px-3">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="small fw-bold text-dark d-flex align-items-center gap-1">
              <i class="bi bi-lock-fill text-warning"></i>
              <span>${escapeHtml(senderName)}</span>
              <span class="badge ${roleBadge} px-1 py-0 ms-1" style="font-size: 0.65rem;">${escapeHtml(msg.senderRole || 'SUPERVISOR')}</span>
            </span>
            <span class="text-muted" style="font-size: 0.7rem;">${time} • <strong class="text-warning-emphasis">Sussurro do Supervisor</strong></span>
          </div>
          <div class="text-dark small mb-0" style="white-space: pre-wrap; font-size: 0.88rem;">${escapeHtml(msg.content)}</div>
        </div>
      </div>
    `;
    body.appendChild(divWhisper);
    scrollToBottom();
    return;
  }

  const isMe = msg.direction === 'OUTBOUND';
  const div = document.createElement('div');
  if (msg.id) div.id = `spy_msg_${msg.id}`;
  div.className = `d-flex mb-2 ${isMe ? 'justify-content-end' : 'justify-content-start'}`;

  div.innerHTML = `
        <div class="p-2 rounded ${isMe ? 'bg-primary text-white' : 'bg-light border'}" style="max-width: 75%;">
            <div class="small fw-bold mb-1">${isMe ? 'Atendente' : 'Cliente'}</div>
            <div>${escapeHtml(msg.content)}</div>
            <div class="small opacity-75 text-end mt-1" style="font-size:0.75rem">
                ${new Date(msg.createdAt).toLocaleTimeString()}
            </div>
        </div>
    `;
  body.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  const body = document.getElementById('spyModalBody');
  if (body) body.scrollTop = body.scrollHeight;
}

let STATE_HISTORY_CHATS = [];

async function loadHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;

  if (container.children.length <= 1) {
    container.innerHTML =
      '<div class="text-center py-5"><div class="spinner-border text-secondary"></div></div>';
  }

  try {
    const res = await fetch('/api/supervisor/history?limit=50', {
      headers: getRequestHeaders()
    });
    const chats = await res.json();
    STATE_HISTORY_CHATS = chats; // Salvar em cache local temporário

    if (chats.length === 0) {
      container.innerHTML = '<p class="text-center text-muted py-3">Nenhum histórico recente.</p>';
      return;
    }

    container.innerHTML = chats
      .map(
        (c) => {
          let sentimentEmoji = '';
          if (c.aiSentiment === 'MUITO_POSITIVO') sentimentEmoji = '<span class="ms-1" title="Sentimento do cliente: Muito Positivo">🟢🟢</span>';
          else if (c.aiSentiment === 'POSITIVO') sentimentEmoji = '<span class="ms-1" title="Sentimento do cliente: Positivo">🟢</span>';
          else if (c.aiSentiment === 'NEUTRO') sentimentEmoji = '<span class="ms-1" title="Sentimento do cliente: Neutro">🟡</span>';
          else if (c.aiSentiment === 'NEGATIVO') sentimentEmoji = '<span class="ms-1" title="Sentimento do cliente: Negativo">🔴</span>';
          else if (c.aiSentiment === 'MUITO_NEGATIVO') sentimentEmoji = '<span class="ms-1" title="Sentimento do cliente: Muito Negativo">🔴🔴</span>';

          return `
            <div class="card mb-2 border-0 shadow-sm">
                <div class="card-body py-2">
                    <div class="d-flex justify-content-between align-items-center">
                        <strong>${c.contact.name || c.contact.phone} <span class="badge bg-light text-primary border ms-1" style="font-size: 0.7em;">${escapeHtml(c.channelName || 'Padrão')}</span>${sentimentEmoji}</strong>
                        <small class="text-muted">${new Date(c.updatedAt).toLocaleString()}</small>
                    </div>
                    <div class="d-flex justify-content-between small mt-1">
                        <span class="text-muted">Atendido por: ${c.assignedTo ? c.assignedTo.name : 'N/A'} <span class="badge bg-secondary ms-1" style="font-size:0.8em">${escapeHtml(c.status)}</span></span>
                        <button class="btn btn-sm btn-outline-primary py-0" style="font-size: 0.8em;" onclick="openSpyModal('${c.contact.phone}', '${c.contact.name || c.contact.phone}', '${c.id}')">
                            <i class="bi bi-eye"></i> Ver Conversa
                        </button>
                    </div>
                </div>
            </div>
          `;
        }
      )
      .join('');
  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-danger text-center">Erro ao carregar histórico.</p>';
  }
}

window.logout = () => {
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('token');
  window.location.href = '/login.html';
};

let MASS_TEMPLATES = [];
let MASS_SELECTED_TEMPLATE = null;

async function loadMassSendTemplates() {
  try {
    const token = getSupervisorToken();
    const res = await fetch('/api/templates', {
      headers: getRequestHeaders()
    });
    MASS_TEMPLATES = await res.json();
    const select = document.getElementById('massTemplateSelect');
    select.innerHTML = '<option value="">Selecione um template...</option>' + 
      MASS_TEMPLATES.map(t => `<option value="${t.name}">${t.name} (${t.language})</option>`).join('');

    // Load active connections
    const connRes = await fetch('/api/chats/connections', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const connections = await connRes.json();
    const connSelect = document.getElementById('massConnectionSelect');
    if (connSelect) {
      if (connections.length === 0) {
        connSelect.innerHTML = '<option value="">Nenhuma conexão de WhatsApp cadastrada</option>';
      } else {
        connSelect.innerHTML = connections
          .map(c => `<option value="${c.phoneNumberId}">${c.name} (${c.phoneNumberId}) - ${c.status === 'CONNECTED' ? 'Conectado' : 'Erro/Desconectado'}</option>`)
          .join('');
      }
    }
  } catch (e) {
    console.error('Erro ao carregar dados para disparo em massa:', e);
  }
}

function handleMassTemplateSelectChange() {
  const name = document.getElementById('massTemplateSelect').value;
  MASS_SELECTED_TEMPLATE = MASS_TEMPLATES.find(t => t.name === name) || null;

  const previewContainer = document.getElementById('massTemplatePreviewContainer');
  const paramsContainer = document.getElementById('massTemplateParamsContainer');
  const previewDiv = document.getElementById('massTemplatePreview');
  const paramsDiv = document.getElementById('massTemplateParamsList');

  if (!MASS_SELECTED_TEMPLATE) {
    previewContainer.classList.add('d-none');
    paramsContainer.classList.add('d-none');
    return;
  }

  previewContainer.classList.remove('d-none');

  // Extract BODY component
  const body = MASS_SELECTED_TEMPLATE.components?.find(c => c.type === 'BODY');
  if (body) {
    previewDiv.innerText = body.text;
    
    // Find variables like {{1}}, {{2}}, etc.
    const matches = body.text.match(/\{\{\d+\}\}/g);
    if (matches && matches.length > 0) {
      paramsContainer.classList.remove('d-none');
      const uniqueVars = [...new Set(matches)];
      paramsDiv.innerHTML = uniqueVars.map((v, i) => `
        <div class="row align-items-center mb-2">
          <div class="col-sm-2 text-end"><label class="form-label mb-0">${v}:</label></div>
          <div class="col-sm-10"><input type="text" class="form-control form-control-sm mass-param-input" data-index="${i+1}" placeholder="Valor para a variável ${v}"></div>
        </div>
      `).join('');
    } else {
      paramsContainer.classList.add('d-none');
    }
  } else {
    previewDiv.innerText = 'Este template não possui corpo de texto.';
    paramsContainer.classList.add('d-none');
  }
}

window.toggleMassCsvMode = function(isCsv) {
  const paramsContainer = document.getElementById('massTemplateParamsContainer');
  const phonesLabel = document.getElementById('massPhonesLabel');
  const phonesInput = document.getElementById('massPhonesInput');
  const phonesHelp = document.getElementById('massPhonesHelp');

  if (isCsv) {
    paramsContainer.classList.add('d-none');
    phonesLabel.innerText = "Dados Personalizados (Formato CSV)";
    phonesInput.placeholder = "5511999999999,João,Fatura Vencida\n5511988888888,Maria,Desconto Exclusivo";
    phonesHelp.innerHTML = "Insira um destinatário por linha. Formato: <code>telefone,variavel1,variavel2,...</code>";
  } else {
    phonesLabel.innerText = "Números de Destino (um por linha)";
    phonesInput.placeholder = "5511999999999\n5511988888888";
    phonesHelp.innerText = "Insira os números com DDI (ex: 55) e DDD. Apenas números, um por linha.";
    handleMassTemplateSelectChange();
  }
};

async function submitMassTemplateSend() {
  if (!MASS_SELECTED_TEMPLATE) {
    return Swal.fire('Erro', 'Por favor, selecione um template.', 'error');
  }

  const whatsappPhoneId = document.getElementById('massConnectionSelect').value;
  if (!whatsappPhoneId) {
    return Swal.fire('Erro', 'Por favor, selecione uma conexão de WhatsApp para envio.', 'error');
  }

  const phonesText = document.getElementById('massPhonesInput').value.trim();
  if (!phonesText) {
    return Swal.fire('Erro', 'Por favor, insira pelo menos um número de telefone.', 'error');
  }

  const isCsvMode = document.getElementById('massIsCsvMode')?.checked || false;
  let payload = {
    templateName: MASS_SELECTED_TEMPLATE.name,
    language: MASS_SELECTED_TEMPLATE.language,
    whatsappPhoneId
  };

  let confirmCount = 0;

  if (isCsvMode) {
    const recipients = [];
    const lines = phonesText.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const parts = trimmed.split(',');
      const rawPhone = parts[0].replace(/\D/g, '').trim();
      if (rawPhone.length >= 10) {
        const params = parts.slice(1).map(p => p.trim());
        recipients.push({ phone: rawPhone, parameters: params });
      }
    });

    if (recipients.length === 0) {
      return Swal.fire('Erro', 'Nenhum destinatário válido inserido no formato CSV.', 'error');
    }
    payload.recipients = recipients;
    confirmCount = recipients.length;
  } else {
    const phones = phonesText.split('\n').map(p => p.replace(/\D/g, '').trim()).filter(p => p.length >= 10);
    if (phones.length === 0) {
      return Swal.fire('Erro', 'Nenhum número de telefone válido inserido.', 'error');
    }

    const paramInputs = document.querySelectorAll('.mass-param-input');
    const parameters = [];
    paramInputs.forEach(input => {
      parameters.push(input.value.trim());
    });

    payload.phones = phones;
    payload.parameters = parameters;
    confirmCount = phones.length;
  }

  Swal.fire({
    title: 'Confirmar Disparo',
    text: `Você está prestes a enviar este template para ${confirmCount} números usando a conexão selecionada. Confirmar?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Confirmar',
    cancelButtonText: 'Cancelar'
  }).then(async (result) => {
    if (result.isConfirmed) {
      Swal.fire({
        title: 'Enviando...',
        text: 'Por favor, aguarde o processamento do disparo.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      try {
        const res = await fetch('/api/supervisor/mass-send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getSupervisorToken()}`
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        Swal.close();

        if (res.ok) {
          Swal.fire('Disparo Concluído', `Sucesso: ${data.successCount} | Falha: ${data.failCount}`, 'success');
          document.getElementById('massPhonesInput').value = '';
          document.getElementById('massTemplateSelect').value = '';
          const csvCheckbox = document.getElementById('massIsCsvMode');
          if (csvCheckbox) csvCheckbox.checked = false;
          toggleMassCsvMode(false);
          handleMassTemplateSelectChange();
        } else {
          Swal.fire('Erro no Disparo', data.error || 'Erro desconhecido', 'error');
        }
      } catch (err) {
        Swal.close();
        Swal.fire('Erro de Conexão', 'Não foi possível enviar o disparo.', 'error');
      }
    }
  });
}

// ============================================================
// METRICS & CUSTOM CHARTS SYSTEM
// ============================================================
let SUPERVISOR_CHARTS = [];
let CHART_INSTANCES = {};
let DASHBOARD_DATA = null;

const COLOR_PALETTES = {
  classic: ['#01745E', '#02BF9D', '#3b82f6', '#f59e0b', '#ef4444', '#64748b'],
  modern: ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6', '#8b5cf6'],
  warm: ['#f97316', '#eab308', '#ec4899', '#ef4444', '#f43f5e', '#ffedd5'],
  cool: ['#06b6d4', '#10b981', '#3b82f6', '#6366f1', '#8b5cf6', '#dbeafe']
};

window.loadChartsConfig = async () => {
  try {
    const saved = localStorage.getItem('supervisor_charts');
    if (saved) {
      SUPERVISOR_CHARTS = JSON.parse(saved);
      if (SUPERVISOR_CHARTS.length <= 2) {
        throw new Error("Upgrade de versão de gráficos");
      }
    } else {
      throw new Error("Novo usuário");
    }
  } catch (e) {
    SUPERVISOR_CHARTS = [
      { id: '1', title: 'Atendimentos por Status', type: 'pie', metric: 'chatsByStatus', colors: 'classic' },
      { id: '2', title: 'Volumetria de Atendimentos (Últimas 24h)', type: 'line', metric: 'chatsByHour', colors: 'cool' },
      { id: '3', title: 'Satisfação de Clientes (IA)', type: 'pie', metric: 'chatsBySentiment', colors: 'modern' },
      { id: '4', title: 'Produtividade por Agente', type: 'bar', metric: 'agentProductivity', colors: 'classic' }
    ];
    localStorage.setItem('supervisor_charts', JSON.stringify(SUPERVISOR_CHARTS));
  }
};

window.openCreateChartModal = () => {
  document.getElementById('chartTitleInput').value = '';
  document.getElementById('chartMetricSelect').value = 'chatsByStatus';
  document.getElementById('chartTypeSelect').value = 'pie';
  document.getElementById('chartColorsSelect').value = 'classic';
  
  new bootstrap.Modal('#createChartModal').show();
};

window.handleCreateChart = (e) => {
  e.preventDefault();
  
  const title = document.getElementById('chartTitleInput').value.trim();
  const metric = document.getElementById('chartMetricSelect').value;
  const type = document.getElementById('chartTypeSelect').value;
  const colors = document.getElementById('chartColorsSelect').value;
  
  if (!title) return;
  
  const newChart = {
    id: String(Date.now()),
    title,
    metric,
    type,
    colors
  };
  
  SUPERVISOR_CHARTS.push(newChart);
  localStorage.setItem('supervisor_charts', JSON.stringify(SUPERVISOR_CHARTS));
  
  // Hide modal
  const modalEl = document.getElementById('createChartModal');
  const modalInstance = bootstrap.Modal.getInstance(modalEl);
  if (modalInstance) modalInstance.hide();
  
  renderAllCharts();
};

window.deleteChart = (id) => {
  if (CHART_INSTANCES[id]) {
    CHART_INSTANCES[id].destroy();
    delete CHART_INSTANCES[id];
  }
  
  SUPERVISOR_CHARTS = SUPERVISOR_CHARTS.filter(c => c.id !== id);
  localStorage.setItem('supervisor_charts', JSON.stringify(SUPERVISOR_CHARTS));
  
  renderAllCharts();
};

window.loadDashboardStats = async () => {
  const container = document.getElementById('chartsContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/supervisor/dashboard-stats', {
      headers: { Authorization: `Bearer ${getSupervisorToken()}` }
    });
    if (!res.ok) throw new Error('Falha ao obter estatísticas');
    
    DASHBOARD_DATA = await res.json();
    renderAllCharts();
  } catch (e) {
    console.error(e);
    container.innerHTML = '<div class="col-12 text-center text-danger py-4">Erro ao carregar dados do painel.</div>';
  }
};

function renderAllCharts() {
  const container = document.getElementById('chartsContainer');
  if (!container) return;
  
  if (SUPERVISOR_CHARTS.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center text-muted py-5">
        <i class="bi bi-bar-chart fs-1 mb-2 d-block"></i>
        Nenhum gráfico customizado ativo. Clique em "Criar Gráfico Customizado" acima!
      </div>
    `;
    return;
  }
  
  container.innerHTML = '';
  
  SUPERVISOR_CHARTS.forEach(config => {
    const col = document.createElement('div');
    col.className = config.type === 'bar' || config.type === 'line' ? 'col-md-12 col-lg-6' : 'col-md-6 col-lg-4';
    col.innerHTML = `
      <div class="card shadow-sm border-0 h-100">
        <div class="card-header bg-white d-flex justify-content-between align-items-center py-2 border-bottom-0">
          <strong class="text-secondary">${escapeHtml(config.title)}</strong>
          <button class="btn btn-link text-danger p-0 btn-sm" onclick="deleteChart('${config.id}')" title="Excluir Gráfico">
            <i class="bi bi-trash"></i>
          </button>
        </div>
        <div class="card-body d-flex align-items-center justify-content-center" style="position: relative; min-height: 250px; max-height: 350px;">
          <canvas id="canvas-${config.id}"></canvas>
        </div>
      </div>
    `;
    container.appendChild(col);
    
    // Defer chart instantiation until canvas element is attached to DOM
    setTimeout(() => initChartInstance(config), 0);
  });
}

function initChartInstance(config) {
  const canvas = document.getElementById(`canvas-${config.id}`);
  if (!canvas || !DASHBOARD_DATA) return;
  
  // Destroy existing chart instance on this id if any
  if (CHART_INSTANCES[config.id]) {
    CHART_INSTANCES[config.id].destroy();
  }
  
  // Format labels & values based on metric
  let labels = [];
  let data = [];
  const rawData = DASHBOARD_DATA[config.metric] || [];
  
  if (config.metric === 'chatsByStatus') {
    const statusMap = { BOT: 'Bot URA', QUEUED: 'Aguardando Fila', ASSIGNED: 'Em Atendimento', RESOLVED: 'Resolvidos (Agente)', CLOSED: 'Fechados (URA)' };
    rawData.forEach(item => {
      labels.push(statusMap[item.status] || item.status);
      data.push(item.count);
    });
  } else if (config.metric === 'agentsByStatus') {
    rawData.forEach(item => {
      labels.push(item.status);
      data.push(item.count);
    });
  } else if (config.metric === 'agentsBySkill') {
    rawData.forEach(item => {
      labels.push(item.name);
      data.push(item.count);
    });
  } else if (config.metric === 'chatsByChannel') {
    rawData.forEach(item => {
      labels.push(item.channelName);
      data.push(item.count);
    });
  } else if (config.metric === 'chatsBySentiment') {
    rawData.forEach(item => {
      labels.push(item.sentiment || 'Não Analisado');
      data.push(item.count);
    });
  } else if (config.metric === 'chatsByDisposition') {
    rawData.forEach(item => {
      labels.push(item.disposition || 'Não Definido');
      data.push(item.count);
    });
  } else if (config.metric === 'chatsByHour') {
    rawData.forEach(item => {
      labels.push(item.hour);
      data.push(item.count);
    });
  } else if (config.metric === 'agentProductivity') {
    rawData.forEach(item => {
      labels.push(item.agentName);
      data.push(item.count);
    });
  }
  
  const colors = COLOR_PALETTES[config.colors] || COLOR_PALETTES.classic;
  const ctx = canvas.getContext('2d');
  
  // Se o tipo original do gráfico for 'pie', usa 'doughnut' (muito mais premium)
  const finalType = config.type === 'pie' ? 'doughnut' : config.type;
  
  CHART_INSTANCES[config.id] = new Chart(ctx, {
    type: finalType,
    data: {
      labels,
      datasets: [{
        label: config.title,
        data,
        backgroundColor: colors,
        borderColor: '#ffffff',
        borderWidth: 2,
        borderRadius: finalType === 'bar' ? 6 : 0,
        fill: finalType === 'line'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 15,
          bottom: 15,
          left: 10,
          right: 10
        }
      },
      cutout: finalType === 'doughnut' ? '70%' : undefined,
      plugins: {
        legend: {
          display: finalType !== 'bar' && finalType !== 'line',
          position: 'bottom',
          labels: { 
            boxWidth: 10, 
            padding: 15,
            font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' },
            color: '#475569'
          }
        }
      },
      scales: finalType === 'bar' || finalType === 'line' ? {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Plus Jakarta Sans', size: 10, weight: '500' }, color: '#64748b' }
        },
        y: { 
          beginAtZero: true, 
          ticks: { precision: 0, font: { family: 'Plus Jakarta Sans', size: 10, weight: '500' }, color: '#64748b' },
          grid: { color: 'rgba(0, 0, 0, 0.05)' }
        }
      } : {}
    },
    plugins: finalType === 'doughnut' ? [{
      id: 'centerText',
      afterDraw(chart) {
        const { ctx, data, chartArea: { top, bottom, left, right, width, height } } = chart;
        ctx.save();
        const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
        const centerX = left + width / 2;
        const centerY = top + height / 2;
        
        ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#0f172a';
        ctx.fillText(total, centerX, centerY - 6);
        
        ctx.font = '700 8px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('TOTAL', centerX, centerY + 12);
        ctx.restore();
      }
    }] : []
  });
}

function escapeHtml(string) {
  if (!string) return '';
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function initReportsTab() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  document.getElementById('repStartDate').value = start.toISOString().split('T')[0];
  document.getElementById('repEndDate').value = end.toISOString().split('T')[0];

  const token = getSupervisorToken();

  try {
    const res = await fetch('/api/supervisor/team', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const agentSelect = document.getElementById('repAgentSelect');
    if (agentSelect && data.agents) {
      agentSelect.innerHTML = '<option value="">Todos os Agentes</option>' +
        data.agents.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    }
  } catch (e) {
    console.error('Erro ao carregar agentes para relatórios:', e);
  }

  try {
    const res = await fetch('/api/transfer/available-skills', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const skillSelect = document.getElementById('repSkillSelect');
    if (skillSelect && Array.isArray(data)) {
      skillSelect.innerHTML = '<option value="">Todas as Skills</option>' +
        data.map(s => `<option value="${s.name}">${escapeHtml(s.name)}</option>`).join('');
    }
  } catch (e) {
    console.error('Erro ao carregar skills para relatórios:', e);
  }
}

async function queryReports() {
  const token = getSupervisorToken();
  const startDate = document.getElementById('repStartDate').value;
  const endDate = document.getElementById('repEndDate').value;
  const agentId = document.getElementById('repAgentSelect').value;
  const skill = document.getElementById('repSkillSelect').value;
  const status = document.getElementById('repStatusSelect').value;
  const channels = Array.from(document.querySelectorAll('.rep-channel-checkbox:checked')).map(cb => cb.value);

  const tbody = document.getElementById('reportsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="11" class="text-center py-4"><div class="spinner-border spinner-border-sm"></div> Pesquisando...</td></tr>';

  try {
    const url = new URL('/api/supervisor/reports', window.location.origin);
    if (startDate) url.searchParams.append('startDate', startDate);
    if (endDate) url.searchParams.append('endDate', endDate);
    if (agentId) url.searchParams.append('agentId', agentId);
    if (skill) url.searchParams.append('skill', skill);
    if (status) url.searchParams.append('status', status);
    if (channels.length > 0) url.searchParams.append('channels', channels.join(','));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Erro ao filtrar relatórios');

    const records = Array.isArray(data) ? data : (data.records || []);
    const metrics = data.metrics || null;

    // Atualizar os Cards de KPI de Contact Center
    const metricsContainer = document.getElementById('repMetricsContainer');
    if (metrics && metricsContainer) {
      metricsContainer.style.display = 'flex';
      const elTme = document.getElementById('repMetricTME');
      const elTma = document.getElementById('repMetricTMA');
      const elFcr = document.getElementById('repMetricFCR');
      if (elTme) elTme.innerText = metrics.tmeFormatted || '00s';
      if (elTma) elTma.innerText = metrics.tmaFormatted || '00s';
      if (elFcr) elFcr.innerText = metrics.fcrRate || '0%';
    } else if (metricsContainer) {
      metricsContainer.style.display = 'none';
    }

    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4">Nenhum atendimento encontrado para os filtros selecionados.</td></tr>';
      return;
    }

    const statusMap = { BOT: 'URA (Bot)', QUEUED: 'Fila', ASSIGNED: 'Atendimento', RESOLVED: 'Resolvido', CLOSED: 'Fechado' };

    tbody.innerHTML = records.map(r => {
      let npsPreview = 'N/A';
      if (r.npsScore) {
        npsPreview = `<span class="badge bg-success text-white px-2 py-1">${escapeHtml(r.npsScore)}</span>`;
      } else if (r.surveyResponses && Object.keys(r.surveyResponses).length > 0) {
        npsPreview = Object.entries(r.surveyResponses)
          .map(([k, v]) => `<span class="badge bg-light text-primary border me-1">${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`)
          .join('');
      }

      let channelBadge = '<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 px-2 py-1"><i class="bi bi-whatsapp me-1"></i>WhatsApp</span>';
      if (r.channel === 'TELEGRAM') {
        channelBadge = '<span class="badge bg-info bg-opacity-10 text-info border border-info border-opacity-25 px-2 py-1"><i class="bi bi-telegram me-1"></i>Telegram</span>';
      } else if (r.channel === 'WEBCHAT') {
        channelBadge = '<span class="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 px-2 py-1"><i class="bi bi-laptop me-1"></i>Webchat</span>';
      }

      return `
        <tr>
          <td><strong>${escapeHtml(r.contactName)}</strong><br><small class="text-muted">${escapeHtml(r.contactPhone)}</small></td>
          <td><span class="badge bg-light text-dark border">${escapeHtml(r.initiationType)}</span></td>
          <td>${channelBadge}</td>
          <td><span class="badge bg-secondary">${statusMap[r.status] || r.status}</span></td>
          <td>${escapeHtml(r.skill)}</td>
          <td>${escapeHtml(r.agentName)}</td>
          <td>${r.totalMessages}</td>
          <td>${new Date(r.createdAt).toLocaleString('pt-BR')}</td>
          <td>
            ${r.disposition ? `<strong>${escapeHtml(r.disposition)}</strong>` : 'N/A'}
            ${r.closingNotes ? `<br><small class="text-muted" title="${escapeHtml(r.closingNotes)}">${escapeHtml(r.closingNotes.substring(0, 30))}${r.closingNotes.length > 30 ? '...' : ''}</small>` : ''}
          </td>
          <td>${npsPreview}</td>
          <td>
            ${r.aiSentiment ? `<span class="badge ${
              r.aiSentiment === 'MUITO_POSITIVO' ? 'bg-success' : 
              r.aiSentiment === 'POSITIVO' ? 'bg-success bg-opacity-75' : 
              r.aiSentiment === 'NEUTRO' ? 'bg-warning text-dark' : 
              r.aiSentiment === 'NEGATIVO' ? 'bg-danger bg-opacity-75' : 
              'bg-danger'
            }" title="${escapeHtml(r.aiSummary || 'Sem resumo')}">${escapeHtml(r.aiSentiment)}</span>` : 'N/A'}
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-danger py-4">Erro ao carregar dados: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function exportReportsCsv() {
  const token = getSupervisorToken();
  const startDate = document.getElementById('repStartDate').value;
  const endDate = document.getElementById('repEndDate').value;
  const agentId = document.getElementById('repAgentSelect').value;
  const skill = document.getElementById('repSkillSelect').value;
  const status = document.getElementById('repStatusSelect').value;
  const channels = Array.from(document.querySelectorAll('.rep-channel-checkbox:checked')).map(cb => cb.value);

  const url = new URL('/api/supervisor/reports', window.location.origin);
  url.searchParams.append('format', 'csv');
  url.searchParams.append('token', token);
  if (startDate) url.searchParams.append('startDate', startDate);
  if (endDate) url.searchParams.append('endDate', endDate);
  if (agentId) url.searchParams.append('agentId', agentId);
  if (skill) url.searchParams.append('skill', skill);
  if (status) url.searchParams.append('status', status);
  if (channels.length > 0) url.searchParams.append('channels', channels.join(','));

  window.open(url.toString(), '_blank');
}

window.initAuditTab = async () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  document.getElementById('auditStartDate').value = start.toISOString().split('T')[0];
  document.getElementById('auditEndDate').value = end.toISOString().split('T')[0];

  const token = getSupervisorToken();

  try {
    const res = await fetch('/api/supervisor/team', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const agentSelect = document.getElementById('auditAgentSelect');
    if (agentSelect && data.agents) {
      agentSelect.innerHTML = '<option value="">Todos os Agentes</option>' +
        data.agents.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    }
  } catch (e) {
    console.error('Erro ao carregar agentes para auditoria:', e);
  }
};

window.searchAuditChats = async () => {
  const token = getSupervisorToken();
  const startDate = document.getElementById('auditStartDate').value;
  const endDate = document.getElementById('auditEndDate').value;
  const agentId = document.getElementById('auditAgentSelect').value;
  const query = document.getElementById('auditQueryInput').value;
  const channels = Array.from(document.querySelectorAll('.audit-channel-checkbox:checked')).map(cb => cb.value);

  const tbody = document.getElementById('auditTableBody');
  tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Buscando conversas...</td></tr>';

  try {
    const url = new URL('/api/supervisor/reports', window.location.origin);
    if (startDate) url.searchParams.append('startDate', startDate);
    if (endDate) url.searchParams.append('endDate', endDate);
    if (agentId) url.searchParams.append('agentId', agentId);
    if (query) url.searchParams.append('query', query);
    if (channels.length > 0) url.searchParams.append('channels', channels.join(','));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error('Falha na resposta do servidor.');
    }

    const data = await res.json();
    const records = Array.isArray(data) ? data : (data.records || []);
    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">Nenhuma conversa encontrada com os filtros selecionados.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    records.forEach(r => {
      let npsPreview = 'N/A';
      if (r.npsScore) {
        npsPreview = `<span class="badge bg-success text-white px-2 py-1">${escapeHtml(r.npsScore)}</span>`;
      } else if (r.surveyResponses && Object.keys(r.surveyResponses).length > 0) {
        npsPreview = Object.entries(r.surveyResponses)
          .map(([k, v]) => `<span class="badge bg-light text-primary border me-1">${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`)
          .join('');
      }

      let channelBadge = '<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 px-2 py-1"><i class="bi bi-whatsapp me-1"></i>WhatsApp</span>';
      if (r.channel === 'TELEGRAM') {
        channelBadge = '<span class="badge bg-info bg-opacity-10 text-info border border-info border-opacity-25 px-2 py-1"><i class="bi bi-telegram me-1"></i>Telegram</span>';
      } else if (r.channel === 'WEBCHAT') {
        channelBadge = '<span class="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 px-2 py-1"><i class="bi bi-laptop me-1"></i>Webchat</span>';
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(r.contactName)}</strong><br><small class="text-muted">${escapeHtml(r.contactPhone)}</small></td>
        <td><span class="badge bg-light text-dark border">${escapeHtml(r.initiationType)}</span></td>
        <td>${channelBadge}</td>
        <td><span class="badge bg-secondary">${escapeHtml(r.status)}</span></td>
        <td>${escapeHtml(r.skill || 'Geral')}</td>
        <td>${escapeHtml(r.agentName || 'N/A')}</td>
        <td>${new Date(r.createdAt).toLocaleString()}</td>
        <td>${npsPreview}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-primary" onclick="viewAuditChat('${r.id}')">
            <i class="bi bi-search"></i> Auditar
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (e) {
    console.error('Erro ao pesquisar conversas para auditoria:', e);
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger py-4">Erro ao buscar conversas: ${escapeHtml(e.message)}</td></tr>`;
  }
};

window.viewAuditChat = async (sessionId) => {
  currentAuditConversationId = sessionId;
  const token = getSupervisorToken();
  const modal = new bootstrap.Modal(document.getElementById('auditChatModal'));
  modal.show();

  const msgContainer = document.getElementById('auditChatMessages');
  msgContainer.innerHTML = '<div class="text-center py-5 text-muted"><div class="spinner-border text-primary mb-2"></div><br>Carregando histórico...</div>';

  try {
    const res = await fetch(`/api/customer-history/session/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Não foi possível carregar os detalhes do chat.');

    const data = await res.json();
    const session = data.session;
    const messages = data.messages || [];
    const notes = data.internal_notes || [];

    // Preencher Sidebar
    document.getElementById('auditMetaClient').textContent = session.contact.name || 'Sem nome';
    document.getElementById('auditMetaPhone').textContent = session.contact.phone || '-';
    document.getElementById('auditMetaAgent').textContent = session.agent || 'Sem Agente';
    document.getElementById('auditMetaStart').textContent = new Date(session.started_at).toLocaleString();
    document.getElementById('auditMetaEnd').textContent = session.ended_at ? new Date(session.ended_at).toLocaleString() : 'Ativo';
    document.getElementById('auditMetaDisposition').textContent = session.disposition || '-';
    document.getElementById('auditMetaNotes').textContent = session.closingNotes || 'Sem observações.';

    // Preencher IA
    const aiCard = document.getElementById('auditMetaAiCard');
    if (aiCard) {
      if (session.aiSummary || session.aiSentiment) {
        aiCard.style.display = 'block';
        document.getElementById('auditMetaAiSummary').textContent = session.aiSummary || 'Sem resumo.';
        
        const sentiment = session.aiSentiment || 'NEUTRO';
        const sentimentBadge = document.getElementById('auditMetaAiSentiment');
        sentimentBadge.textContent = sentiment;
        sentimentBadge.className = 'badge ' + 
          (sentiment === 'MUITO_POSITIVO' ? 'bg-success' : 
           sentiment === 'POSITIVO' ? 'bg-success bg-opacity-75' : 
           sentiment === 'NEUTRO' ? 'bg-warning text-dark' : 
           sentiment === 'NEGATIVO' ? 'bg-danger bg-opacity-75' : 
           'bg-danger');

        const tagsContainer = document.getElementById('auditMetaAiTags');
        tagsContainer.innerHTML = '';
        const tags = session.aiTags || [];
        if (tags.length > 0) {
          tags.forEach(t => {
            const span = document.createElement('span');
            span.className = 'badge bg-secondary me-1 mb-1';
            span.textContent = t;
            tagsContainer.appendChild(span);
          });
        } else {
          tagsContainer.innerHTML = '<small class="text-muted" style="font-size:0.8em">Sem tags.</small>';
        }
      } else {
        aiCard.style.display = 'none';
      }
    }

    // Preencher NPS
    const surveyContainer = document.getElementById('auditMetaSurvey');
    if (session.surveyResponses && Object.keys(session.surveyResponses).length > 0) {
      let html = '<table class="table table-sm table-striped mb-0" style="font-size: 0.75rem;">';
      let hasData = false;
      Object.entries(session.surveyResponses).forEach(([key, val]) => {
        if (key.startsWith('system.') || key.startsWith('sys.') || key.includes('.')) return; // Ignora variáveis do sistema
        hasData = true;
        html += `<tr><td class="fw-bold text-wrap" style="width: 50%;">${escapeHtml(key)}</td><td class="text-wrap">${escapeHtml(String(val))}</td></tr>`;
      });
      html += '</table>';
      if (hasData) {
        surveyContainer.innerHTML = html;
      } else {
        surveyContainer.innerHTML = '<div class="text-muted text-center py-2">Nenhuma pesquisa respondida.</div>';
      }
    } else {
      surveyContainer.innerHTML = '<div class="text-muted text-center py-2">Nenhuma pesquisa respondida.</div>';
    }

    // Combinar e ordenar Mensagens e Notas
    const timeline = [];
    messages.forEach(m => {
      timeline.push({
        type: 'message',
        isOutbound: m.direction === 'OUTBOUND',
        content: m.content,
        timestamp: new Date(m.timestamp),
        mediaUrl: m.media_url,
        messageType: m.message_type
      });
    });

    notes.forEach(n => {
      timeline.push({
        type: 'note',
        content: n.content,
        author: n.author,
        timestamp: new Date(n.created_at)
      });
    });

    timeline.sort((a, b) => a.timestamp - b.timestamp);

    // Renderizar na tela
    msgContainer.innerHTML = '';
    if (timeline.length === 0) {
      msgContainer.innerHTML = '<div class="text-center py-5 text-muted">Nenhuma mensagem registrada nesta sessão.</div>';
      return;
    }

    timeline.forEach(item => {
      const div = document.createElement('div');
      if (item.type === 'message') {
        const isMe = item.isOutbound;
        div.className = `d-flex mb-2 ${isMe ? 'justify-content-end' : 'justify-content-start'}`;
        
        let mediaHtml = '';
        if (item.mediaUrl) {
          if (item.messageType === 'image') {
            mediaHtml = `<img src="${item.mediaUrl}" class="img-fluid rounded mb-1" style="max-height: 200px; cursor: pointer;" onclick="window.open('${item.mediaUrl}', '_blank')" />`;
          } else if (item.messageType === 'video') {
            mediaHtml = `<video src="${item.mediaUrl}" controls class="img-fluid rounded mb-1" style="max-height: 200px;"></video>`;
          } else if (item.messageType === 'audio') {
            mediaHtml = `<audio src="${item.mediaUrl}" controls class="w-100 mb-1"></audio>`;
          } else {
            mediaHtml = `<a href="${item.mediaUrl}" target="_blank" class="btn btn-sm btn-light border mb-1"><i class="bi bi-file-earmark-arrow-down"></i> Baixar Arquivo</a>`;
          }
        }

        div.innerHTML = `
          <div class="p-2 rounded shadow-sm ${isMe ? 'bg-success text-white' : 'bg-white text-dark'}" style="max-width: 75%; border-radius: 8px;">
            <div class="small fw-bold mb-1" style="font-size: 0.7rem; opacity: 0.85;">${isMe ? 'Atendente' : 'Cliente'}</div>
            ${mediaHtml}
            <div style="font-size: 0.9rem; word-break: break-word;">${escapeHtml(item.content || '')}</div>
            <div class="small opacity-75 text-end mt-1" style="font-size:0.65rem">
              ${item.timestamp.toLocaleTimeString()}
            </div>
          </div>
        `;
      } else {
        // Notas Internas
        div.className = 'd-flex justify-content-center mb-2';
        div.innerHTML = `
          <div class="p-2 rounded bg-warning bg-opacity-25 border border-warning text-dark text-center" style="max-width: 85%; font-size: 0.8rem; border-radius: 8px;">
            <i class="bi bi-journal-text"></i> <strong>Nota Interna (${escapeHtml(item.author)}):</strong> ${escapeHtml(item.content)}
            <div class="small opacity-75 text-center mt-1" style="font-size:0.65rem">
              ${item.timestamp.toLocaleString()}
            </div>
          </div>
        `;
      }
      msgContainer.appendChild(div);
    });

    // Auto scroll to bottom
    msgContainer.scrollTop = msgContainer.scrollHeight;

  } catch (e) {
    msgContainer.innerHTML = `<div class="text-center py-5 text-danger"><i class="bi bi-exclamation-triangle"></i> Erro ao carregar mensagens: ${escapeHtml(e.message)}</div>`;
  }
};

window.initReportsTab = initReportsTab;
window.queryReports = queryReports;
window.exportReportsCsv = exportReportsCsv;

