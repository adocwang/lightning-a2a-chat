# Lightning A2A Chat

本地运行的 HTTP MCP server，用来给两个 Agent 建立点对点聊天管道。  
面向可信本地环境，默认不做鉴权、不做群聊，目标是提供一个足够轻、足够直接的 agent-to-agent 通讯层。

## 特性

- HTTP MCP endpoint，适合本地 MCP client 直接接入
- 点对点频道模型，避免多人会话复杂度
- JSON + JSONL 持久化，数据结构简单、可读、可迁移
- 自带一个轻量 Web UI，方便查看频道和消息
- 默认只监听 `127.0.0.1`

## 仓库内容

- `src/`：服务端逻辑和聊天存储实现
- `public/`：内置管理页面
- `docs/`：接入说明
- `data/`：运行时数据目录，不应提交到 GitHub

## 功能

- `create_channel`：创建唯一命名的聊天管道
- `send_message`：向管道发送消息
- `get_messages`：拉取最近消息或增量消息
- `get_channel`：查看单个管道信息
- `list_channels`：列出全部管道
- `delete_channel`：删除管道和全部消息

消息存储方式：

- `data/channels.json`：管道元信息
- `data/messages/<safe-name>.jsonl`：每个管道一个 JSONL 消息文件

## 环境要求

- Node.js 20+
- npm 10+

## 安装

```bash
npm install
```

也可以先复制环境变量模板：

```bash
cp .env.example .env
```

## 启动

默认只监听本机 `127.0.0.1:3322`：

```bash
npm start
```

开发模式：

```bash
npm run dev
```

自定义端口：

```bash
PORT=4000 npm start
```

自定义数据目录：

```bash
DATA_DIR=/absolute/path/to/data npm start
```

也支持自定义监听地址：

```bash
HOST=0.0.0.0 PORT=4000 npm start
```

启动后 MCP 地址：

```text
http://127.0.0.1:3322/mcp
```

管理页面地址：

```text
http://127.0.0.1:3322/ui/
```

直接在浏览器打开这个地址，就可以：

- 查看当前有哪些管道
- 查看每个管道里的全部消息
- 删除整个管道

## 开发与测试

开发模式：

```bash
npm run dev
```

运行测试：

```bash
npm test
```

## MCP 配置示例

这是远端 HTTP MCP server，不是 `stdio` 子进程模式。  
你的 Agent 端配置要指向本地这个 URL。

通用写法示例：

```json
{
  "mcpServers": {
    "lightning-a2a-chat": {
      "transport": "http",
      "url": "http://127.0.0.1:3322/mcp"
    }
  }
}
```

如果你的 Agent 客户端配置字段不是 `transport/url` 这组名字，就保留 URL 不变，把字段名按客户端要求替换掉即可。  
关键点只有一个：它要连的是 `http://127.0.0.1:3322/mcp`。

## 推荐调用流程

1. 先调用 `create_channel`
2. Agent 启动时调用一次 `get_messages`，读取最近 10 条上下文
3. 发送时调用 `send_message`
4. 轮询时调用 `get_messages(channelName, sinceMessageId=上次看到的 latestMessageId)`

推荐轮询间隔：5 到 10 秒。

## 工具说明

### 1. `create_channel`

输入：

```json
{
  "channelName": "Agent方案开发",
  "creatorName": "前端",
  "peerName": "后端"
}
```

返回示例：

```json
{
  "created": true,
  "channel": {
    "channelName": "Agent方案开发",
    "creatorName": "前端",
    "peerName": "后端",
    "fileKey": "4167656e74e696b9e6a188e5bc80e58f91",
    "createdAt": "2026-04-20T15:00:00.000Z"
  },
  "peerInviteText": "你是后端，前端已经创建了一个名字叫「Agent方案开发」的 Lightning A2A Chat 管道。请你连接到这个管道，在管道内和TA讨论并推进后续决定。"
}
```

### 2. `send_message`

输入：

```json
{
  "channelName": "Agent方案开发",
  "sender": "后端",
  "content": "我先把 API 字段定义出来，你接着做页面。"
}
```

返回示例：

```json
{
  "id": 1,
  "channelName": "Agent方案开发",
  "sender": "后端",
  "content": "我先把 API 字段定义出来，你接着做页面。",
  "createdAt": "2026-04-20T15:01:00.000Z"
}
```

### 3. `get_messages`

最近 10 条：

```json
{
  "channelName": "Agent方案开发"
}
```

读取全部：

```json
{
  "channelName": "Agent方案开发",
  "limit": "all"
}
```

增量读取：

```json
{
  "channelName": "Agent方案开发",
  "sinceMessageId": 12
}
```

返回示例：

```json
{
  "channelName": "Agent方案开发",
  "messages": [
    {
      "id": 13,
      "channelName": "Agent方案开发",
      "sender": "前端",
      "content": "页面结构已经搭起来了。",
      "createdAt": "2026-04-20T15:05:00.000Z"
    }
  ],
  "latestMessageId": 13,
  "returnedCount": 1,
  "totalMessages": 13
}
```

### 4. `get_channel`

输入：

```json
{
  "channelName": "Agent方案开发"
}
```

### 5. `list_channels`

输入：

```json
{}
```

### 6. `delete_channel`

输入：

```json
{
  "channelName": "Agent方案开发"
}
```

## 代码示例

下面给一个最小 Node.js 调用例子，方便你自己验证这个 MCP server 是否可用。这个例子直接发 MCP JSON-RPC 请求到本地 HTTP 地址。

```js
const endpoint = 'http://127.0.0.1:3322/mcp';

async function initialize() {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'local-test-client',
          version: '1.0.0'
        }
      }
    })
  });

  const sessionId = response.headers.get('mcp-session-id');
  const body = await response.json();
  return { sessionId, body };
}

async function callTool(sessionId, name, args, id) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    })
  });

  return response.json();
}

(async () => {
  const { sessionId } = await initialize();

  console.log(await callTool(sessionId, 'create_channel', {
    channelName: 'Agent方案开发',
    creatorName: '前端',
    peerName: '后端'
  }, 2));

  console.log(await callTool(sessionId, 'send_message', {
    channelName: 'Agent方案开发',
    sender: '后端',
    content: '先把 API 契约定下来。'
  }, 3));

  console.log(await callTool(sessionId, 'get_messages', {
    channelName: 'Agent方案开发',
    limit: 10
  }, 4));
})();
```

## 本地调试建议

- 第一个 Agent 固定身份，例如 `后端`
- 第二个 Agent 固定身份，例如 `前端`
- 共享同一个 `channelName`
- 首次进入会话时先拉最近消息
- 后续用 `sinceMessageId` 做增量轮询

## 限制

- 仅适合本地可信环境
- 不做用户身份校验
- 不做消息撤回、已读、群聊
- 单条消息内容限制为 20KB

## 发布到 GitHub 前后建议

- 提交前确认 `data/`、`.env`、`node_modules/` 没有被纳入版本控制
- 创建仓库后，把 `package.json` 里的 `author` 补成你的名字或组织
- 如果你准备公开暴露到非本机网络，先补鉴权和访问控制
- 如果你准备长期维护，建议在 GitHub 仓库里启用 Issues 和 Actions

## 开源协作文件

仓库已经包含这些基础文件：

- `.gitignore`
- `.editorconfig`
- `.gitattributes`
- `LICENSE`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `.github/workflows/ci.yml`
- GitHub issue / PR 模板

更详细的 Agent 接入方式见 [docs/agent-usage.md](docs/agent-usage.md)。
