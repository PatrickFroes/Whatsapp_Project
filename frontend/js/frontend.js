const API_URL = '/api';
let activeChatId = null;
let activeConversationId = null;
let activeChatOwnerId = null;
let currentListMode = 'my';
let allMessages = [];
let pauseTimerInterval = null;
let socket = null;

let inMemoryToken = null;
function getAgentToken() {
  const isIframe = window.self !== window.top;
  if (!isIframe) return null; // Fora do iframe, usa apenas cookies nativos (sem cabeçalho de rede)
  return inMemoryToken || null;
}

document.addEventListener('DOMContentLoaded', async () => {
  document.body.style.display = 'none';

  const isIframe = window.self !== window.top;
  if (!isIframe) {
    localStorage.removeItem('token'); // Limpa resquícios antigos do localStorage fora do iframe
  }
  const urlParams = new URLSearchParams(window.location.search);

  async function startApp(user) {
    window.currentUser = user;
    initSocket(user);

    if (document.getElementById('agentNameDisplay')) {
      document.getElementById('agentNameDisplay').innerText = user.name || user.email || 'Agente';
    }

    if (urlParams.get('embed') === 'true' || isIframe) {
      const nav = document.querySelector('nav');
      if (nav) nav.style.display = 'none';

      const container = document.querySelector('.container-fluid');
      if (container) {
        container.classList.add('p-0');
      }

      // Mover o status dropdown e o timer para a sidebar ao lado do avatar do agente
      const statusDropdown = document.querySelector('nav .dropdown');
      const timerBadge = document.getElementById('pauseTimerBadge');
      const avatarEl = document.querySelector('#chatListSidebar .p-2 .bg-secondary');
      const headerSidebar = document.querySelector('#chatListSidebar .p-2');

      if (avatarEl && headerSidebar) {
        // Encontra ou cria o container flex da esquerda
        let leftContainer = document.getElementById('sidebarLeftControls');
        if (!leftContainer) {
          leftContainer = document.createElement('div');
          leftContainer.id = 'sidebarLeftControls';
          leftContainer.className = 'd-flex align-items-center gap-2';

          // Coloca o leftContainer no início do headerSidebar
          headerSidebar.insertBefore(leftContainer, headerSidebar.firstChild);

          // Move o avatar para dentro dele
          leftContainer.appendChild(avatarEl);

          // Move o status dropdown para dentro dele
          if (statusDropdown) {
            leftContainer.appendChild(statusDropdown);
            const btn = document.getElementById('agentStatusBtn');
            if (btn) {
              btn.classList.remove('btn-sm');
              btn.style.fontSize = '0.75rem';
              btn.style.padding = '0.15rem 0.35rem';
            }
          }

          // Move o timer badge para dentro dele
          if (timerBadge) {
            leftContainer.appendChild(timerBadge);
            timerBadge.style.fontSize = '0.7rem';
            timerBadge.style.padding = '0.15rem 0.35rem';
          }
        }
      }
    }

    if (user && user.role === 'AGENT') {
      const btnTabQueue = document.getElementById('btnTabQueue');
      if (btnTabQueue) {
        const parent = btnTabQueue.parentNode;
        const indicator = document.createElement('div');
        indicator.className = 'btn btn-outline-secondary btn-sm flex-grow-1 position-relative disabled';
        indicator.style.pointerEvents = 'none';
        indicator.innerHTML = 'Fila <span class="badge bg-danger rounded-pill ms-1" id="queueCount">0</span>';
        parent.replaceChild(indicator, btnTabQueue);
      }
      currentListMode = 'my';
    }

    fetchAgentStatus();
    loadChats();

    setInterval(() => loadChats(currentListMode), 5000);
    setInterval(refreshActiveChat, 3000);

    document.body.style.display = '';
  }

  // Lógica de Autenticação Híbrida Segura em Iframe (window.name)
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
          window.location.href = '/login.html';
          return;
        }
        // Limpa o token do window.name imediatamente após validação bem-sucedida por segurança
        window.name = '';
        const user = await resMe.json();
        await startApp(user);
      } catch (err) {
        console.error('[Broker] Iframe auth check failed:', err);
        window.name = '';
        window.location.href = '/login.html';
      }
    } else {
      // Sem token em window.name (ex: F5) -> redireciona para login no iframe
      window.location.href = '/login.html';
    }
  } else {
    // Modo tradicional seguro via Cookies HttpOnly (Aba normal)
    try {
      const resMe = await fetch('/api/auth/me');
      if (!resMe.ok) {
        window.location.href = '/login.html';
        return;
      }
      const user = await resMe.json();
      await startApp(user);
    } catch (err) {
      console.error('Agent session validation failed:', err);
      window.location.href = '/login.html';
    }
  }
});

