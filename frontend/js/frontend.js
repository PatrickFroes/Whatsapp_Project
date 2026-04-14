const API_URL = '/api';
let activeChatId = null;
let activeConversationId = null;
let currentListMode = 'my';
let allMessages = [];
let pauseTimerInterval = null;
let socket = null;

document.addEventListener('DOMContentLoaded', () => {
  const user = checkAuth();
  if (!user) return;

  initSocket(user);

  if (document.getElementById('agentNameDisplay')) {
    document.getElementById('agentNameDisplay').innerText = user.username || 'Agente';
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('embed') === 'true') {
    const nav = document.querySelector('nav');
    if (nav) nav.style.display = 'none';

    const container = document.querySelector('.container-fluid');
    if (container) {
      container.classList.add('p-0');
    }
  }

  fetchAgentStatus();
  loadChats();

  setInterval(() => loadChats(currentListMode), 5000);
  setInterval(refreshActiveChat, 3000);
});

function checkAuth() {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');
  if (!token || !userStr) {
    window.location.href = '/login.html';
    return null;
  }
  return JSON.parse(userStr);
}

function handleIncomingMessage(data) {
  const currentState = data.message || data;
  const conversationId = data.conversationId;

  if (activeChatId) {
    const eventPhone = data.phone || (data.contact ? data.contact.phone : null);

    if (eventPhone === activeChatId) {
      refreshActiveChat();
    }
  }

  loadChats();
}

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

window.logout = () => {
  if (activeConversationId && socket) {
    socket.emit('leave_conversation', activeConversationId);
  }

  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
};

window.loadChats = async (mode = currentListMode) => {
  currentListMode = mode;
  try {
    const res = await fetch(`${API_URL}/chats?mode=${mode}`, { headers: getAuthHeaders() });
    const data = await res.json();
    const chats = data.chats || [];

    const qBadge = document.getElementById('queueCount');
    if (qBadge && data.meta) qBadge.innerText = data.meta.queueCount || 0;

    renderChatList(chats);
  } catch (e) {
    console.error('Load Chats Error:', e);
  }
};

