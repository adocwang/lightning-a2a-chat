'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_LIMIT = 10;
const MAX_CONTENT_LENGTH = 20 * 1024;
const SAFE_FILE_SUFFIX = '.jsonl';
const RECOMMENDED_POLL_MINUTES = 1;

class ChatStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.channelsFile = path.join(baseDir, 'channels.json');
    this.messagesDir = path.join(baseDir, 'messages');
    this.writeQueues = new Map();
  }

  async init() {
    await fs.mkdir(this.messagesDir, { recursive: true });

    try {
      await fs.access(this.channelsFile);
    } catch {
      await fs.writeFile(this.channelsFile, '[]\n', 'utf8');
    }
  }

  async createChannel({ channelName, creatorName, peerName }) {
    this.#validateChannelName(channelName);
    this.#validateParticipantName(creatorName, 'creatorName');
    this.#validateParticipantName(peerName, 'peerName');

    if (creatorName === peerName) {
      throw new Error('creatorName and peerName must be different.');
    }

    return this.#withChannelsLock(async () => {
      const channels = await this.#readChannels();
      const existing = channels.find((channel) => channel.channelName === channelName);

      if (existing) {
        return {
          created: false,
          channel: existing,
          creatorPromptText: this.#buildCreatorPromptText(existing),
          peerInviteText: this.#buildPeerInviteText(existing)
        };
      }

      const channel = {
        channelName,
        creatorName,
        peerName,
        fileKey: this.#encodeFileKey(channelName),
        createdAt: new Date().toISOString()
      };

      channels.push(channel);
      await this.#writeChannels(channels);
      await this.#ensureMessagesFile(channel.fileKey);

      return {
        created: true,
        channel,
        creatorPromptText: this.#buildCreatorPromptText(channel),
        peerInviteText: this.#buildPeerInviteText(channel)
      };
    });
  }

  async listChannels() {
    return this.#readChannels();
  }

  async getChannel(channelName) {
    this.#validateChannelName(channelName);
    const channels = await this.#readChannels();
    const channel = channels.find((entry) => entry.channelName === channelName);

    if (!channel) {
      throw new Error(`Channel "${channelName}" does not exist.`);
    }

    const stats = await this.#getMessageStats(channel);
    return {
      ...channel,
      ...stats,
      creatorPromptText: this.#buildCreatorPromptText(channel),
      peerInviteText: this.#buildPeerInviteText(channel)
    };
  }

  async deleteChannel(channelName) {
    this.#validateChannelName(channelName);

    return this.#withChannelsLock(async () => {
      const channels = await this.#readChannels();
      const index = channels.findIndex((entry) => entry.channelName === channelName);

      if (index === -1) {
        throw new Error(`Channel "${channelName}" does not exist.`);
      }

      const [channel] = channels.splice(index, 1);
      await this.#writeChannels(channels);

      try {
        await fs.unlink(this.#messagesPath(channel.fileKey));
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      return {
        deleted: true,
        channelName: channel.channelName
      };
    });
  }

  async sendMessage({ channelName, sender, content }) {
    this.#validateChannelName(channelName);
    this.#validateParticipantName(sender, 'sender');
    this.#validateMessageContent(content);

    const channel = await this.#requireChannel(channelName);
    const participants = [channel.creatorName, channel.peerName];

    if (!participants.includes(sender)) {
      throw new Error(`Sender "${sender}" is not part of channel "${channelName}".`);
    }

    return this.#queueWrite(this.#messagesPath(channel.fileKey), async () => {
      const nextId = (await this.#getLastMessageId(channel)) + 1;
      const message = {
        id: nextId,
        channelName,
        sender,
        content,
        createdAt: new Date().toISOString()
      };

      const line = `${JSON.stringify(message)}\n`;
      await fs.appendFile(this.#messagesPath(channel.fileKey), line, 'utf8');
      return message;
    });
  }

  async getMessages({ channelName, limit = DEFAULT_LIMIT, sinceMessageId }) {
    this.#validateChannelName(channelName);

    const channel = await this.#requireChannel(channelName);
    const messages = await this.#readMessages(channel);
    let filtered = messages;

    if (sinceMessageId !== undefined && sinceMessageId !== null) {
      const numericId = this.#parseMessageId(sinceMessageId, 'sinceMessageId');
      filtered = messages.filter((message) => message.id > numericId);
    }

    const resolvedLimit = this.#resolveLimit(limit);
    const resultMessages = resolvedLimit === 'all'
      ? filtered
      : filtered.slice(-resolvedLimit);

    return {
      channelName,
      messages: resultMessages,
      latestMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
      returnedCount: resultMessages.length,
      totalMessages: messages.length
    };
  }

  #messagesPath(fileKey) {
    return path.join(this.messagesDir, `${fileKey}${SAFE_FILE_SUFFIX}`);
  }

  async #readChannels() {
    const raw = await fs.readFile(this.channelsFile, 'utf8');
    const channels = JSON.parse(raw);
    return Array.isArray(channels) ? channels : [];
  }

  async #writeChannels(channels) {
    await fs.writeFile(this.channelsFile, `${JSON.stringify(channels, null, 2)}\n`, 'utf8');
  }

  async #ensureMessagesFile(fileKey) {
    const filePath = this.#messagesPath(fileKey);

    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, '', 'utf8');
    }
  }

  async #requireChannel(channelName) {
    const channels = await this.#readChannels();
    const channel = channels.find((entry) => entry.channelName === channelName);

    if (!channel) {
      throw new Error(`Channel "${channelName}" does not exist.`);
    }

    await this.#ensureMessagesFile(channel.fileKey);
    return channel;
  }

  async #readMessages(channel) {
    await this.#ensureMessagesFile(channel.fileKey);
    const raw = await fs.readFile(this.#messagesPath(channel.fileKey), 'utf8');

    if (!raw.trim()) {
      return [];
    }

    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .sort((left, right) => left.id - right.id);
  }

  async #getLastMessageId(channel) {
    const messages = await this.#readMessages(channel);
    return messages.length > 0 ? messages[messages.length - 1].id : 0;
  }

  async #getMessageStats(channel) {
    const messages = await this.#readMessages(channel);
    const latest = messages.length > 0 ? messages[messages.length - 1] : null;

    return {
      messageCount: messages.length,
      latestMessageId: latest ? latest.id : null,
      latestMessageAt: latest ? latest.createdAt : null
    };
  }

  async #withChannelsLock(work) {
    return this.#queueWrite(this.channelsFile, work);
  }

  async #queueWrite(key, work) {
    const previous = this.writeQueues.get(key) || Promise.resolve();
    const current = previous.then(work, work);
    const tracked = current.finally(() => {
      if (this.writeQueues.get(key) === tracked) {
        this.writeQueues.delete(key);
      }
    });

    // Track queue progress without surfacing an extra unhandled rejection path.
    this.writeQueues.set(key, tracked.catch(() => undefined));

    return current;
  }

  #resolveLimit(limit) {
    if (limit === undefined || limit === null) {
      return DEFAULT_LIMIT;
    }

    if (limit === 'all') {
      return 'all';
    }

    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
      throw new Error('limit must be a positive integer or "all".');
    }

    return limit;
  }

  #parseMessageId(value, fieldName) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(`${fieldName} must be a non-negative integer.`);
    }

    return value;
  }

  #validateChannelName(channelName) {
    if (typeof channelName !== 'string' || channelName.trim() === '') {
      throw new Error('channelName must be a non-empty string.');
    }
  }

  #validateParticipantName(value, fieldName) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${fieldName} must be a non-empty string.`);
    }
  }

  #validateMessageContent(content) {
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('content must be a non-empty string.');
    }

    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_LENGTH) {
      throw new Error(`content exceeds the ${MAX_CONTENT_LENGTH} byte limit.`);
    }
  }

  #encodeFileKey(channelName) {
    return Buffer.from(channelName, 'utf8').toString('hex');
  }

  #buildCreatorPromptText(channel) {
    return `你是${channel.creatorName}，你负责发起并推进一个 Lightning A2A Chat 点对点协作管道。当前 channelName 是「${channel.channelName}」，对端名字是「${channel.peerName}」。第一步调用 create_channel，参数使用 channelName="${channel.channelName}"、creatorName="${channel.creatorName}"、peerName="${channel.peerName}"。如果返回 created=false，就直接沿用现有管道。创建成功后，把返回里的 peerInviteText 原样转发给${channel.peerName}。${this.#buildPollingGuidance()}需要同步进展时调用 send_message，消息保持简短、明确、可执行。`;
  }

  #buildPeerInviteText(channel) {
    return `你是${channel.peerName}，${channel.creatorName}已经创建了一个名字叫「${channel.channelName}」的 Lightning A2A Chat 管道。请你连接到这个管道，并在管道内和${channel.creatorName}讨论、同步并推进后续决定。${this.#buildPollingGuidance()}需要同步进展时调用 send_message，消息保持简短、明确、可执行。`;
  }

  #buildPollingGuidance() {
    return `开始工作前先调用 get_messages 读取最近 10 条上下文并记住 latestMessageId；之后固定每 ${RECOMMENDED_POLL_MINUTES} 分钟调用一次 get_messages，并带上 sinceMessageId=上次看到的 latestMessageId 做增量轮询。推荐使用 ${RECOMMENDED_POLL_MINUTES} 分钟，是为了更容易直接挂到分钟级 cron / heartbeat。`;
  }
}

module.exports = {
  ChatStore,
  DEFAULT_LIMIT,
  MAX_CONTENT_LENGTH
};
