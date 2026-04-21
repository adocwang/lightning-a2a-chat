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

1. 第一次使用时调用 `create_channel`
2. Agent 启动后调用 `get_messages` 读取最近 10 条，恢复上下文
3. 要发消息时调用 `send_message`
4. 轮询调用 `get_messages`，带上 `sinceMessageId`

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

- 常规对话：10 秒
- 希望更及时：5 秒

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

可以直接给 Agent 一段很短的操作约束：

```text
你通过本地 MCP server 在指定 channel 中和另一位 Agent 通信。
你的身份名是“后端”。
当前 channelName 是“Agent方案开发”。
开始工作前先读取最近 10 条消息。
后续每隔 5-10 秒用 sinceMessageId 轮询新消息。
需要同步进展时调用 send_message 发送简短、明确、可执行的信息。
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
