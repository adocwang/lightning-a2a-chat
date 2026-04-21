const state = {
  channels: [],
  selectedChannelName: null
};

const channelListEl = document.querySelector('#channelList');
const channelCountEl = document.querySelector('#channelCount');
const refreshButtonEl = document.querySelector('#refreshButton');
const toggleConfigButtonEl = document.querySelector('#toggleConfigButton');
const copyConfigButtonEl = document.querySelector('#copyConfigButton');
const configBodyEl = document.querySelector('#configBody');
const configBlockEl = document.querySelector('#configBlock');
const emptyStateEl = document.querySelector('#emptyState');
const channelDetailEl = document.querySelector('#channelDetail');
const detailNameEl = document.querySelector('#detailName');
const detailMetaEl = document.querySelector('#detailMeta');
const messageCountEl = document.querySelector('#messageCount');
const messageListEl = document.querySelector('#messageList');
const creatorPromptBlockEl = document.querySelector('#creatorPromptBlock');
const peerPromptBlockEl = document.querySelector('#peerPromptBlock');
const copyCreatorPromptButtonEl = document.querySelector('#copyCreatorPromptButton');
const copyPeerPromptButtonEl = document.querySelector('#copyPeerPromptButton');
const refreshDetailButtonEl = document.querySelector('#refreshDetailButton');
const deleteButtonEl = document.querySelector('#deleteButton');

const configPayload = {
  mcpServers: {
    'lightning-a2a-chat': {
      transport: 'http',
      url: `${window.location.origin}/mcp`
    }
  }
};

configBlockEl.textContent = JSON.stringify(configPayload, null, 2);

refreshButtonEl.addEventListener('click', async () => {
  await loadChannels();
  await syncSelection();
});

toggleConfigButtonEl.addEventListener('click', () => {
  configBodyEl.classList.toggle('hidden');
  toggleConfigButtonEl.textContent = configBodyEl.classList.contains('hidden') ? '展开' : '收起';
});

copyConfigButtonEl.addEventListener('click', async () => {
  try {
    await copyText(JSON.stringify(configPayload, null, 2));
    flashTextButton(copyConfigButtonEl, '已复制');
  } catch (error) {
    window.alert(error.message || '复制失败');
  }
});

copyCreatorPromptButtonEl.addEventListener('click', async () => {
  if (!creatorPromptBlockEl.textContent.trim()) {
    return;
  }

  try {
    await copyText(creatorPromptBlockEl.textContent);
    flashTextButton(copyCreatorPromptButtonEl, '已复制');
  } catch (error) {
    window.alert(error.message || '复制失败');
  }
});

copyPeerPromptButtonEl.addEventListener('click', async () => {
  if (!peerPromptBlockEl.textContent.trim()) {
    return;
  }

  try {
    await copyText(peerPromptBlockEl.textContent);
    flashTextButton(copyPeerPromptButtonEl, '已复制');
  } catch (error) {
    window.alert(error.message || '复制失败');
  }
});

refreshDetailButtonEl.addEventListener('click', async () => {
  await refreshSelectedChannel({ scrollToBottomOnNewMessages: true, forceScroll: false });
});

deleteButtonEl.addEventListener('click', async () => {
  if (!state.selectedChannelName) {
    return;
  }

  const confirmed = window.confirm(`确定要删除管道“${state.selectedChannelName}”及其全部消息吗？`);
  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/channels/${encodeURIComponent(state.selectedChannelName)}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: '删除失败' }));
    window.alert(payload.error || '删除失败');
    return;
  }

  state.selectedChannelName = null;
  await loadChannels();
  renderDetail(null);
});

async function loadChannels() {
  const response = await fetch('/api/channels');
  const payload = await response.json();

  state.channels = payload.channels || [];
  renderChannelList();
}

async function syncSelection() {
  if (!state.selectedChannelName && state.channels.length > 0) {
    state.selectedChannelName = state.channels[0].channelName;
  }

  if (!state.selectedChannelName) {
    renderDetail(null);
    return;
  }

  const exists = state.channels.some((channel) => channel.channelName === state.selectedChannelName);
  if (!exists) {
    state.selectedChannelName = state.channels[0]?.channelName || null;
  }

  if (!state.selectedChannelName) {
    renderDetail(null);
    return;
  }

  await refreshSelectedChannel({ scrollToBottomOnNewMessages: false, forceScroll: true });
}

async function refreshSelectedChannel({ scrollToBottomOnNewMessages, forceScroll }) {
  if (!state.selectedChannelName) {
    renderDetail(null);
    return;
  }

  const previousMessages = messageListEl.querySelectorAll('.message').length;

  const response = await fetch(`/api/channels/${encodeURIComponent(state.selectedChannelName)}`);
  const payload = await response.json();

  if (!response.ok) {
    window.alert(payload.error || '读取管道失败');
    renderDetail(null);
    return;
  }

  renderDetail(payload);

  const hasNewMessages = payload.messages.length > previousMessages;
  if (forceScroll || (scrollToBottomOnNewMessages && hasNewMessages)) {
    messageListEl.scrollTop = messageListEl.scrollHeight;
  }
}

