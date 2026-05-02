# web-search-mcp

基于 DeepSeek 网页版的在线搜索 MCP 服务器。通过 DeepSeek 的搜索增强对话功能，为 MCP 客户端提供实时网络搜索能力。

## 功能

- 提供 `web_search` MCP 工具，支持实时网络搜索
- 支持 DeepSeek 默认模型和专家模型
- 支持思考过程（thinking）输出
- 零依赖，纯 Node.js 实现
- stdio 传输，兼容所有 MCP 客户端

## 快速开始

### 1. 在 Claude Desktop 中使用

编辑 Claude Desktop 配置文件（`claude_desktop_config.json`），通过 `env` 字段直接传入凭据，无需 `.env` 文件：

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["D:/ai-projects/web-search-mcp/src/index.js"],
      "env": {
        "DEEPSEEK_AUTH_TOKEN": "your_token_here"
      }
    }
  }
}
```

### 2. 在 Claude Code 中使用

在项目的 `.claude/settings.json` 中添加：

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["D:/ai-projects/web-search-mcp/src/index.js"],
      "env": {
        "DEEPSEEK_AUTH_TOKEN": "your_token_here"
      }
    }
  }
}
```

### 3. 使用 .env 文件（可选）

如果不方便在 MCP 配置中写 `env`，也可以用 `.env` 文件：

```bash
cp .env.example .env
# 编辑 .env 填入凭据
```

> 环境变量优先级：系统环境变量 > MCP `env` 配置 > `.env` 文件

## MCP 工具

### `web_search`

使用 DeepSeek 搜索增强对话进行网络搜索，返回基于搜索结果的回答。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索查询内容 |
| `thinking` | boolean | 否 | 是否开启 DeepSeek 思考/推理模式，开启后模型会先推理再回答，推理过程包含在响应中（默认 false） |
| `model` | string | 否 | 模型模式：`default` 或 `expert`（默认使用配置值） |

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DEEPSEEK_AUTH_TOKEN` | 二选一 | - | DeepSeek 登录 token |
| `DEEPSEEK_COOKIE` | 二选一 | - | DeepSeek 浏览器 cookie |
| `DEEPSEEK_MODEL_TYPE` | 否 | `default` | 模型类型：`default` 或 `expert` |
| `DEEPSEEK_THINKING_ENABLED` | 否 | `false` | 是否默认启用思考过程 |
| `WASM_PATH` | 否 | `assets/sha3_wasm_bg...wasm` | PoW 求解器 WASM 文件路径 |
| `LOG_LEVEL` | 否 | `info` | 日志级别：`debug`、`info`、`error` |

## 获取 DeepSeek 凭据

1. 打开 [chat.deepseek.com](https://chat.deepseek.com) 并登录
2. 打开浏览器开发者工具（F12）→ 切换到 **Console（控制台）** 面板
3. 输入以下命令并回车，即可复制完整的 cookie 字符串：

```js
copy(document.cookie)
```

4. 粘贴到 `DEEPSEEK_COOKIE` 环境变量中即可

> 注意：凭据会过期，过期后需要重新获取。Token 过期的典型表现是请求返回 Cloudflare 验证页面。

## 测试

```bash
# 运行所有测试
npm test

# 运行单个测试文件
node --test tests/mcp-protocol.test.js
node --test tests/config.test.js
```

## 项目结构

```
src/
  index.js            # 入口，初始化所有组件并启动 MCP 服务器
  mcp-server.js       # MCP 协议处理（stdio 传输、JSON-RPC 分发）
  deepseek-client.js  # DeepSeek 网页版 API 客户端（会话管理、PoW、SSE 流式解析）
  pow-solver.js       # SHA3 PoW WASM 求解器
  env.js              # .env 文件加载器
  config.js           # 环境变量配置解析
```