function renderChatList(chats) {
  const list = document.getElementById('chatList');
  if (!list) return;

  list.innerHTML = '';

  if (chats.length === 0) {
    list.innerHTML = `
            <div class="text-center p-4 text-muted small mt-4">
                ${currentListMode === 'my' ? 'Você não tem atendimentos ativos.' : 'Fila de espera vazia.'}
            </div>`;
    return;
  }

  chats.forEach((chat) => {
    const isActive = activeChatId === chat.phone;
    const item = document.createElement('div');

    item.className = `p-3 border-bottom chat-item ${isActive ? 'bg-secondary bg-opacity-10 border-start border-success border-4' : ''}`;
    item.style.cursor = 'pointer';
    item.onclick = () => selectChat(chat.phone);

    let timeStr = '';
    if (chat.timestamp) {
      timeStr = new Date(chat.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    const lastMsg = chat.lastMessage || 'Nova conversa';

    item.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="fw-bold text-truncate text-dark" style="max-width: 60%">${escapeHtml(chat.name || chat.phone)}</span>
                <small class="text-muted" style="font-size: 0.75rem">${timeStr}</small>
            </div>
            <div class="d-flex justify-content-between align-items-center">
                <small class="text-secondary text-truncate" style="max-width: 80%; font-size: 0.85rem">
                    ${escapeHtml(lastMsg)}
                </small>
                ${chat.unread > 0 ? `<span class="badge bg-success rounded-pill" style="font-size: 0.6rem">${chat.unread}</span>` : ''}
            </div>
        `;
    list.appendChild(item);
  });
}

window.selectChat = async (phone) => {
  if (activeChatId === phone) return;

  if (activeConversationId && socket) {
    socket.emit('leave_conversation', activeConversationId);
    console.log('Left conversation room:', activeConversationId);
  }

  activeChatId = phone;
  activeConversationId = null;
  document.getElementById('currentPhone').value = phone;

  const titleEl = document.getElementById('currentChatTitle');
  if (titleEl) titleEl.innerText = `+${phone}`;

  document.getElementById('currentChatSubtitle').innerText = 'Carregando...';

  const inputArea = document.getElementById('inputArea');
  const msgsArea = document.getElementById('messagesArea');

  msgsArea.innerHTML = `
        <div class="h-100 d-flex flex-column align-items-center justify-content-center text-muted">
             <div class="spinner-border text-success" role="status"></div>
        </div>
    `;

  inputArea.classList.remove('d-none');
  inputArea.classList.add('d-flex');

  document.body.classList.add('chat-active');

  loadChats();

  await refreshActiveChat();

  await loadConversationId(phone);

  document.getElementById('currentChatSubtitle').innerText = 'Atendimento em andamento';
  document.getElementById('chatInput').focus();
};

async function loadConversationId(phone) {
  try {
    const res = await fetch(`${API_URL}/chats`, { headers: getAuthHeaders() });
    const data = await res.json();
    const chats = data.chats || [];

    const chat = chats.find((c) => c.phone === phone);
    if (chat && chat.conversationId) {
      currentConversationId = chat.conversationId;
      activeConversationId = chat.conversationId;

      if (socket) {
        socket.emit('join_conversation', activeConversationId);
        console.log('Joined conversation room:', activeConversationId);
      }

      loadInternalNotes();
    }
  } catch (e) {
    console.error('Erro ao buscar conversation ID:', e);
  }
}

window.refreshActiveChat = async () => {
  if (!activeChatId) return;

  try {
    const res = await fetch(`${API_URL}/history/${activeChatId}`, { headers: getAuthHeaders() });
    if (!res.ok) return;

    const messages = await res.json();

    if (JSON.stringify(messages) !== JSON.stringify(allMessages)) {
      allMessages = messages;
      renderMessages(messages);
    }
  } catch (e) {
    console.error('Sync Error', e);
  }
};

function renderMessages(messages) {
  const area = document.getElementById('messagesArea');
  if (!area) return;

  area.innerHTML = '';

  if (!messages || messages.length === 0) {
    area.innerHTML = `
            <div class="w-100 h-100 d-flex flex-column align-items-center justify-content-center text-muted opacity-50">
                <i class="bi bi-chat-dots fs-1 mb-2"></i>
                <small>Histórico vazio</small>
            </div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  messages.forEach((msg) => {
    const isMe = msg.direction === 'OUTBOUND';
    const isSystem = msg.type === 'system' || msg.senderId === 'system';

    const div = document.createElement('div');

    if (isSystem) {
      div.className = 'w-100 text-center my-2';
      div.innerHTML = `<span class="badge bg-secondary opacity-75 fw-normal text-wrap" style="max-width: 80%">${escapeHtml(msg.content)}</span>`;
    } else {
      div.className = `d-flex w-100 mb-1 ${isMe ? 'justify-content-end' : 'justify-content-start'}`;

      const time = new Date(msg.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });

      let contentHtml = '';

      const mediaUrl = msg.mediaUrl;
      const isWhatsAppId = mediaUrl && !mediaUrl.startsWith('http') && !mediaUrl.startsWith('[');

      if (msg.contentType === 'image') {
        if (isWhatsAppId) {
          contentHtml = `
                        <div class="media-loading" data-media-id="${mediaUrl}" data-type="image">
                            <div class="spinner-border spinner-border-sm" role="status"></div>
                            <small>Carregando imagem...</small>
                        </div>
                    `;

          setTimeout(() => loadMediaUrl(mediaUrl, 'image'), 100);
        } else if (mediaUrl && mediaUrl.startsWith('http')) {
          contentHtml = `
                        <img src="${mediaUrl}" alt="Imagem" class="img-fluid rounded mb-2" style="max-width: 250px; cursor: pointer;" onclick="window.open('${mediaUrl}', '_blank')">
                    `;
        } else {
          contentHtml = `<div class="mb-2">${escapeHtml(msg.content)}</div>`;
        }
      } else if (msg.contentType === 'video') {
        if (isWhatsAppId) {
          contentHtml = `
                        <div class="media-loading" data-media-id="${mediaUrl}" data-type="video">
                            <div class="spinner-border spinner-border-sm" role="status"></div>
                            <small>Carregando vídeo...</small>
                        </div>
                    `;
          setTimeout(() => loadMediaUrl(mediaUrl, 'video'), 100);
        } else if (mediaUrl && mediaUrl.startsWith('http')) {
          contentHtml = `
                        <video controls class="rounded mb-2" style="max-width: 250px;">
                            <source src="${mediaUrl}" type="video/mp4">
                        </video>
                    `;
        } else {
          contentHtml = `<div class="mb-2">${escapeHtml(msg.content)}</div>`;
        }
      } else if (msg.contentType === 'audio') {
        if (isWhatsAppId) {
          contentHtml = `
                        <div class="media-loading" data-media-id="${mediaUrl}" data-type="audio">
                            <div class="spinner-border spinner-border-sm" role="status"></div>
                            <small>Carregando áudio...</small>
                        </div>
                    `;
          setTimeout(() => loadMediaUrl(mediaUrl, 'audio'), 100);
        } else if (mediaUrl && mediaUrl.startsWith('http')) {
          contentHtml = `
                        <audio controls class="mb-2" style="width: 250px;">
                            <source src="${mediaUrl}" type="audio/ogg">
                        </audio>
                    `;
        } else {
          contentHtml = `<div class="mb-2">${escapeHtml(msg.content)}</div>`;
        }
      } else if (msg.contentType === 'document') {
        const filename = msg.mediaFilename || 'Documento';
        if (isWhatsAppId) {
          contentHtml = `
                        <div class="media-loading" data-media-id="${mediaUrl}" data-type="document" data-filename="${filename}">
                            <i class="bi bi-file-earmark-text fs-1 me-2"></i>
                            <div>
                                <div class="fw-bold">${filename}</div>
                                <small class="text-muted">Carregando...</small>
                            </div>
                        </div>
                    `;
          setTimeout(() => loadMediaUrl(mediaUrl, 'document', filename), 100);
        } else if (mediaUrl && mediaUrl.startsWith('http')) {
          contentHtml = `
                        <a href="${mediaUrl}" target="_blank" class="d-flex align-items-center text-decoration-none mb-2">
                            <i class="bi bi-file-earmark-text fs-1 me-2"></i>
                            <div>
                                <div class="fw-bold">${filename}</div>
                                ${msg.mediaSize ? `<small class="text-muted">${formatFileSize(msg.mediaSize)}</small>` : ''}
                            </div>
                        </a>
                    `;
        } else {
          contentHtml = `<div class="mb-2">${escapeHtml(msg.content)}</div>`;
        }
      } else if (msg.contentType === 'location') {
        contentHtml = `
                    <div class="mb-2">
                        <i class="bi bi-geo-alt-fill text-danger"></i> <strong>Localização</strong>
                        ${msg.content ? `<div class="small">${escapeHtml(msg.content)}</div>` : ''}
                    </div>
                `;
      } else {
        contentHtml = `<div class="mb-2">${escapeHtml(msg.content)}</div>`;
      }

      div.innerHTML = `
                <div class="message-bubble ${isMe ? 'message-out' : 'message-in'} text-dark position-relative" style="min-width: 120px; max-width: 350px;">
                    ${contentHtml}
                    <div class="message-meta d-flex align-items-center justify-content-end gap-1">
                        <span>${time}</span>
                        ${isMe ? '<i class="bi bi-check2-all text-primary"></i>' : ''}
                    </div>
                </div>
            `;
    }
    fragment.appendChild(div);
  });

  area.appendChild(fragment);
  area.scrollTop = area.scrollHeight;
}

window.handleSendMessage = async (e) => {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content || !activeChatId) return;

  input.value = '';

  input.focus();

  try {
    const res = await fetch(`${API_URL}/chats/${activeChatId}/send`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ content, type: 'text' })
    });

    if (res.ok) {
      await refreshActiveChat();
      loadChats();
    } else {
      console.error('Send Failed');
    }
  } catch (e) {
    console.error(e);
  }
};