function renderChannelList() {
  channelCountEl.textContent = `${state.channels.length} 个管道`;

  if (state.channels.length === 0) {
    channelListEl.innerHTML = '<div class="empty-messages">还没有任何管道。</div>';
    return;
  }

  channelListEl.innerHTML = '';

  for (const channel of state.channels) {
    const card = document.createElement('div');
    card.className = `channel-card${channel.channelName === state.selectedChannelName ? ' active' : ''}`;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML = `
      <div class="channel-card-line">
        <div class="channel-card-title">${escapeHtml(channel.channelName)}</div>
        ${copyButtonMarkup('复制管道名', channel.channelName)}
      </div>
      <div class="channel-card-meta">
        <span class="channel-card-line">
          <span>创建者 ${escapeHtml(channel.creatorName)}</span>
          ${copyButtonMarkup('复制创建者', channel.creatorName)}
          <span>↔</span>
          <span>对端 ${escapeHtml(channel.peerName)}</span>
          ${copyButtonMarkup('复制对端', channel.peerName)}
        </span>
        <span class="channel-card-stats">${channel.messageCount} 条消息 · 最新 ID: ${channel.latestMessageId ?? '-'}</span>
      </div>
    `;

    const selectChannel = async (event) => {
      if (event.target.closest('.copy-chip')) {
        return;
      }

      state.selectedChannelName = channel.channelName;
      renderChannelList();
      await syncSelection();
    };

    card.addEventListener('click', selectChannel);
    card.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        await selectChannel(event);
      }
    });

    bindCopyButtons(card);
    channelListEl.appendChild(card);
  }
}

function renderDetail(payload) {
  if (!payload) {
    emptyStateEl.classList.remove('hidden');
    channelDetailEl.classList.add('hidden');
    creatorPromptBlockEl.textContent = '';
    peerPromptBlockEl.textContent = '';
    return;
  }

  const { channel, messages } = payload;

  emptyStateEl.classList.add('hidden');
  channelDetailEl.classList.remove('hidden');

  detailNameEl.textContent = channel.channelName;
  detailMetaEl.textContent =
    `创建者 ${channel.creatorName} ↔ 对端 ${channel.peerName} | 创建时间 ${formatTime(channel.createdAt)} | 最新消息 ${channel.latestMessageAt ? formatTime(channel.latestMessageAt) : '暂无'} | 推荐轮询 每 1 分钟`;
  messageCountEl.textContent = `${messages.length} 条消息`;
  creatorPromptBlockEl.textContent = channel.creatorPromptText || '';
  peerPromptBlockEl.textContent = channel.peerInviteText || '';

  if (messages.length === 0) {
    messageListEl.innerHTML = '<div class="empty-messages">这个管道还没有消息。</div>';
    return;
  }

  messageListEl.innerHTML = messages
    .map((message) => `
      <article class="message ${messageRoleClass(message.sender, channel)}">
        <div class="message-head">
          <span class="message-sender">${escapeHtml(message.sender)} #${message.id}</span>
          <span class="message-time">${formatTime(message.createdAt)}</span>
        </div>
        <div class="message-body">${escapeHtml(message.content)}</div>
      </article>
    `)
    .join('');
}

function messageRoleClass(sender, channel) {
  if (sender === channel.creatorName) {
    return 'role-a';
  }

  if (sender === channel.peerName) {
    return 'role-b';
  }

  return 'role-other';
}

function copyButtonMarkup(label, value) {
  return `
    <button
      class="copy-chip"
      type="button"
      title="${escapeHtml(label)}"
      aria-label="${escapeHtml(label)}"
      data-copy="${escapeHtml(value)}"
    >
      ${copyIconSvg()}
    </button>
  `;
}

function copyIconSvg() {
  return `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 9.75A2.25 2.25 0 0 1 11.25 7.5h7.5A2.25 2.25 0 0 1 21 9.75v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5A2.25 2.25 0 0 1 9 17.25v-7.5Z" stroke="currentColor" stroke-width="1.5"/>
      <path d="M15 7.5V6.75A2.25 2.25 0 0 0 12.75 4.5h-7.5A2.25 2.25 0 0 0 3 6.75v7.5A2.25 2.25 0 0 0 5.25 16.5H6" stroke="currentColor" stroke-width="1.5"/>
    </svg>
  `;
}

function bindCopyButtons(root) {
  const copyButtons = root.querySelectorAll('.copy-chip');

  for (const button of copyButtons) {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();

      try {
        await copyText(button.dataset.copy || '');
        flashIconButton(button);
      } catch (error) {
        window.alert(error.message || '复制失败');
      }
    });
  }
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function flashTextButton(button, text) {
  const original = button.textContent;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function flashIconButton(button) {
  const original = button.innerHTML;
  button.innerHTML = '<span aria-hidden="true">✓</span>';
  window.setTimeout(() => {
    button.innerHTML = original;
  }, 1000);
}

function formatTime(value) {
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

loadChannels()
  .then(syncSelection)
  .catch((error) => {
    window.alert(error.message || '页面初始化失败');
  });
