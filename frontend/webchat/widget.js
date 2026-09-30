/**
 * widget.js - Widget de Webchat do Broker
 * Código independente de integração para sites.
 */

(function () {
  // 1. Obter parâmetros da tag script
  const scriptTag = document.currentScript;
  const token = scriptTag.getAttribute('data-token');
  const themeColor = scriptTag.getAttribute('data-color') || '#01745E';
  
  if (!token) {
    console.error('[Broker Webchat] Token de conexão ausente.');
    return;
  }

  const serverUrl = new URL(scriptTag.src).origin;

  // 2. Gerar ou obter o visitorId do visitante (persistido no localStorage)
  let visitorId = localStorage.getItem('broker_webchat_visitor_id');
  if (!visitorId) {
    visitorId = 'vst_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('broker_webchat_visitor_id', visitorId);
  }

  // 3. Injetar Estilos CSS do Chat de forma auto-contida
  const style = document.createElement('style');
  style.textContent = `
    .broker-webchat-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    
    .broker-webchat-bubble {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: ${themeColor};
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    
    .broker-webchat-bubble:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
    }
    
    .broker-webchat-bubble svg {
      width: 28px;
      height: 28px;
      fill: #ffffff;
      transition: transform 0.3s ease;
    }
    
    .broker-webchat-bubble.active svg {
      transform: rotate(90deg) scale(0.9);
    }

    .broker-webchat-window {
      position: absolute;
      bottom: 75px;
      right: 0;
      width: 370px;
      height: 530px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
      display: none;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      transition: all 0.2s ease-in-out;
      transform: translateY(20px);
      opacity: 0;
    }

    .broker-webchat-window.active {
      display: flex;
      transform: translateY(0);
      opacity: 1;
    }

    .broker-webchat-header {
      background: linear-gradient(135deg, ${themeColor} 0%, #029e82 100%);
      color: #ffffff;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(0,0,0,0.05);
    }

    .broker-webchat-header-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .broker-webchat-header-avatar {
      width: 32px;
      height: 32px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 0.9rem;
    }

    .broker-webchat-header-title {
      font-size: 0.95rem;
      font-weight: 600;
    }

    .broker-webchat-header-subtitle {
      font-size: 0.72rem;
      opacity: 0.85;
    }

    .broker-webchat-header-close {
      background: none;
      border: none;
      color: #ffffff;
      cursor: pointer;
      font-size: 1.2rem;
      opacity: 0.8;
      transition: opacity 0.15s;
      padding: 0;
      display: flex;
    }

    .broker-webchat-header-close:hover {
      opacity: 1;
    }

    .broker-webchat-messages {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
      background: #f8fafc;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .broker-webchat-msg {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 0.85rem;
      line-height: 1.4;
      word-wrap: break-word;
    }

    .broker-webchat-msg-inbound {
      background: ${themeColor};
      color: #ffffff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
      box-shadow: 0 1px 3px rgba(1, 116, 94, 0.15);
    }

    .broker-webchat-msg-outbound {
      background: #ffffff;
      color: #1e293b;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    }

    .broker-webchat-footer {
      padding: 14px 16px;
      background: #ffffff;
      border-top: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .broker-webchat-input {
      flex: 1;
      border: 1px solid #cbd5e1;
      border-radius: 20px;
      padding: 8px 16px;
      font-size: 0.85rem;
      outline: none;
      transition: border-color 0.15s;
    }

    .broker-webchat-input:focus {
      border-color: ${themeColor};
    }

    .broker-webchat-send {
      background: ${themeColor};
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #ffffff;
      transition: opacity 0.15s;
    }

    .broker-webchat-send:hover {
      opacity: 0.9;
    }

    .broker-webchat-send svg {
      width: 16px;
      height: 16px;
      fill: #ffffff;
    }

    /* Estilização Scrollbar */
    .broker-webchat-messages::-webkit-scrollbar {
      width: 4px;
    }
    .broker-webchat-messages::-webkit-scrollbar-track {
      background: transparent;
    }
    .broker-webchat-messages::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 2px;
    }
  `;
  document.head.appendChild(style);

  // 4. Montar a árvore HTML do widget
  const container = document.createElement('div');
  container.className = 'broker-webchat-container';
  container.innerHTML = `
    <div class="broker-webchat-window" id="brokerWebchatWindow">
      <div class="broker-webchat-header">
        <div class="broker-webchat-header-info">
          <div class="broker-webchat-header-avatar">🤖</div>
          <div>
            <div class="broker-webchat-header-title" id="brokerWebchatTitle">Suporte Online</div>
            <div class="broker-webchat-header-subtitle">Chat de atendimento</div>
          </div>
        </div>
        <button class="broker-webchat-header-close" id="brokerWebchatClose">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="broker-webchat-messages" id="brokerWebchatMessages"></div>
      <div class="broker-webchat-footer">
        <input type="text" class="broker-webchat-input" id="brokerWebchatInput" placeholder="Digite sua mensagem..." autocomplete="off" />
        <button class="broker-webchat-send" id="brokerWebchatSend">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
    <div class="broker-webchat-bubble" id="brokerWebchatBubble">
      <svg id="brokerChatIcon" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>
      <svg id="brokerCloseIcon" viewBox="0 0 24 24" style="display:none;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </div>
  `;
  document.body.appendChild(container);

  // 5. Variáveis de estado e elementos da DOM do Widget
  const bubble = document.getElementById('brokerWebchatBubble');
  const chatWindow = document.getElementById('brokerWebchatWindow');
  const closeBtn = document.getElementById('brokerWebchatClose');
  const chatIcon = document.getElementById('brokerChatIcon');
  const closeIcon = document.getElementById('brokerCloseIcon');
  const inputEl = document.getElementById('brokerWebchatInput');
  const sendBtn = document.getElementById('brokerWebchatSend');
  const messagesContainer = document.getElementById('brokerWebchatMessages');

  let socket = null;
  let conversationId = null;

  // Toggle abrir/fechar janela
  bubble.onclick = () => {
    const isShowing = chatWindow.classList.toggle('active');
    bubble.classList.toggle('active');
    
    if (isShowing) {
      chatIcon.style.display = 'none';
      closeIcon.style.display = 'block';
      inputEl.focus();
      initSocket();
    } else {
      chatIcon.style.display = 'block';
      closeIcon.style.display = 'none';
    }
  };

  closeBtn.onclick = () => {
    chatWindow.classList.remove('active');
    bubble.classList.remove('active');
    chatIcon.style.display = 'block';
    closeIcon.style.display = 'none';
  };

  // Carregar Socket.IO dinamicamente via CDN
  function initSocket() {
    if (socket) return; // Já inicializado

    const script = document.createElement('script');
    script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
    script.onload = () => {
      socket = io(`${serverUrl}/webchat`, {
        auth: { token, visitorId },
        transports: ['websocket']
      });

      socket.on('connect', () => {
        // Enviar evento de join_chat
        socket.emit('join_chat', (res) => {
          if (res.success) {
            conversationId = res.conversationId;
            messagesContainer.innerHTML = '';
            
            // Popular mensagens anteriores se houver
            if (res.messages && res.messages.length > 0) {
              res.messages.forEach(m => appendMessage(m.content, m.direction));
            }
          } else {
            console.error('[Broker Webchat] Erro ao registrar chat:', res.error);
            appendMessage('Erro ao conectar ao chat de suporte.', 'OUTBOUND');
          }
        });
      });

      socket.on('message_received', (data) => {
        appendMessage(data.content, data.direction);
      });

      socket.on('connect_error', (err) => {
        console.error('[Broker Webchat] Erro de conexão:', err.message);
      });
    };
    document.head.appendChild(script);
  }

  // Renderizar balão de mensagem na tela
  function appendMessage(content, direction) {
    const msgEl = document.createElement('div');
    const dirClass = direction === 'INBOUND' ? 'broker-webchat-msg-inbound' : 'broker-webchat-msg-outbound';
    msgEl.className = `broker-webchat-msg ${dirClass}`;

    let isInteractive = false;
    let interactiveObj = null;

    if (typeof content === 'object' && content !== null) {
      if (content.type === 'interactive' || content.interactive) {
        isInteractive = true;
        interactiveObj = content.interactive || content;
      } else {
        msgEl.textContent = JSON.stringify(content);
      }
    } else {
      // Caso venha serializado em JSON
      if (typeof content === 'string' && content.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.type === 'interactive' || parsed.interactive) {
            isInteractive = true;
            interactiveObj = parsed.interactive || parsed;
          } else {
            msgEl.textContent = content;
          }
        } catch (e) {
          msgEl.textContent = content;
        }
      } else {
        msgEl.textContent = content;
      }
    }

    if (isInteractive && interactiveObj) {
      // 1. Extrair texto principal
      const bodyText = interactiveObj.body?.text || 'Selecione uma opção:';
      msgEl.textContent = bodyText;

      // 2. Criar botões se houver
      const buttons = interactiveObj.action?.buttons || [];
      if (buttons.length > 0) {
        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.flexDirection = 'column';
        btnContainer.style.gap = '8px';
        btnContainer.style.marginTop = '10px';

        buttons.forEach(btn => {
          const reply = btn.reply;
          if (reply && reply.title) {
            const buttonEl = document.createElement('button');
            buttonEl.textContent = reply.title;
            
            // Estilo premium do botão
            buttonEl.style.background = '#ffffff';
            buttonEl.style.color = themeColor;
            buttonEl.style.border = `1px solid ${themeColor}`;
            buttonEl.style.borderRadius = '18px';
            buttonEl.style.padding = '6px 14px';
            buttonEl.style.fontSize = '0.82rem';
            buttonEl.style.fontWeight = '600';
            buttonEl.style.cursor = 'pointer';
            buttonEl.style.transition = 'all 0.2s';
            buttonEl.style.textAlign = 'center';
            buttonEl.style.width = '100%';

            buttonEl.onmouseover = () => {
              buttonEl.style.background = themeColor;
              buttonEl.style.color = '#ffffff';
            };
            buttonEl.onmouseout = () => {
              buttonEl.style.background = '#ffffff';
              buttonEl.style.color = themeColor;
            };

            buttonEl.onclick = () => {
              // Desativar botões
              btnContainer.querySelectorAll('button').forEach(b => {
                b.disabled = true;
                b.style.opacity = '0.5';
                b.style.cursor = 'not-allowed';
                b.onmouseover = null;
                b.onmouseout = null;
              });
              
              sendRawMessage(reply.title);
            };

            btnContainer.appendChild(buttonEl);
          }
        });
        msgEl.appendChild(btnContainer);
      }
    }

    messagesContainer.appendChild(msgEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Enviar texto cru via Socket
  function sendRawMessage(text) {
    if (!text || !socket || !conversationId) return;

    // Renderizar mensagem imediatamente (Optimistic UI) para preservar ordem cronológica
    appendMessage(text, 'INBOUND');

    socket.emit('send_message', { conversationId, text }, (res) => {
      if (!res.success) {
        console.error('[Broker Webchat] Erro ao enviar opção interativa:', res.error);
      }
    });
  }

  // Enviar mensagem via input
  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || !socket || !conversationId) return;

    // Renderizar mensagem imediatamente (Optimistic UI) e limpar input
    appendMessage(text, 'INBOUND');
    inputEl.value = '';

    // Emitir no WebSocket do Webchat
    socket.emit('send_message', { conversationId, text }, (res) => {
      if (!res.success) {
        console.error('[Broker Webchat] Erro ao enviar:', res.error);
      }
    });
  }

  // Eventos de teclado/botão de enviar
  sendBtn.onclick = sendMessage;
  inputEl.onkeydown = (e) => {
    if (e.key === 'Enter') sendMessage();
  };
})();