window.closeChat = () => {
  if (!activeChatId) return;
  const modal = new bootstrap.Modal(document.getElementById('closeChatModal'));
  modal.show();
};

window.backToChats = () => {
  if (activeConversationId && socket) {
    socket.emit('leave_conversation', activeConversationId);
    console.log('Left conversation room (back to list):', activeConversationId);
  }

  activeChatId = null;
  activeConversationId = null;

  document.body.classList.remove('chat-active');

  loadChats();
};

window.confirmCloseChat = async (e) => {
  e.preventDefault();
  if (!activeChatId) return;

  const disposition = document.getElementById('closeDisposition').value;
  const notes = document.getElementById('closeNotes').value;

  const modalEl = document.getElementById('closeChatModal');
  const modal = bootstrap.Modal.getInstance(modalEl);
  modal.hide();

  try {
    const res = await fetch(`${API_URL}/chats/${activeChatId}/resolve`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ disposition, notes })
    });

    if (res.ok) {
      if (activeConversationId && socket) {
        socket.emit('leave_conversation', activeConversationId);
        console.log('Left conversation room after closing:', activeConversationId);
      }

      activeChatId = null;
      activeConversationId = null;
      document.body.classList.remove('chat-active');

      document.getElementById('messagesArea').innerHTML = `
                <div class="w-100 h-100 d-flex flex-column align-items-center justify-content-center text-muted">
                    <i class="bi bi-whatsapp display-4 text-success mb-3"></i>
                    <p class="mb-0">WhatsApp Intranet Broker</p>
                </div>
            `;
      document.getElementById('inputArea').classList.add('d-none');
      document.getElementById('inputArea').classList.remove('d-flex');
      document.getElementById('currentChatTitle').innerText = '...';
      document.getElementById('currentChatSubtitle').innerText = 'Selecione uma conversa';
      loadChats();
    } else {
      const data = await res.json();
      alert(`Erro ao encerrar: ${data.error || 'Desconhecido'}`);
    }
  } catch (e) {
    console.error(e);
  }
};

window.fetchAgentStatus = async () => {
  try {
    const res = await fetch(`${API_URL}/agent/status`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (data && data.status) {
      updateStatusUI(data.status, data.reason || (data.status === 'paused' ? 'Pausa' : ''));
    }
  } catch (e) {
    console.error(e);
  }
};

window.setAgentStatusUI = async (status) => {
  await updateAgentStatus(status);
  updateStatusUI(status);
};

window.initiatePause = async () => {
  try {
    console.log('[Pause] Iniciando seleção de motivo...');
    const res = await fetch(`${API_URL}/pauses`, { headers: getAuthHeaders() });

    if (!res.ok) {
      console.error('[Pause] Erro ao buscar motivos:', res.status);
      alert('Erro ao buscar motivos de pausa. Por favor, tente novamente.');
      return;
    }

    const data = await res.json();
    console.log('[Pause] Motivos recebidos:', data);

    const list = document.getElementById('pauseReasonsList');
    if (!list) {
      console.error('[Pause] Elemento pauseReasonsList não encontrado!');
      alert('Erro: Modal de pausa não configurado corretamente.');
      return;
    }

    list.innerHTML = '';

    let reasons;
    if (Array.isArray(data.reasons)) {
      reasons = data.reasons;
    } else if (Array.isArray(data)) {
      reasons = data;
    } else {
      console.error('[Pause] Formato inesperado de motivos:', data);
      reasons = [
        { label: 'Pausa Curta', maxMinutes: 15 },
        { label: 'Almoço', maxMinutes: 60 }
      ];
    }

    console.log('[Pause] Array de motivos:', reasons);

    if (reasons.length === 0) {
      reasons = [
        { label: 'Pausa Curta', maxMinutes: 15 },
        { label: 'Almoço', maxMinutes: 60 }
      ];
    }

    reasons.forEach((r) => {
      const btn = document.createElement('button');
      btn.className = 'list-group-item list-group-item-action';
      btn.innerText = r.label + (r.maxMinutes ? ` (${r.maxMinutes} min)` : '');
      btn.onclick = () => confirmPause(r.label);
      list.appendChild(btn);
    });

    const modalElement = document.getElementById('pauseModal');
    if (!modalElement) {
      console.error('[Pause] Elemento pauseModal não encontrado!');
      alert('Erro: Modal de pausa não encontrado no HTML.');
      return;
    }

    const modal = new bootstrap.Modal(modalElement);
    console.log('[Pause] Abrindo modal...');
    modal.show();
  } catch (e) {
    console.error('[Pause] Erro fatal:', e);
    alert('Erro ao iniciar pausa: ' + e.message);
  }
};

window.confirmPause = async (reason) => {
  console.log('[Pause] Confirmando pausa com motivo:', reason);
  const modalElement = document.getElementById('pauseModal');
  const modal = bootstrap.Modal.getInstance(modalElement);
  if (modal) {
    modal.hide();
  }

  try {
    await updateAgentStatus('paused', reason);
    updateStatusUI('paused', reason);
    console.log('[Pause] Status atualizado com sucesso');
  } catch (e) {
    console.error('[Pause] Erro ao atualizar status:', e);
    alert('Erro ao atualizar status: ' + e.message);
  }
};

async function updateAgentStatus(status, reason = '') {
  try {
    console.log('[Status] Atualizando para:', status, 'Motivo:', reason);
    const response = await fetch(`${API_URL}/agent/status`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status, reason })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao atualizar status');
    }

    const result = await response.json();
    console.log('[Status] Resultado:', result);
    return result;
  } catch (e) {
    console.error('[Status] Erro:', e);
    throw e;
  }
}

