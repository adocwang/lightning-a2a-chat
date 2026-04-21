'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const z = require('zod/v4');

const { ChatStore, DEFAULT_LIMIT, MAX_CONTENT_LENGTH } = require('./chat-store.js');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '3322', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const PUBLIC_DIR = path.join(process.cwd(), 'public');

const store = new ChatStore(DATA_DIR);
const app = createMcpExpressApp({ host: HOST });
const transports = {};

function buildServer() {
  const server = new McpServer(
    {
      name: 'lightning-a2a-chat',
      version: '1.0.0'
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  server.registerTool(
    'create_channel',
    {
      title: 'Create Channel',
      description: 'Create a unique point-to-point chat channel. Parameters: channelName = pipe name, creatorName = creator role name, peerName = the other side role name.',
      inputSchema: {
        channelName: z.string().min(1).describe('channelName: unique pipe name.'),
        creatorName: z.string().min(1).describe('creatorName: the role name creating this channel.'),
        peerName: z.string().min(1).describe('peerName: the role name on the other side of this channel.')
      }
    },
    async ({ channelName, creatorName, peerName }) => {
      try {
        const result = await store.createChannel({ channelName, creatorName, peerName });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'send_message',
    {
      title: 'Send Message',
      description: 'Append a text message to an existing channel.',
      inputSchema: {
        channelName: z.string().min(1).describe('Channel to send into.'),
        sender: z.string().min(1).describe('Participant name sending the message.'),
        content: z
          .string()
          .min(1)
          .max(MAX_CONTENT_LENGTH)
          .describe('Plain text message content.')
      }
    },
    async ({ channelName, sender, content }) => {
      try {
        const message = await store.sendMessage({ channelName, sender, content });
        return jsonResult(message);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'get_messages',
    {
      title: 'Get Messages',
      description: 'Fetch recent or incremental messages from a channel.',
      inputSchema: {
        channelName: z.string().min(1).describe('Channel to read from.'),
        limit: z
          .union([z.literal('all'), z.number().int().positive()])
          .optional()
          .describe(`Number of messages to return. Defaults to ${DEFAULT_LIMIT}. Use "all" for full history.`),
        sinceMessageId: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('If provided, only messages after this message ID are returned.')
      }
    },
    async ({ channelName, limit, sinceMessageId }) => {
      try {
        const result = await store.getMessages({ channelName, limit, sinceMessageId });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'get_channel',
    {
      title: 'Get Channel',
      description: 'Return channel metadata and message statistics.',
      inputSchema: {
        channelName: z.string().min(1).describe('Channel name.')
      }
    },
    async ({ channelName }) => {
      try {
        const channel = await store.getChannel(channelName);
        return jsonResult(channel);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'list_channels',
    {
      title: 'List Channels',
      description: 'List all configured channels.',
      inputSchema: {}
    },
    async () => {
      try {
        const channels = await store.listChannels();
        return jsonResult({
          count: channels.length,
          channels
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'delete_channel',
    {
      title: 'Delete Channel',
      description: 'Delete a channel and all of its stored messages.',
      inputSchema: {
        channelName: z.string().min(1).describe('Channel name to delete.')
      }
    },
    async ({ channelName }) => {
      try {
        const result = await store.deleteChannel(channelName);
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}

function jsonResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function errorResult(error) {
  return {
    content: [
      {
        type: 'text',
        text: `Error: ${error.message}`
      }
    ],
    isError: true
  };
}

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let transport = sessionId ? transports[sessionId] : undefined;

    if (!transport && !isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid MCP session ID provided.'
        },
        id: null
      });
      return;
    }

    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (createdSessionId) => {
          transports[createdSessionId] = transport;
        }
      });

      const server = buildServer();
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Failed to handle MCP request:', error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error'
        },
        id: null
      });
    }
  }
});

app.get('/mcp', async (_req, res) => {
  res.status(405).set('Allow', 'POST').send('Method Not Allowed');
});

app.delete('/mcp', async (_req, res) => {
  res.status(405).set('Allow', 'POST').send('Method Not Allowed');
});

app.use('/ui', express.static(PUBLIC_DIR));

app.get('/', (_req, res) => {
  res.redirect('/ui/');
});

app.get('/api/channels', async (_req, res) => {
  try {
    const channels = await store.listChannels();
    const withStats = await Promise.all(
      channels.map(async (channel) => store.getChannel(channel.channelName))
    );

    res.json({
      count: withStats.length,
      channels: withStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/channels/:channelName', async (req, res) => {
  try {
    const channel = await store.getChannel(req.params.channelName);
    const messages = await store.getMessages({
      channelName: req.params.channelName,
      limit: 'all'
    });

    res.json({
      channel,
      messages: messages.messages
    });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.delete('/api/channels/:channelName', async (req, res) => {
  try {
    const result = await store.deleteChannel(req.params.channelName);
    res.json(result);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

async function main() {
  await store.init();

  app.listen(PORT, HOST, (error) => {
    if (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }

    console.log(`Lightning A2A Chat UI: http://${HOST}:${PORT}/ui/`);
    console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
    console.log(`Data directory: ${DATA_DIR}`);
  });
}

main().catch((error) => {
  console.error('Failed to initialize server:', error);
  process.exit(1);
});
