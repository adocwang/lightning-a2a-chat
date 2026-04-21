'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { ChatStore } = require('../src/chat-store.js');

async function createTempStore() {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-hole-test-'));
  const store = new ChatStore(baseDir);
  await store.init();
  return { baseDir, store };
}

test('ChatStore creates channels, stores messages, and reports stats', async () => {
  const { baseDir, store } = await createTempStore();

  try {
    const created = await store.createChannel({
      channelName: 'release-check',
      creatorName: 'frontend',
      peerName: 'backend'
    });

    assert.equal(created.created, true);
    assert.equal(created.channel.channelName, 'release-check');

    const first = await store.sendMessage({
      channelName: 'release-check',
      sender: 'frontend',
      content: 'hello'
    });

    const second = await store.sendMessage({
      channelName: 'release-check',
      sender: 'backend',
      content: 'world'
    });

    assert.equal(first.id, 1);
    assert.equal(second.id, 2);

    const recent = await store.getMessages({ channelName: 'release-check' });
    assert.equal(recent.returnedCount, 2);
    assert.equal(recent.latestMessageId, 2);

    const channel = await store.getChannel('release-check');
    assert.equal(channel.messageCount, 2);
    assert.equal(channel.latestMessageId, 2);

    const deleted = await store.deleteChannel('release-check');
    assert.deepEqual(deleted, {
      deleted: true,
      channelName: 'release-check'
    });
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
});

test('ChatStore rejects senders outside the channel', async () => {
  const { baseDir, store } = await createTempStore();

  try {
    await store.createChannel({
      channelName: 'release-check',
      creatorName: 'frontend',
      peerName: 'backend'
    });

    await assert.rejects(
      () => store.sendMessage({
        channelName: 'release-check',
        sender: 'intruder',
        content: 'hello'
      }),
      /not part of channel/
    );
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
});