function updateStatusUI(status, reason) {
  const btn = document.getElementById('agentStatusBtn');
  const badge = document.getElementById('pauseTimerBadge');

  if (!btn) return;

  if (pauseTimerInterval) clearInterval(pauseTimerInterval);
  if (badge) badge.classList.add('d-none');

  if (status === 'online') {
    btn.innerHTML = '🟢 Online';
    btn.classList.remove('btn-warning', 'btn-danger', 'btn-secondary');
    btn.classList.add('btn-light');
  } else if (status === 'offline') {
    btn.innerHTML = '🔴 Offline';
    btn.classList.remove('btn-warning', 'btn-light', 'btn-secondary');
    btn.classList.add('btn-danger', 'text-white');
  } else if (status === 'paused') {
    btn.innerHTML = `⏸️ ${reason || 'Pausa'}`;
    btn.classList.remove('btn-light', 'btn-danger', 'btn-secondary');
    btn.classList.add('btn-warning');

    if (badge) {
      badge.classList.remove('d-none');
      let s = 0;
      badge.innerText = '00:00';
      pauseTimerInterval = setInterval(() => {
        s++;
        badge.innerText = new Date(s * 1000).toISOString().substr(14, 5);
      }, 1000);
    }
  } else if (status === 'busy') {
    btn.innerHTML = '🔶 Ocupado';
    btn.classList.remove('btn-warning', 'btn-danger', 'btn-light');
    btn.classList.add('btn-secondary');
  } else if (status === 'away') {
    btn.innerHTML = '🌙 Ausente';
    btn.classList.remove('btn-warning', 'btn-danger', 'btn-light');
    btn.classList.add('btn-secondary');
  }
}

function showNotification(message, type = 'info') {
  const alertDiv = document.createElement('div');
  alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
  alertDiv.style.cssText =
    'top: 20px; right: 20px; z-index: 9999; min-width: 300px; max-width: 500px;';
  alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
  document.body.appendChild(alertDiv);

  setTimeout(() => {
    alertDiv.classList.remove('show');
    setTimeout(() => alertDiv.remove(), 150);
  }, 5000);
}

let currentConversationId = null;
let quickReplies = [];
let availableSkills = [];

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

async function loadMediaUrl(mediaId, mediaType, filename = null) {
  try {
    const res = await fetch(`${API_URL}/media/url/${mediaId}`, {
      headers: getAuthHeaders()
    });

    if (!res.ok) {
      console.error('Failed to load media URL');
      return;
    }

    const data = await res.json();
    const url = data.url;

    const loadingEl = document.querySelector(`[data-media-id="${mediaId}"]`);
    if (!loadingEl) return;

    let newHtml = '';
    if (mediaType === 'image') {
      newHtml = `
                <img src="${url}" alt="Imagem" class="img-fluid rounded mb-2" style="max-width: 250px; cursor: pointer;" onclick="window.open('${url}', '_blank')">
            `;
    } else if (mediaType === 'video') {
      newHtml = `
                <video controls class="rounded mb-2" style="max-width: 250px;">
                    <source src="${url}" type="video/mp4">
                </video>
            `;
    } else if (mediaType === 'audio') {
      newHtml = `
                <audio controls class="mb-2" style="width: 250px;">
                    <source src="${url}" type="audio/ogg">
                </audio>
            `;
    } else if (mediaType === 'document') {
      newHtml = `
                <a href="${url}" target="_blank" class="d-flex align-items-center text-decoration-none mb-2">
                    <i class="bi bi-file-earmark-text fs-1 me-2"></i>
                    <div>
                        <div class="fw-bold">${filename || 'Documento'}</div>
                        ${data.fileSize ? `<small class="text-muted">${formatFileSize(data.fileSize)}</small>` : ''}
                    </div>
                </a>
            `;
    }

    loadingEl.outerHTML = newHtml;
  } catch (error) {
    console.error('Error loading media URL:', error);
    const loadingEl = document.querySelector(`[data-media-id="${mediaId}"]`);
    if (loadingEl) {
      loadingEl.innerHTML = '<small class="text-danger">Erro ao carregar mídia</small>';
    }
  }
}

