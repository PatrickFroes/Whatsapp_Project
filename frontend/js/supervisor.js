let currentSpyPhone = null;

async function initSupervisor() {
  const token = localStorage.getItem('token');
  if (!token) return (window.location.href = '/login.html');

  const payload = JSON.parse(atob(token.split('.')[1]));
  document.getElementById('supervisorName').innerText = `ID: ${payload.userId.substring(0, 8)}...`;

  await Promise.all([loadTeam(), loadLiveChats(), loadHistory()]);

  const socket = io({
    auth: { token }
  });

  socket.on('connect_error', (err) => {
    console.error('🔌 Socket.io erro:', err.message);
    if (err.message.includes('Token') || err.message.includes('Autenticação')) {
      fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      localStorage.removeItem('token');
      window.location.href = '/login.html';
    }
  });

  socket.on('agent_update', () => loadTeam());
  socket.on('queue_update', () => loadLiveChats());
  socket.on('msg_recv', (msg) => {
    if (
      currentSpyPhone &&
      (msg.phone === currentSpyPhone || msg.contact?.phone === currentSpyPhone)
    ) {
      appendSpyMessage(msg);
    }
  });

  setInterval(() => {
    loadTeam();
    loadLiveChats();
  }, 30000);
}

async function loadTeam() {
  try {
    const res = await fetch('/api/supervisor/team', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
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
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`
    },
    body: JSON.stringify({ status })
  });
  loadTeam();
  Swal.fire('Comando Enviado', 'O status do agente foi atualizado.', 'success');
}

async function loadLiveChats() {
  try {
    const res = await fetch('/api/supervisor/live-chats', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
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
            <div class="live-chat-preview" onclick="openSpyModal('${escapeHtml(c.contact.phone)}', '${escapeHtml(c.contact.name || c.contact.phone)}')">
                <div class="d-flex justify-content-between">
                    <strong>${escapeHtml(c.contact.name || c.contact.phone)}</strong>
                    <span class="badge bg-info">${escapeHtml(c.status)}</span>
                </div>
                <div class="small text-muted text-truncate mt-1">
                    ${c.messages[0] ? escapeHtml(c.messages[0].content) : 'Iniciando conversa...'}
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

async function openSpyModal(phone, name) {
  currentSpyPhone = phone;
  document.getElementById('spyModalLabel').innerText = `Espionando: ${name}`;
  const modal = new bootstrap.Modal(document.getElementById('spyModal'));
  modal.show();

  const body = document.getElementById('spyModalBody');
  body.innerHTML = '<div class="text-center"><div class="spinner-border"></div></div>';

  try {
    const res = await fetch(`/api/chats/${phone}/messages`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const msgs = await res.json();

    body.innerHTML = '';
    msgs.forEach((m) => appendSpyMessage(m));
    scrollToBottom();
  } catch (e) {
    body.innerHTML = '<p class="text-danger">Erro ao carregar mensagens.</p>';
  }
}

function appendSpyMessage(msg) {
  const body = document.getElementById('spyModalBody');
  const isMe = msg.direction === 'OUTBOUND';
  const div = document.createElement('div');
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

async function loadHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;

  if (container.children.length <= 1) {
    container.innerHTML =
      '<div class="text-center py-5"><div class="spinner-border text-secondary"></div></div>';
  }

  try {
    const res = await fetch('/api/supervisor/history?limit=50', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const chats = await res.json();

    if (chats.length === 0) {
      container.innerHTML = '<p class="text-center text-muted py-3">Nenhum histórico recente.</p>';
      return;
    }

    container.innerHTML = chats
      .map(
        (c) => `
            <div class="card mb-2 border-0 shadow-sm">
                <div class="card-body py-2">
                    <div class="d-flex justify-content-between">
                        <strong>${c.contact.name || c.contact.phone}</strong>
                        <small class="text-muted">${new Date(c.updatedAt).toLocaleString()}</small>
                    </div>
                    <div class="d-flex justify-content-between small mt-1">
                        <span class="text-muted">Atendido por: ${c.assignedTo ? c.assignedTo.name : 'N/A'}</span>
                        <button class="btn btn-sm btn-outline-primary py-0" style="font-size: 0.8em;" onclick="openSpyModal('${c.contact.phone}', '${c.contact.name || c.contact.phone}')">
                            <i class="bi bi-eye"></i> Ver Conversa
                        </button>
                    </div>
                </div>
            </div>
        `
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
