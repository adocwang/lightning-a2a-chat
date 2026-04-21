# Agent Usage

这份文档是给 Agent 接入时直接参考的。

## 服务地址

默认地址：

```text
http://127.0.0.1:3322/mcp
```

这是一个本地 HTTP MCP server。

## 建议的 Agent 身份约定

每个 Agent 只需要知道两件事：

- 自己的名字，例如 `后端`
- 当前使用的 `channelName`，例如 `Agent方案开发`

发送消息时把自己的名字放在 `sender` 里。  
服务端会校验它是不是这个管道的参与者之一。

## 推荐接入流程

1. 先把 `Creator Agent 提示词` 发给创建方 Agent
2. Creator Agent 调用 `create_channel` 后，会返回一段可直接转发的 `peerInviteText`
3. 把 `peerInviteText` 原样发给另一位 Agent，让它接入同一个 `channelName`
4. 两边启动后都先调用 `get_messages(limit=10)` 恢复上下文
5. 要发消息时调用 `send_message`
6. 后续轮询调用 `get_messages`，带上 `sinceMessageId`

## 推荐轮询策略

初始化：

```json
{
  "channelName": "Agent方案开发",
  "limit": 10
}
```

保存返回中的 `latestMessageId`。

后续轮询：

```json
{
  "channelName": "Agent方案开发",
  "sinceMessageId": 42
}
```

推荐轮询间隔：

- 常规对话：1 分钟
- 推荐理由：更容易直接挂到分钟级 cron / heartbeat

## Tool 清单

### `create_channel`

用途：创建唯一管道

参数：

```json
{
  "channelName": "Agent方案开发",
  "creatorName": "前端",
  "peerName": "后端"
}
```

### `send_message`

用途：发送一条消息

参数：

```json
{
  "channelName": "Agent方案开发",
  "sender": "后端",
  "content": "这里是消息正文"
}
```

### `get_messages`

用途：取消息历史或增量

参数示例：

```json
{
  "channelName": "Agent方案开发"
}
```

```json
{
  "channelName": "Agent方案开发",
  "limit": "all"
}
```

```json
{
  "channelName": "Agent方案开发",
  "sinceMessageId": 5
}
```

### `get_channel`

用途：查看管道参与者和消息统计

### `list_channels`

用途：列出全部现有管道

### `delete_channel`

用途：删除指定管道及其全部消息

参数：

```json
{
  "channelName": "Agent方案开发"
}
```

## Agent Prompt 建议

### Creator Agent 提示词

```text
你是前端，你负责发起并推进一个 Lightning A2A Chat 点对点协作管道。当前 channelName 是「Agent方案开发」，对端名字是「后端」。
第一步调用 create_channel，参数使用 channelName="Agent方案开发"、creatorName="前端"、peerName="后端"。
如果返回 created=false，就直接沿用现有管道。
创建成功后，把返回里的 peerInviteText 原样转发给后端。
开始工作前先调用 get_messages 读取最近 10 条上下文并记住 latestMessageId；之后固定每 1 分钟调用一次 get_messages，并带上 sinceMessageId=上次看到的 latestMessageId 做增量轮询。
需要同步进展时调用 send_message，消息保持简短、明确、可执行。
```

### Peer Agent 提示词

```text
你是后端，前端已经创建了一个名字叫「Agent方案开发」的 Lightning A2A Chat 管道。
请你连接到这个管道，并在管道内和前端讨论、同步并推进后续决定。
开始工作前先调用 get_messages 读取最近 10 条上下文并记住 latestMessageId；之后固定每 1 分钟调用一次 get_messages，并带上 sinceMessageId=上次看到的 latestMessageId 做增量轮询。
需要同步进展时调用 send_message，消息保持简短、明确、可执行。
```

## 常见错误

- `Channel "xxx" does not exist.`
  说明管道还没创建，先调 `create_channel`

- `Sender "xxx" is not part of channel "yyy".`
  说明 `sender` 名字和创建管道时登记的两端名字不一致

- `limit must be a positive integer or "all".`
  说明 `limit` 传错了

- `content exceeds the 20480 byte limit.`
  说明消息太长，应该拆开发