async function loadQuickReplies() {
  try {
    const res = await fetch(`${API_URL}/quick-replies?isActive=true`, {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      quickReplies = await res.json();
      renderQuickRepliesMenu();
    }
  } catch (e) {
    console.error('Erro ao carregar quick replies:', e);
  }
}

function renderQuickRepliesMenu() {
  const menu = document.getElementById('quickRepliesMenu');
  if (!menu) return;

  if (quickReplies.length === 0) {
    menu.innerHTML =
      '<li><span class="dropdown-item-text text-muted small">Nenhuma resposta rápida disponível</span></li>';
    return;
  }

  const grouped = {};
  quickReplies.forEach((qr) => {
    const cat = qr.category || 'Outros';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(qr);
  });

  let html = '';
  Object.keys(grouped).forEach((cat) => {
    html += `<li><h6 class="dropdown-header">${escapeHtml(cat)}</h6></li>`;
    grouped[cat].forEach((qr) => {
      html += `<li><a class="dropdown-item" href="#" onclick="useQuickReply('${escapeHtml(qr.shortcut)}'); return false;">
                <strong>${escapeHtml(qr.shortcut)}</strong> - ${escapeHtml(qr.title)}
            </a></li>`;
    });
    html += '<li><hr class="dropdown-divider"></li>';
  });

  menu.innerHTML = html;
}

async function useQuickReply(shortcut) {
  try {
    const phone = document.getElementById('currentPhone').value;
    if (!phone) return;

    const res = await fetch(
      `${API_URL}/quick-replies/${encodeURIComponent(shortcut)}?phone=${phone}`,
      {
        headers: getAuthHeaders()
      }
    );

    if (res.ok) {
      const data = await res.json();
      document.getElementById('chatInput').value = data.processedContent;
    }
  } catch (e) {
    console.error('Erro ao usar quick reply:', e);
  }
}

function handleQuickReplyShortcut(event) {
  const input = event.target;
  const text = input.value;

  if (text.startsWith('/')) {
    const matches = quickReplies.filter((qr) =>
      qr.shortcut.toLowerCase().includes(text.toLowerCase())
    );
  }
}

async function loadInternalNotes() {
  if (!currentConversationId) return;

  try {
    const res = await fetch(`${API_URL}/conversations/${currentConversationId}/notes`, {
      headers: getAuthHeaders()
    });

    if (res.ok) {
      const notes = await res.json();
      renderNotesList(notes);
      document.getElementById('notesCount').innerText = notes.length;
    }
  } catch (e) {
    console.error('Erro ao carregar notas:', e);
  }
}

function renderNotesList(notes) {
  const list = document.getElementById('notesList');
  if (!list) return;

  if (notes.length === 0) {
    list.innerHTML = '<div class="text-center text-muted small">Sem notas</div>';
    return;
  }

  let html = '';
  notes.forEach((note) => {
    const date = new Date(note.createdAt).toLocaleString('pt-BR');
    html += `
            <div class="card mb-2 shadow-sm">
                <div class="card-body p-2">
                    <div class="d-flex justify-content-between align-items-start">
                        <div class="flex-grow-1">
                            <small class="text-primary fw-bold">${escapeHtml(note.user.username)}</small>
                            <small class="text-muted d-block">${date}</small>
                            <p class="mb-0 mt-1 small">${escapeHtml(note.content)}</p>
                        </div>
                        <button class="btn btn-sm btn-link text-danger p-0" onclick="deleteNote(${note.id})" title="Deletar">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
  });

  list.innerHTML = html;
}

async function addInternalNote(event) {
  event.preventDefault();

  const content = document.getElementById('newNoteInput').value.trim();
  if (!content || !currentConversationId) return;

  try {
    const res = await fetch(`${API_URL}/conversations/${currentConversationId}/notes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ content })
    });

    if (res.ok) {
      document.getElementById('newNoteInput').value = '';
      loadInternalNotes();

      Swal.fire({
        icon: 'success',
        title: 'Nota adicionada!',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000
      });
    }
  } catch (e) {
    console.error('Erro ao adicionar nota:', e);
    Swal.fire('Erro', 'Não foi possível adicionar a nota', 'error');
  }
}