function checkAuth() {
  return window.currentUser || null;
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

function getAuthHeaders(extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  const token = getAgentToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function getRequestHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const token = getAgentToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

window.logout = () => {
  // Verificar se há chats ativos renderizados no painel do agente
  const activeChatItems = document.querySelectorAll('#chatList .chat-item');
  if (activeChatItems.length > 0) {
    Swal.fire({
      icon: 'warning',
      title: 'Atendimentos em andamento',
      text: 'Você possui conversas ativas. Solicite a saída na barra superior de status. O sistema o deslogará automaticamente assim que fechar todos os chats.',
      confirmButtonText: 'Entendido'
    });
    return;
  }

  if (activeConversationId && socket) {
    socket.emit('leave_conversation', activeConversationId);
  }

  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
};

window.loadChats = async (mode = currentListMode) => {
  const user = checkAuth();
  if (user && user.role === 'AGENT') {
    mode = 'my';
  }
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
    if (isActive) {
      chat.unread = 0;
    }
    const item = document.createElement('div');

    item.className = `p-3 border-bottom chat-item ${isActive ? 'active' : ''}`;
    item.style.cursor = 'pointer';
    item.dataset.phone = chat.phone;
    item.onclick = () => selectChat(chat.phone);

    let timeStr = '';
    if (chat.timestamp) {
      timeStr = new Date(chat.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    const lastMsg = chat.lastMessage || 'Nova conversa';

    let channelIcon = '<i class="bi bi-whatsapp text-success me-1"></i>';
    if (chat.channel === 'TELEGRAM' || (chat.phone && chat.phone.startsWith('tg_'))) {
      channelIcon = '<i class="bi bi-telegram text-info me-1" title="Telegram"></i>';
    } else if (chat.channel === 'WEBCHAT' || (chat.phone && chat.phone.startsWith('vst_'))) {
      channelIcon = '<i class="bi bi-laptop text-primary me-1" title="Webchat"></i>';
    } else if (chat.channel === 'INSTAGRAM' || (chat.phone && chat.phone.startsWith('ig_'))) {
      channelIcon = '<i class="bi bi-instagram text-danger me-1" title="Instagram"></i>';
    }

    item.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="fw-bold text-truncate text-dark d-flex align-items-center" style="max-width: 65%">
                  ${channelIcon}
                  <span class="text-truncate">${escapeHtml(chat.name || chat.phone)}</span>
                </span>
                <small class="text-muted" style="font-size: 0.75rem">${timeStr}</small>
            </div>
            <div class="d-flex justify-content-between align-items-center">
                <small class="text-secondary text-truncate" style="max-width: 80%; font-size: 0.85rem">
                    ${escapeHtml(lastMsg)}
                </small>
                ${!isActive && chat.unread > 0 ? `<span class="badge bg-success rounded-pill" style="font-size: 0.6rem">${chat.unread}</span>` : ''}
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
  activeChatOwnerId = null;
  document.getElementById('currentPhone').value = phone;

  // Zerar imediatamente badge visual de não lidas na lista
  const chatItem = document.querySelector(`.chat-item[data-phone="${phone}"]`);
  if (chatItem) {
    const badge = chatItem.querySelector('.badge.bg-success');
    if (badge) badge.remove();
  }

  const badgeEl = document.getElementById('currentChatConnectionBadge');
  if (badgeEl) {
    badgeEl.style.display = 'none';
  }

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

  // Primeiro faz o refresh do chat que zera o unreadCount no banco
  await refreshActiveChat();
  await loadConversationId(phone);
  // Depois recarrega a lista de chats com os contadores já zerados no banco
  loadChats();

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
      activeChatOwnerId = chat.assignedToId || null;

      const badgeEl = document.getElementById('currentChatConnectionBadge');
      if (badgeEl) {
        if (chat.channel === 'TELEGRAM' || phone.startsWith('tg_')) {
          badgeEl.innerHTML = '<i class="bi bi-telegram me-1"></i> Telegram';
          badgeEl.className = 'badge bg-info bg-opacity-10 text-info border border-info border-opacity-25 px-2 py-1';
        } else if (chat.channel === 'WEBCHAT' || phone.startsWith('vst_')) {
          badgeEl.innerHTML = '<i class="bi bi-laptop me-1"></i> Webchat';
          badgeEl.className = 'badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 px-2 py-1';
        } else {
          badgeEl.innerHTML = `<i class="bi bi-whatsapp me-1"></i> ${escapeHtml(chat.channelName || 'WhatsApp')}`;
          badgeEl.className = 'badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 px-2 py-1';
        }
        badgeEl.style.display = 'inline-block';
      }

      if (socket) {
        socket.emit('join_conversation', activeConversationId);
        console.log('Joined conversation room:', activeConversationId);
      }

      loadInternalNotes();
      refreshActiveChat(); // Forçar refresh para aplicar o bloqueio/desbloqueio do input area
    }
  } catch (e) {
    console.error('Erro ao buscar conversation ID:', e);
  }
}

window.refreshActiveChat = async () => {
  if (!activeChatId) return;

  try {
    const res = await fetch(`${API_URL}/history/${activeChatId}`, { headers: getAuthHeaders() });
    if (!res.ok) {
      if (res.status === 403) {
        // Chat was transferred or unassigned! Block interaction immediately.
        activeChatOwnerId = null;
        check24HourWindow(allMessages);
      }
      return;
    }

    // Read owner header
    const ownerId = res.headers.get('X-Conversation-Owner-Id');
    if (ownerId !== null) {
      activeChatOwnerId = ownerId || null;
    }

    const messages = await res.json();

    if (JSON.stringify(messages) !== JSON.stringify(allMessages)) {
      allMessages = messages;
      renderMessages(messages);
    } else {
      check24HourWindow(messages);
    }
  } catch (e) {
    console.error('Sync Error', e);
  }
};

function renderMessages(messages) {
  const area = document.getElementById('messagesArea');
  if (!area) return;

  // Verificar a janela de 24h para envio de mensagens livres
  check24HourWindow(messages);

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
    // 🛡️ Renderização de Modo Sussurro (Nota Interna Privada)
    if (msg.contentType === 'whisper' || msg.isPrivate) {
      const divWhisper = document.createElement('div');
      divWhisper.className = 'w-100 my-2 px-2 d-flex justify-content-center';
      const time = new Date(msg.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
      const senderName = msg.senderName || msg.user?.name || 'Supervisor / Agente';
      const senderRole = msg.senderRole || msg.user?.role || 'SUPERVISOR';
      const roleBadge = senderRole === 'SUPERVISOR' ? 'bg-warning text-dark' : 'bg-secondary text-white';

      divWhisper.innerHTML = `
        <div class="card border-warning shadow-sm" style="background-color: #fff9e6; max-width: 90%; width: 100%; border-left: 4px solid #f59e0b !important; border-radius: 8px;">
          <div class="card-body py-2 px-3">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="small fw-bold text-dark d-flex align-items-center gap-1">
                <i class="bi bi-lock-fill text-warning"></i>
                <span>${escapeHtml(senderName)}</span>
                <span class="badge ${roleBadge} px-1 py-0 ms-1" style="font-size: 0.65rem;">${escapeHtml(senderRole)}</span>
              </span>
              <span class="text-muted" style="font-size: 0.7rem;">${time} • <strong class="text-warning-emphasis">Sussurro Interno</strong></span>
            </div>
            <div class="text-dark small mb-0" style="white-space: pre-wrap; font-size: 0.88rem;">${escapeHtml(msg.content)}</div>
          </div>
        </div>
      `;
      fragment.appendChild(divWhisper);
      return;
    }

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
        let displayedContent = msg.content;
        let interactiveButtons = [];
        if (msg.content && msg.content.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(msg.content);
            if (parsed.type === 'interactive' || parsed.interactive) {
              const interactiveObj = parsed.interactive || parsed;
              displayedContent = interactiveObj.body?.text || 'Opções interativas:';
              const btns = interactiveObj.action?.buttons || [];
              interactiveButtons = btns.map(b => b.reply?.title).filter(Boolean);
            }
          } catch (e) {
            // Mantém string crua se falhar
          }
        }

        let buttonsHtml = '';
        if (interactiveButtons.length > 0) {
          buttonsHtml = `<div class="d-flex flex-column gap-1 mt-2">` +
            interactiveButtons.map(title => `<span class="badge bg-light text-secondary border align-self-start small" style="font-size:0.75rem;">${escapeHtml(title)}</span>`).join('') +
            `</div>`;
        }

        contentHtml = `<div class="mb-2">${escapeHtml(displayedContent)}${buttonsHtml}</div>`;
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

window.appendWhisperToMessagesArea = function(msg) {
  const area = document.getElementById('messagesArea');
  if (!area) return;

  // 🛡️ Proteção contra sussurros duplicados
  if (msg.id) {
    const existingMsg = document.getElementById(`whisper_msg_${msg.id}`);
    if (existingMsg) return;
  }

  const divWhisper = document.createElement('div');
  if (msg.id) divWhisper.id = `whisper_msg_${msg.id}`;
  divWhisper.className = 'w-100 my-2 px-2 d-flex justify-content-center';
  const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
  const senderName = msg.senderName || 'Supervisor';
  const senderRole = msg.senderRole || 'SUPERVISOR';
  const roleBadge = senderRole === 'SUPERVISOR' ? 'bg-warning text-dark' : 'bg-secondary text-white';

  divWhisper.innerHTML = `
    <div class="card border-warning shadow-sm animate__animated animate__fadeIn" style="background-color: #fff9e6; max-width: 90%; width: 100%; border-left: 4px solid #f59e0b !important; border-radius: 8px;">
      <div class="card-body py-2 px-3">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span class="small fw-bold text-dark d-flex align-items-center gap-1">
            <i class="bi bi-lock-fill text-warning"></i>
            <span>${escapeHtml(senderName)}</span>
            <span class="badge ${roleBadge} px-1 py-0 ms-1" style="font-size: 0.65rem;">${escapeHtml(senderRole)}</span>
          </span>
          <span class="text-muted" style="font-size: 0.7rem;">${time} • <strong class="text-warning-emphasis">Sussurro do Supervisor</strong></span>
        </div>
        <div class="text-dark small mb-0" style="white-space: pre-wrap; font-size: 0.88rem;">${escapeHtml(msg.content)}</div>
      </div>
    </div>
  `;
  area.appendChild(divWhisper);
  area.scrollTop = area.scrollHeight;
};

window.handleSendMessage = async (e) => {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content || !activeChatId) return;

  input.value = '';
  input.focus();

  try {
    const payload = { content, type: 'text' };
    if (activeConversationId) {
      payload.conversationId = activeConversationId;
    }

    const res = await fetch(`${API_URL}/chats/${activeChatId}/send`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
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

window.closeChat = async () => {
  if (!activeChatId) return;

  const select = document.getElementById('closeDisposition');
  if (select) {
    try {
      const res = await fetch(`${API_URL}/dispositions`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const dispositions = data.dispositions || [];
        
        // Preserve current selection if still valid
        const currentValue = select.value;
        
        // Clear and rebuild options
        select.innerHTML = '<option value="" disabled>Selecione...</option>';
        dispositions.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.label;
          opt.textContent = d.label;
          select.appendChild(opt);
        });
        
        // Re-select previous value if still exists
        if (currentValue && dispositions.some(d => d.label === currentValue)) {
          select.value = currentValue;
        } else {
          select.value = "";
        }
      }
    } catch (err) {
      console.error('Erro ao carregar motivos de encerramento:', err);
    }
  }

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
    btn.classList.remove('btn-warning', 'btn-danger', 'btn-secondary', 'text-white');
    btn.classList.add('btn-light');
  } else if (status === 'offline') {
    btn.innerHTML = '🔴 Offline';
    btn.classList.remove('btn-warning', 'btn-light', 'btn-secondary');
    btn.classList.add('btn-danger', 'text-white');
  } else if (status === 'paused') {
    btn.innerHTML = `⏸️ ${reason || 'Pausa'}`;
    btn.classList.remove('btn-light', 'btn-danger', 'btn-secondary', 'text-white');
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
    if (activeConversationId) {
      formData.append('conversationId', activeConversationId);
    }

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
      headers: getRequestHeaders(),
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

  const socketOptions = {};
  if (inMemoryToken) {
    socketOptions.auth = { token: inMemoryToken };
  }
  socket = io('/', socketOptions);

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
    if (activeConversationId === data.conversationId) {
      activeChatOwnerId = data.agentId;
      refreshActiveChat();
    }
  });

  socket.on('agent_status_changed', (data) => {
    console.log('🔄 Agent status changed:', data);
  });

  socket.on('status_updated', (data) => {
    console.log('📊 Meu status atualizado:', data);
    updateStatusUI(data.status.toLowerCase(), data.reason);
    
    // Se o status virou OFFLINE (logout pendente concluído)
    if (data.status === 'OFFLINE') {
      console.log('🚪 Logout pendente concluído. Deslogando...');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login.html';
    }
  });

  socket.on('auto_transfer_notification', (data) => {
    console.log('🔄 Auto transfer:', data);
    const count = (data.transferred || 0) + (data.queued || 0);
    if (count > 0) {
      showNotification(
        data.message || `${count} conversa${count > 1 ? 's foram transferidas' : ' foi transferida'} devido à mudança de status`,
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
    // Se a conversa encerrada for a que está aberta, limpar a tela
    if (data.conversationId && data.conversationId === activeConversationId) {
      activeChatId = null;
      activeConversationId = null;
      activeChatOwnerId = null;
      document.body.classList.remove('chat-active');
      document.getElementById('messagesArea').innerHTML = `
        <div class="w-100 h-100 d-flex flex-column align-items-center justify-content-center text-muted">
          <i class="bi bi-check-circle display-4 text-success mb-3"></i>
          <p class="mb-0 fw-semibold">Atendimento encerrado</p>
          <small class="mt-1">${data.disposition === 'Enviado para Pesquisa'
            ? 'Pesquisa de satisfação enviada ao cliente.'
            : 'Conversa encerrada com sucesso.'}</small>
        </div>`;
      document.getElementById('inputArea').classList.add('d-none');
      document.getElementById('inputArea').classList.remove('d-flex');
      document.getElementById('currentChatTitle').innerText = '...';
      document.getElementById('currentChatSubtitle').innerText = 'Selecione uma conversa';
    }
    loadChats(currentListMode);
  });

  socket.on('whisper_message', (data) => {
    console.log('🔒 Sussurro em tempo real recebido:', data);
    if (activeConversationId === data.conversationId || activeChatId === data.phone) {
      window.appendWhisperToMessagesArea(data);
    }
  });

  socket.on('internal-note', (data) => {
    console.log('📝 Nova nota interna:', data);
    if (activeConversationId === data.conversationId || currentConversationId === data.conversationId) {
      loadInternalNotes();
    }
  });

  socket.on('internal-note-deleted', (data) => {
    console.log('🗑️ Nota interna removida:', data);
    if (activeConversationId === data.conversationId || currentConversationId === data.conversationId) {
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
  try {
    const [summaryRes, sessionsRes] = await Promise.all([
      fetch(`${API_URL}/customer-history/contact/${phone}/summary`, {
        headers: getRequestHeaders()
      }),
      fetch(`${API_URL}/customer-history/contact/${phone}`, {
        headers: getRequestHeaders()
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
    console.log('[History] Buscando:', `${API_URL}/customer-history/session/${sessionId}`);

    const response = await fetch(`${API_URL}/customer-history/session/${sessionId}`, {
      headers: getRequestHeaders()
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
    container.innerHTML = `<div class="alert alert-danger">Erro ao carregar mensagens: ${escapeHtml(error.message || 'Erro desconhecido')}</div>`;
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
      const bubbleClass = isInbound ? 'message-in' : 'message-out';

      return `
            <div class="d-flex justify-content-${alignment} mb-2 w-100">
                <div class="message-bubble ${bubbleClass} text-dark position-relative" style="min-width: 120px; max-width: 70%;">
                    <div class="small">${item.content || '(Mensagem sem conteúdo)'}</div>
                    <div class="text-muted mt-1" style="font-size: 0.7rem; text-align: right;">${time}</div>
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
  try {
    const response = await fetch(`${API_URL}/customer-history/session/${sessionId}?page=${page}`, {
      headers: getRequestHeaders()
    });

    if (!response.ok) throw new Error('Erro ao carregar mais mensagens');

    const data = await response.json();

    renderSessionMessages(data);
  } catch (error) {
    console.error('Erro ao carregar mais mensagens:', error);
    Swal.fire('Erro', 'Erro ao carregar mais mensagens', 'error');
  }
}

// ============================================================
// TEMPLATE MESSAGES (HSM) IMPLEMENTATION
// ============================================================
let STATE_TEMPLATES = [];
let SELECTED_TEMPLATE = null;

window.openTemplatesModal = async () => {
  const selectEl = document.getElementById('templateSelect');
  if (!selectEl) return;
  
  selectEl.innerHTML = '<option value="">Carregando modelos...</option>';
  
  // Hide preview and variables containers initially
  document.getElementById('templatePreviewContainer').classList.add('d-none');
  document.getElementById('templateParamsContainer').classList.add('d-none');
  
  try {
    const res = await fetch(`${API_URL}/templates`, {
      headers: getRequestHeaders()
    });
    
    if (!res.ok) throw new Error('Falha ao carregar modelos');
    
    STATE_TEMPLATES = await res.json();
    
    selectEl.innerHTML = '<option value="">Selecione um modelo...</option>';
    
    const modal = new bootstrap.Modal(document.getElementById('templatesModal'));
    modal.show();

    if (STATE_TEMPLATES.length === 0) {
      selectEl.innerHTML = '<option value="">Nenhum modelo sincronizado no banco</option>';
      return;
    }
    
    STATE_TEMPLATES.forEach(t => {
      const option = document.createElement('option');
      option.value = t.name;
      option.textContent = `${t.name} (${t.language})`;
      selectEl.appendChild(option);
    });
  } catch (err) {
    console.error(err);
    Swal.fire('Erro', 'Erro ao carregar os modelos de mensagens.', 'error');
  }
};

window.handleTemplateSelectChange = () => {
  const selectVal = document.getElementById('templateSelect').value;
  const previewContainer = document.getElementById('templatePreviewContainer');
  const paramsContainer = document.getElementById('templateParamsContainer');
  const previewEl = document.getElementById('templatePreview');
  const paramsList = document.getElementById('templateParamsList');
  
  if (!selectVal) {
    previewContainer.classList.add('d-none');
    paramsContainer.classList.add('d-none');
    return;
  }
  
  const template = STATE_TEMPLATES.find(t => t.name === selectVal);
  if (!template) return;
  
  SELECTED_TEMPLATE = template;
  
  // Find BODY component to show preview and find variables
  let components = template.components || [];
  if (typeof components === 'string') {
    try {
      components = JSON.parse(components);
    } catch (e) {
      components = [];
    }
  }
  if (components && !Array.isArray(components) && Array.isArray(components.components)) {
    components = components.components;
  }
  if (!Array.isArray(components)) {
    components = [];
  }
  const bodyComp = components.find(c => c.type === 'BODY');
  const bodyText = bodyComp ? bodyComp.text : '';
  
  previewEl.textContent = bodyText;
  previewContainer.classList.remove('d-none');
  
  // Find all placeholders like {{nome}}, {{1}}, etc.
  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  const variables = new Set();
  while ((match = regex.exec(bodyText)) !== null) {
    variables.add(match[1].trim());
  }
  
  const uniqueVars = Array.from(variables);
  const isAllNumeric = uniqueVars.every(v => /^\d+$/.test(v));
  if (isAllNumeric) {
    uniqueVars.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }
  
  paramsList.innerHTML = '';
  
  if (uniqueVars.length > 0) {
    uniqueVars.forEach(name => {
      const div = document.createElement('div');
      div.className = 'form-group';
      div.innerHTML = `
        <label class="small fw-semibold text-muted">Variável {{${name}}}</label>
        <input type="text" class="form-control form-control-sm template-var-input" data-var="${name}" placeholder="Valor para {{${name}}}" required />
      `;
      paramsList.appendChild(div);
    });
    paramsContainer.classList.remove('d-none');
  } else {
    paramsContainer.classList.add('d-none');
  }
};

window.submitSendTemplate = async () => {
  if (!SELECTED_TEMPLATE) return;
  
  if (!activeChatId) {
    Swal.fire('Aviso', 'Selecione uma conversa ativa antes de enviar o modelo.', 'warning');
    return;
  }
  
  // Collect variables
  const inputs = document.querySelectorAll('.template-var-input');
  const sortedInputs = Array.from(inputs);
  const isAllNumeric = sortedInputs.every(input => /^\d+$/.test(input.dataset.var));
  if (isAllNumeric) {
    sortedInputs.sort((a, b) => parseInt(a.dataset.var, 10) - parseInt(b.dataset.var, 10));
  }
  const parameters = [];
  
  // Validate that all variables have values
  let allFilled = true;
  sortedInputs.forEach(input => {
    const val = input.value.trim();
    if (!val) {
      allFilled = false;
      input.classList.add('is-invalid');
    } else {
      input.classList.remove('is-invalid');
      parameters.push({
        name: input.dataset.var,
        value: val
      });
    }
  });
  
  if (!allFilled) {
    Swal.fire('Aviso', 'Por favor, preencha todas as variáveis do modelo.', 'warning');
    return;
  }
  
  const payload = {
    type: 'template',
    templateName: SELECTED_TEMPLATE.name,
    language: SELECTED_TEMPLATE.language,
    parameters: parameters
  };
  if (activeConversationId) {
    payload.conversationId = activeConversationId;
  }
  
  const sendBtn = document.getElementById('sendTemplateBtn');
  if (sendBtn) sendBtn.disabled = true;
  
  try {
    const res = await fetch(`${API_URL}/chats/${activeChatId}/send`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Falha ao enviar modelo');
    }
    
    // Close modal
    const modalEl = document.getElementById('templatesModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    
    // Refresh messages
    await refreshActiveChat();
    loadChats();
    
    Swal.fire('Sucesso', 'Modelo enviado com sucesso!', 'success');
  } catch (err) {
    console.error(err);
    Swal.fire('Erro', `Erro ao enviar modelo: ${err.message}`, 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
};

// ============================================================
// NEW CHAT (OUTBOUND TEMPLATE MESSAGE)
// ============================================================
let NEW_CHAT_TEMPLATES = [];
let NEW_CHAT_SELECTED_TEMPLATE = null;

window.openNewChatModal = async () => {
  const selectEl = document.getElementById('newChatTemplateSelect');
  if (!selectEl) return;
  
  selectEl.innerHTML = '<option value="">Carregando modelos...</option>';
  
  // Reset inputs
  document.getElementById('newChatPhone').value = '';
  document.getElementById('newChatTemplatePreviewContainer').classList.add('d-none');
  document.getElementById('newChatTemplateParamsContainer').classList.add('d-none');
  
  // Populate connections dropdown
  const connSelectEl = document.getElementById('newChatConnectionSelect');
  if (connSelectEl) {
    connSelectEl.innerHTML = '<option value="">Carregando conexões...</option>';
  }

  try {
    // Fetch active connections
    const connRes = await fetch(`${API_URL}/chats/connections`, {
      headers: getRequestHeaders()
    });
    if (connRes.ok) {
      const connections = await connRes.json();
      if (connSelectEl) {
        if (connections.length === 0) {
          connSelectEl.innerHTML = '<option value="">Nenhuma conexão de WhatsApp cadastrada</option>';
        } else {
          connSelectEl.innerHTML = connections
            .map(c => `<option value="${c.phoneNumberId}">${c.name} (${c.phoneNumberId})</option>`)
            .join('');
        }
      }
    }
    
    // Fetch templates
    const res = await fetch(`${API_URL}/templates`, {
      headers: getRequestHeaders()
    });
    
    if (!res.ok) throw new Error('Falha ao carregar modelos');
    
    NEW_CHAT_TEMPLATES = await res.json();
    
    selectEl.innerHTML = '<option value="">Selecione um modelo...</option>';
    
    const modal = new bootstrap.Modal(document.getElementById('newChatModal'));
    modal.show();

    if (NEW_CHAT_TEMPLATES.length === 0) {
      selectEl.innerHTML = '<option value="">Nenhum modelo sincronizado. Vá em Configurações para sincronizar.</option>';
      return;
    }
    
    NEW_CHAT_TEMPLATES.forEach(t => {
      const option = document.createElement('option');
      option.value = t.name;
      option.textContent = `${t.name} (${t.language})`;
      selectEl.appendChild(option);
    });
  } catch (err) {
    console.error(err);
    Swal.fire('Erro', 'Erro ao carregar os modelos de mensagens.', 'error');
  }
};

window.handleNewChatTemplateSelectChange = () => {
  const selectVal = document.getElementById('newChatTemplateSelect').value;
  const previewContainer = document.getElementById('newChatTemplatePreviewContainer');
  const paramsContainer = document.getElementById('newChatTemplateParamsContainer');
  const previewEl = document.getElementById('newChatTemplatePreview');
  const paramsList = document.getElementById('newChatTemplateParamsList');
  
  if (!selectVal) {
    previewContainer.classList.add('d-none');
    paramsContainer.classList.add('d-none');
    return;
  }
  
  const template = NEW_CHAT_TEMPLATES.find(t => t.name === selectVal);
  if (!template) return;
  
  NEW_CHAT_SELECTED_TEMPLATE = template;
  
  // Find BODY component to show preview and find variables
  let components = template.components || [];
  if (typeof components === 'string') {
    try {
      components = JSON.parse(components);
    } catch (e) {
      components = [];
    }
  }
  if (components && !Array.isArray(components) && Array.isArray(components.components)) {
    components = components.components;
  }
  if (!Array.isArray(components)) {
    components = [];
  }
  const bodyComp = components.find(c => c.type === 'BODY');
  const bodyText = bodyComp ? bodyComp.text : '';
  
  previewEl.textContent = bodyText;
  previewContainer.classList.remove('d-none');
  
  // Find all placeholders like {{nome}}, {{1}}, etc.
  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  const variables = new Set();
  while ((match = regex.exec(bodyText)) !== null) {
    variables.add(match[1].trim());
  }
  
  const uniqueVars = Array.from(variables);
  const isAllNumeric = uniqueVars.every(v => /^\d+$/.test(v));
  if (isAllNumeric) {
    uniqueVars.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }
  
  paramsList.innerHTML = '';
  
  if (uniqueVars.length > 0) {
    uniqueVars.forEach(name => {
      const div = document.createElement('div');
      div.className = 'form-group';
      div.innerHTML = `
        <label class="small fw-semibold text-muted">Variável {{${name}}}</label>
        <input type="text" class="form-control form-control-sm new-chat-var-input" data-var="${name}" placeholder="Valor para {{${name}}}" required />
      `;
      paramsList.appendChild(div);
    });
    paramsContainer.classList.remove('d-none');
  } else {
    paramsContainer.classList.add('d-none');
  }
};

window.submitNewChat = async () => {
  const phoneInput = document.getElementById('newChatPhone');
  const phone = phoneInput.value.trim().replace(/\D/g, ''); // Apenas números
  
  if (!phone || phone.length < 10) {
    Swal.fire('Aviso', 'Por favor, insira um telefone válido com DDI e DDD (ex: 5541999999999).', 'warning');
    phoneInput.classList.add('is-invalid');
    return;
  } else {
    phoneInput.classList.remove('is-invalid');
  }

  const connSelectEl = document.getElementById('newChatConnectionSelect');
  const whatsappPhoneId = connSelectEl ? connSelectEl.value : null;
  if (!whatsappPhoneId) {
    Swal.fire('Aviso', 'Por favor, selecione uma conexão de WhatsApp.', 'warning');
    return;
  }
  
  if (!NEW_CHAT_SELECTED_TEMPLATE) {
    Swal.fire('Aviso', 'Selecione um modelo de mensagem.', 'warning');
    return;
  }
  
  // Collect variables
  const inputs = document.querySelectorAll('.new-chat-var-input');
  const sortedInputs = Array.from(inputs);
  const isAllNumeric = sortedInputs.every(input => /^\d+$/.test(input.dataset.var));
  if (isAllNumeric) {
    sortedInputs.sort((a, b) => parseInt(a.dataset.var, 10) - parseInt(b.dataset.var, 10));
  }
  const parameters = [];
  
  let allFilled = true;
  sortedInputs.forEach(input => {
    const val = input.value.trim();
    if (!val) {
      allFilled = false;
      input.classList.add('is-invalid');
    } else {
      input.classList.remove('is-invalid');
      parameters.push({
        name: input.dataset.var,
        value: val
      });
    }
  });
  
  if (!allFilled) {
    Swal.fire('Aviso', 'Por favor, preencha todas as variáveis do modelo.', 'warning');
    return;
  }
  
  const payload = {
    type: 'template',
    templateName: NEW_CHAT_SELECTED_TEMPLATE.name,
    language: NEW_CHAT_SELECTED_TEMPLATE.language,
    parameters: parameters,
    whatsappPhoneId: whatsappPhoneId
  };
  
  const submitBtn = document.getElementById('submitNewChatBtn');
  if (submitBtn) submitBtn.disabled = true;
  
  try {
    const res = await fetch(`${API_URL}/chats/${phone}/send`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Falha ao iniciar conversa');
    }
    
    // Close modal
    const modalEl = document.getElementById('newChatModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    
    // Load chats, active the newly created conversation
    loadChats();
    await window.selectChat(phone);
    
    Swal.fire('Sucesso', 'Conversa iniciada com sucesso!', 'success');
  } catch (err) {
    console.error(err);
    Swal.fire('Erro', `Erro ao iniciar conversa: ${err.message}`, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
};

// Verificar e fazer valer a janela de 24 horas da Meta para mensagens livres
function check24HourWindow(messages) {
  const chatInput = document.getElementById('chatInput');
  const mediaBtn = document.querySelector('button[title="Enviar Mídia"]');
  const quickRepliesBtn = document.querySelector('button[title="Respostas Rápidas"]');
  const sendBtn = document.querySelector('button[type="submit"]');

  if (!chatInput) return;

  const user = checkAuth();
  if (user && user.role === 'AGENT') {
    if (activeChatOwnerId !== user.id) {
      disableFreeFormChat("Conversa na fila ou com outro agente. Aguarde atribuição.");
      return;
    }
  }

  const inboundMessages = (messages || []).filter(m => m.direction === 'INBOUND');

  if (inboundMessages.length === 0) {
    disableFreeFormChat("Aguardando resposta do cliente para iniciar chat livre...");
    return;
  }

  const lastInbound = inboundMessages[inboundMessages.length - 1];
  const lastInboundTime = new Date(lastInbound.createdAt).getTime();
  const now = new Date().getTime();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  if (now - lastInboundTime > twentyFourHoursMs) {
    disableFreeFormChat("Janela de 24h fechada. Envie um Modelo de Mensagem.");
  } else {
    enableFreeFormChat();
  }

  function disableFreeFormChat(placeholderText) {
    chatInput.disabled = true;
    chatInput.value = '';
    chatInput.placeholder = placeholderText;
    if (mediaBtn) {
      mediaBtn.style.pointerEvents = 'none';
      mediaBtn.style.opacity = '0.4';
    }
    if (quickRepliesBtn) {
      quickRepliesBtn.style.pointerEvents = 'none';
      quickRepliesBtn.style.opacity = '0.4';
    }
    if (sendBtn) {
      sendBtn.style.pointerEvents = 'none';
      sendBtn.style.opacity = '0.4';
    }
  }

  function enableFreeFormChat() {
    chatInput.disabled = false;
    chatInput.placeholder = "Mensagem ou /comando";
    if (mediaBtn) {
      mediaBtn.style.pointerEvents = 'auto';
      mediaBtn.style.opacity = '1';
    }
    if (quickRepliesBtn) {
      quickRepliesBtn.style.pointerEvents = 'auto';
      quickRepliesBtn.style.opacity = '1';
    }
    if (sendBtn) {
      sendBtn.style.pointerEvents = 'auto';
      sendBtn.style.opacity = '1';
    }
  }
}