async function deleteNote(noteId) {
  const confirm = await Swal.fire({
    title: 'Deletar nota?',
    text: 'Esta ação não pode ser desfeita',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, deletar',
    cancelButtonText: 'Cancelar'
  });

  if (!confirm.isConfirmed) return;

  try {
    const res = await fetch(`${API_URL}/notes/${noteId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });

    if (res.ok) {
      loadInternalNotes();
      Swal.fire({
        icon: 'success',
        title: 'Nota deletada!',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000
      });
    }
  } catch (e) {
    console.error('Erro ao deletar nota:', e);
    Swal.fire('Erro', 'Não foi possível deletar a nota', 'error');
  }
}

function toggleNotesPanel() {
  const panel = document.getElementById('notesPanel');
  if (!panel) return;

  if (panel.classList.contains('d-none')) {
    panel.classList.remove('d-none');
    panel.classList.add('d-flex');
    loadInternalNotes();
  } else {
    panel.classList.add('d-none');
    panel.classList.remove('d-flex');
  }
}

async function openTransferModal() {
  if (!currentConversationId) {
    Swal.fire('Atenção', 'Selecione uma conversa primeiro', 'info');
    return;
  }

  await Promise.all([loadAvailableAgents(), loadAvailableSkills()]);

  const modal = new bootstrap.Modal(document.getElementById('transferModal'));
  modal.show();
}

async function loadAvailableAgents() {
  try {
    const res = await fetch(`${API_URL}/transfer/available-agents`, {
      headers: getAuthHeaders()
    });

    if (res.ok) {
      const agents = await res.json();
      renderAvailableAgents(agents);
    }
  } catch (e) {
    console.error('Erro ao carregar agentes:', e);
  }
}

async function loadAvailableSkills() {
  try {
    const res = await fetch(`${API_URL}/transfer/available-skills`, {
      headers: getAuthHeaders()
    });

    if (res.ok) {
      availableSkills = await res.json();
      renderAvailableSkills(availableSkills);
    }
  } catch (e) {
    console.error('Erro ao carregar skills:', e);

    const select = document.getElementById('transferToSkill');
    if (select) {
      select.innerHTML = '<option value="">Nenhuma skill disponível</option>';
    }
  }
}

function renderAvailableSkills(skills) {
  const select = document.getElementById('transferToSkill');
  if (!select) return;

  if (!skills || skills.length === 0) {
    select.innerHTML = '<option value="">Nenhuma skill cadastrada</option>';
    return;
  }

  let html = '<option value="" selected disabled>Selecione uma skill...</option>';
  skills.forEach((skill) => {
    const agentInfo = skill.agentCount
      ? ` (${skill.agentCount} ${skill.agentCount === 1 ? 'agente' : 'agentes'})`
      : ' (sem agentes)';
    const description = skill.description ? ` - ${skill.description}` : '';
    html += `<option value="${skill.id}">${skill.name}${description}${agentInfo}</option>`;
  });

  select.innerHTML = html;
}

function renderAvailableAgents(agents) {
  const select = document.getElementById('transferToAgent');
  if (!select) return;

  if (agents.length === 0) {
    select.innerHTML = '<option value="">Nenhum agente disponível</option>';
    return;
  }

  let html = '<option value="" selected disabled>Selecione um agente...</option>';
  agents.forEach((agent) => {
    const chatsInfo = agent.activeChats !== undefined ? ` (${agent.activeChats} chats)` : '';
    const status = agent.workStatus === 'ONLINE' ? '🟢' : '🟡';
    html += `<option value="${agent.id}">${status} ${agent.name || agent.email}${chatsInfo}</option>`;
  });

  select.innerHTML = html;
}

async function confirmTransfer(event) {
  event.preventDefault();

  const toUserId = document.getElementById('transferToAgent').value;
  const reason = document.getElementById('transferReason').value;
  const notes = document.getElementById('transferNotes').value;

  if (!toUserId || !currentConversationId) return;

  try {
    const res = await fetch(`${API_URL}/conversations/${currentConversationId}/transfer`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ toUserId, reason, notes })
    });

    if (res.ok) {
      const modal = bootstrap.Modal.getInstance(document.getElementById('transferModal'));
      modal.hide();

      Swal.fire({
        icon: 'success',
        title: 'Conversa transferida!',
        text: 'A conversa foi transferida com sucesso',
        timer: 2000
      });

      if (activeConversationId && socket) {
        socket.emit('leave_conversation', activeConversationId);
        console.log('Left conversation room after transfer:', activeConversationId);
      }

      loadChats(currentListMode);

      activeChatId = null;
      activeConversationId = null;
      currentConversationId = null;
      document.body.classList.remove('chat-active');
      document.getElementById('inputArea').classList.add('d-none');
      document.getElementById('messagesArea').innerHTML = `
                <div class="w-100 h-100 d-flex flex-column align-items-center justify-content-center text-muted">
                    <i class="bi bi-check-circle display-4 text-success mb-3"></i>
                    <p>Conversa transferida com sucesso!</p>
                </div>
            `;
    } else {
      const error = await res.json();
      Swal.fire('Erro', error.message || 'Não foi possível transferir', 'error');
    }
  } catch (e) {
    console.error('Erro ao transferir:', e);
    Swal.fire('Erro', 'Não foi possível transferir a conversa', 'error');
  }
}

async function confirmTransferToSkill(event) {
  event.preventDefault();

  const skillId = document.getElementById('transferToSkill').value;
  const notes = document.getElementById('transferSkillNotes').value;

  if (!skillId || !currentConversationId) return;

  try {
    const res = await fetch(`${API_URL}/conversations/${currentConversationId}/transfer-to-skill`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ skillId, notes })
    });

    if (res.ok) {
      const modal = bootstrap.Modal.getInstance(document.getElementById('transferModal'));
      modal.hide();

      Swal.fire({
        icon: 'success',
        title: 'Enviado para fila!',
        text: 'A conversa foi enviada para a fila de skill',
        timer: 2000
      });

      if (activeConversationId && socket) {
        socket.emit('leave_conversation', activeConversationId);
        console.log('Left conversation room after queue transfer:', activeConversationId);
      }

      loadChats(currentListMode);

      activeChatId = null;
      activeConversationId = null;
      currentConversationId = null;
      document.body.classList.remove('chat-active');
      document.getElementById('inputArea').classList.add('d-none');
      document.getElementById('messagesArea').innerHTML = `
                <div class="w-100 h-100 d-flex flex-column align-items-center justify-content-center text-muted">
                    <i class="bi bi-send-check display-4 text-primary mb-3"></i>
                    <p>Conversa enviada para fila de skill!</p>
                </div>
            `;
    } else {
      const error = await res.json();
      Swal.fire('Erro', error.message || 'Não foi possível enviar para fila', 'error');
    }
  } catch (e) {
    console.error('Erro ao transferir para skill:', e);
    Swal.fire('Erro', 'Não foi possível enviar para a fila', 'error');
  }
}

async function handleMediaUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const phone = document.getElementById('currentPhone').value;
  if (!phone) {
    Swal.fire('Erro', 'Nenhuma conversa selecionada', 'error');
    return;
  }

  const maxSizes = {
    image: 5 * 1024 * 1024,
    video: 16 * 1024 * 1024,
    audio: 16 * 1024 * 1024,
    application: 100 * 1024 * 1024
  };

  const fileType = file.type.split('/')[0];
  const maxSize = maxSizes[fileType] || maxSizes['application'];

  if (file.size > maxSize) {
    Swal.fire(
      'Erro',
      `Arquivo muito grande. Máximo: ${Math.round(maxSize / 1024 / 1024)}MB`,
      'error'
    );
    return;
  }

  Swal.fire({
    title: 'Enviando mídia...',
    text: `Uploading ${file.name}`,
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('phone', phone);

    const caption = await Swal.fire({
      title: 'Adicionar legenda?',
      input: 'text',
      inputPlaceholder: 'Legenda (opcional)',
      showCancelButton: true,
      confirmButtonText: 'Enviar',
      cancelButtonText: 'Enviar sem legenda'
    });

    if (caption.value) {
      formData.append('caption', caption.value);
    }

    Swal.fire({
      title: 'Enviando...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    const res = await fetch(`${API_URL}/media/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: formData
    });

    if (res.ok) {
      Swal.fire({
        icon: 'success',
        title: 'Mídia enviada!',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000
      });

      refreshActiveChat();
    } else {
      const error = await res.json();
      Swal.fire('Erro', error.message || 'Não foi possível enviar', 'error');
    }
  } catch (e) {
    console.error('Erro ao enviar mídia:', e);
    Swal.fire('Erro', 'Não foi possível enviar a mídia', 'error');
  } finally {
    event.target.value = '';
  }
}

function initSocket(user) {
  if (socket) return;

  socket = io('/', {
    auth: { token: localStorage.getItem('token') }
  });

  socket.on('connect', () => {
    console.log('🔌 Socket.io conectado:', socket.id);
  });

  socket.on('connect_error', (err) => {
    console.error('🔌 Socket.io erro de conexão:', err.message);
    if (err.message.includes('Token') || err.message.includes('Autenticação')) {
      fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login.html';
    }
  });

  socket.on('new_message', (data) => {
    console.log('📨 Nova mensagem:', data);
    handleIncomingMessage(data);
  });

  socket.on('message_sent', (data) => {
    console.log('📤 Mensagem enviada (echo):', data);
    handleIncomingMessage(data);
  });

  socket.on('chat_list_update', (data) => {
    console.log('📋 Chat list update:', data);
    loadChats(currentListMode);
  });

  socket.on('chat_assigned', (data) => {
    console.log('👤 Chat atribuído:', data);
    if (data.agentId === user.id) {
      loadChats();
      showNotification('Nova conversa atribuída a você!', 'info');
    }
  });

  socket.on('agent_status_changed', (data) => {
    console.log('🔄 Agent status changed:', data);
  });

  socket.on('status_updated', (data) => {
    console.log('📊 Meu status atualizado:', data);
    if (data.userId === user.id) {
      updateStatusUI(data.status.toLowerCase(), data.reason);
    }
  });

  socket.on('auto_transfer_notification', (data) => {
    console.log('🔄 Auto transfer:', data);
    const count = data.conversationIds?.length || 0;
    if (count > 0) {
      showNotification(
        `${count} conversa${count > 1 ? 's foram transferidas' : ' foi transferida'} devido à mudança de status`,
        'info'
      );
      loadChats();
    }
  });

  socket.on('message_status', (data) => {
    console.log('✓ Message status:', data);
  });

  socket.on('conversation_resolved', (data) => {
    console.log('✅ Conversa resolvida:', data);
    loadChats(currentListMode);
  });

  socket.on('internal-note', (data) => {
    console.log('📝 Nova nota interna:', data);
    if (currentConversationId === data.conversationId) {
      loadInternalNotes();
    }
  });

  socket.on('internal-note-deleted', (data) => {
    console.log('🗑️ Nota interna removida:', data);
    if (currentConversationId === data.conversationId) {
      loadInternalNotes();
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Socket.io desconectado');
  });
}

async function openHistoryPanel() {
  if (!activeChatId) {
    Swal.fire({
      icon: 'warning',
      title: 'Atenção',
      text: 'Selecione uma conversa para ver o histórico'
    });
    return;
  }

  const modal = new bootstrap.Modal(document.getElementById('historyModal'));
  modal.show();

  const phoneElement = document.getElementById('currentPhone');
  if (!phoneElement || !phoneElement.value) {
    Swal.fire('Erro', 'Telefone não identificado', 'error');
    return;
  }

  await loadContactHistory(phoneElement.value);
}

async function loadContactHistory(phone) {
  const token = localStorage.getItem('token');

  try {
    const [summaryRes, sessionsRes] = await Promise.all([
      fetch(`${API_URL}/customer-history/contact/${phone}/summary`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch(`${API_URL}/customer-history/contact/${phone}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    ]);

    if (summaryRes.status === 403 || sessionsRes.status === 403) {
      Swal.fire({
        icon: 'error',
        title: 'Acesso Negado',
        text: 'Você precisa ter uma conversa ativa com este cliente para ver o histórico'
      });
      bootstrap.Modal.getInstance(document.getElementById('historyModal')).hide();
      return;
    }

    const summary = await summaryRes.json();
    const sessions = await sessionsRes.json();

    renderContactSummary(summary);

    renderSessionsList(sessions.sessions);
  } catch (error) {
    console.error('Erro ao carregar histórico:', error);
    Swal.fire('Erro', 'Erro ao carregar histórico do cliente', 'error');
  }
}

function renderContactSummary(data) {
  const container = document.getElementById('contactSummary');

  const summary = data.summary || {};
  const contact = data.contact || {};

  const dispositionBadges =
    summary.dispositions && Object.keys(summary.dispositions).length > 0
      ? Object.entries(summary.dispositions)
          .map(([disp, count]) => `<span class="badge bg-secondary">${disp}: ${count}</span>`)
          .join(' ')
      : '<span class="badge bg-secondary">Sem resoluções</span>';

  container.innerHTML = `
        <div class="card">
            <div class="card-body p-2">
                <h6 class="card-title mb-2">${escapeHtml(contact.name || 'Cliente')}</h6>
                <div class="small">
                    <div><strong>Total de Sessões:</strong> ${summary.total_sessions || 0}</div>
                    <div><strong>Total de Mensagens:</strong> ${summary.total_messages || 0}</div>
                    <div class="mt-2">
                        <strong>Resoluções:</strong><br>
                        ${dispositionBadges}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderSessionsList(sessions) {
  const container = document.getElementById('sessionsList');

  console.log('[History] Renderizando sessões:', sessions?.length, 'sessões');

  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<div class="text-muted text-center p-3">Sem sessões anteriores</div>';
    return;
  }

  container.innerHTML = sessions
    .map((session) => {
      const startDate = new Date(session.started_at);
      const duration = session.duration_minutes ? `${session.duration_minutes}min` : 'Em andamento';
      const statusBadge = session.is_current
        ? '<span class="badge bg-success">Atual</span>'
        : session.status === 'RESOLVED' || session.status === 'CLOSED'
          ? `<span class="badge bg-secondary">${session.disposition || 'CLOSED'}</span>`
          : `<span class="badge bg-warning">${session.status}</span>`;

      return `
            <div class="card mb-2 session-card ${session.is_current ? 'border-success border-2' : ''}" 
                 onclick="loadSessionMessages('${session.id}', ${session.is_current})"
                 style="cursor: pointer;">
                <div class="card-body p-2">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <div class="small fw-bold">${startDate.toLocaleString('pt-BR')}</div>
                            <div class="small text-muted">
                                Agente: ${session.agent ? session.agent.name : 'Não atribuído'}<br>
                                Mensagens: ${session.message_count}
                            </div>
                        </div>
                        <div class="text-end">
                            ${statusBadge}
                            <div class="small text-muted">${duration}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    })
    .join('');
}

async function loadSessionMessages(sessionId, isCurrent) {
  const container = document.getElementById('sessionMessages');

  console.log('[History] Carregando mensagens da sessão:', sessionId, 'isCurrent:', isCurrent);

  if (isCurrent) {
    container.innerHTML = `
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i>
                Esta é a sessão atual. As mensagens estão visíveis no chat principal.
            </div>
        `;
    return;
  }

  container.innerHTML =
    '<div class="text-center p-4"><div class="spinner-border"></div><p class="mt-2">Carregando mensagens...</p></div>';

  try {
    const token = localStorage.getItem('token');
    console.log('[History] Buscando:', `${API_URL}/customer-history/session/${sessionId}`);

    const response = await fetch(`${API_URL}/customer-history/session/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log('[History] Response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[History] Erro na resposta:', errorData);
      throw new Error(errorData.message || 'Erro ao carregar mensagens');
    }

    const data = await response.json();
    console.log('[History] Dados recebidos:', data);
    renderSessionMessages(data);
  } catch (error) {
    console.error('[History] Erro ao carregar mensagens:', error);
    container.innerHTML = `<div class="alert alert-danger">Erro ao carregar mensagens: ${error.message}</div>`;
  }
}

function renderSessionMessages(data) {
  const container = document.getElementById('sessionMessages');
  const session = data.session;
  const messages = data.messages || [];
  const internalNotes = data.internal_notes || [];

  const startDate = new Date(session.started_at);
  const endDate = session.ended_at ? new Date(session.ended_at) : null;

  let header = `
        <div class="card mb-3">
            <div class="card-body">
                <h6><i class="bi bi-calendar-event"></i> Sessão de ${startDate.toLocaleString('pt-BR')}</h6>
                <div class="small">
                    <strong>Agente:</strong> ${session.agent || 'Não atribuído'}<br>
                    <strong>Status:</strong> ${session.status}
                    ${session.disposition ? ` - ${session.disposition}` : ''}<br>
                    ${endDate ? `<strong>Encerrada em:</strong> ${endDate.toLocaleString('pt-BR')}` : ''}
                </div>
            </div>
        </div>
    `;

  const allItems = [
    ...messages.map((msg) => ({ ...msg, type: 'message', timestamp: msg.timestamp })),
    ...internalNotes.map((note) => ({ ...note, type: 'internal_note', timestamp: note.created_at }))
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (allItems.length === 0) {
    container.innerHTML =
      header + '<div class="text-muted text-center p-3">Sem mensagens nesta sessão</div>';
    return;
  }

  const itemsHtml = allItems
    .map((item) => {
      const time = new Date(item.timestamp).toLocaleString('pt-BR');

      if (item.type === 'internal_note') {
        return `
                <div class="card mb-2 border-warning">
                    <div class="card-body p-2">
                        <div class="small">
                            <i class="bi bi-sticky"></i> <strong>Nota Interna</strong> (${item.author}) - ${time}
                            <br>${item.content}
                        </div>
                    </div>
                </div>
            `;
      }

      const isInbound = item.direction === 'INBOUND';
      const alignment = isInbound ? 'start' : 'end';
      const bgColor = isInbound ? 'bg-light' : 'bg-primary text-white';

      return `
            <div class="d-flex justify-content-${alignment} mb-2">
                <div class="card ${bgColor}" style="max-width: 70%;">
                    <div class="card-body p-2">
                        <div class="small">${item.content || '(Mensagem sem conteúdo)'}</div>
                        <div class="text-muted" style="font-size: 0.7rem;">${time}</div>
                    </div>
                </div>
            </div>
        `;
    })
    .join('');

  const hasMorePages = data.pagination && data.pagination.page < data.pagination.total_pages;

  container.innerHTML =
    header +
    `
        <div style="max-height: 500px; overflow-y: auto;">
            ${itemsHtml}
        </div>
        ${
          hasMorePages
            ? `
            <div class="text-center mt-2">
                <button class="btn btn-sm btn-outline-secondary" 
                        onclick="loadMoreSessionMessages('${session.id}', ${data.pagination.page + 1})">
                    Carregar mais mensagens (${data.pagination.total} total)
                </button>
            </div>
        `
            : ''
        }
    `;
}

async function loadMoreSessionMessages(sessionId, page) {
  const token = localStorage.getItem('token');

  try {
    const response = await fetch(`${API_URL}/customer-history/session/${sessionId}?page=${page}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) throw new Error('Erro ao carregar mais mensagens');

    const data = await response.json();

    renderSessionMessages(data);
  } catch (error) {
    console.error('Erro ao carregar mais mensagens:', error);
    Swal.fire('Erro', 'Erro ao carregar mais mensagens', 'error');
  }
}
