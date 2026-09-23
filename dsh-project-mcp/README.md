# @hilariouhiss/dsh-project-mcp

让 DeepSeek Harness 自动加载**项目目录下的 `.mcp.json`**（Claude Code 用的那个格式），把它声明的 MCP server 挂到**当前会话**上。

在 `<项目根>/.mcp.json` 里写一次，之后在该项目里开的每个会话都自带这些 MCP 工具（`mcp__<server>__<tool>`），换个项目就换一套，互不干扰。

## 功能

- **按会话加载**：会话的 `session.header.cwd` 决定读哪份 `.mcp.json`；只在会话自己的 scope 里挂载，会话结束即拆除。
- **零冲突**：`serverName` 只在一个 agent scope 内要求唯一，所以两个项目可以有同名 server，不需要改名、不需要引用计数。
- **子 agent 自动继承**：subagent 的 scope 挂在父 agent 下，项目 MCP 工具对它自然可见，不会重复起进程。
- **首轮即生效**：挂载发生在 `agent/created`（宿主会 await 这个监听器）里，会话第一次对话就能看到工具，不存在「第一轮没有、第二轮才有」的抢跑。
- **${VAR} 展开**：`${TOKEN}` / `${TOKEN:-默认值}` 在挂载时用宿主进程环境求值，`.mcp.json` 里不必写明文密钥。
- **失败不致命**：坏 JSON、不支持的 transport、起不来的 server 都只影响它自己，打一条 warn，会话照常开。

## 支持的文件格式

`.mcp.json` 就是 Claude Code 的项目级 MCP 配置文件：

```json
{
  "mcpServers": {
    "fs": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "env": { "ROOT": "${PWD:-.}" }
    },
    "web": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
    }
  }
}
```

| 字段 | 说明 |
|---|---|
| `type` | 省略或 `stdio` → `command`/`args`/`env`/`cwd`；`http` → `url`/`headers`。`sse` 及未知值**跳过并告警**（宿主的 MCP 桥只支持 stdio 与 streamable-http）。 |
| `command` | stdio 必填，必须是能在宿主进程 PATH 上解析的可执行文件。 |
| `cwd` | stdio 可选，默认 `.mcp.json` 所在目录（相对路径按该目录解析）。 |
| `env` | 在宿主「已擦除」的环境之上合并（`*KEY*`/`*TOKEN*`/`*SECRET*`/`*PASSWORD*` 与 `DSH_*` 的宿主环境变量不会传给子进程，显式写在这里的会）。 |
| `mcpServers` 缺失 | 合法的空层，什么事都不发生。 |

## 安装

```powershell
dsh plugin --profile web add @hilariouhiss/dsh-project-mcp
```

把 `web` 换成你的 profile 名（例如 `headless`），然后**重启 dsh**。

## 验证

1. 在某个项目根目录放一份 `.mcp.json`，重启 dsh，在该项目里开一个会话。
2. 问模型「列出你能用的 mcp 工具」，或直接调用 `mcp__<server>__<tool>`。
3. 宿主日志里应能看到 `project-mcp: mounted N server(s) for <agent id>`。

## 工作原理

```
agent/created ──► 会话 cwd ──► 向上找 .mcp.json（止于含 .git 的项目根）
                    │
                    ├─ 解析 mcpServers，逐条映射成 dsh-mcp-client 的 config
                    ├─ McpClient.Config(...) 校验（宿主自己的 schema 就是闸门）
                    └─ await agent.ctx.plugin(McpClient, config)   ← 挂进该 agent 的 scope
```

宿主侧依据（`@deepseek-ai/dsh` 0.1.7-alpha.2 实测）：

- `dsh-acp` 就是这么干的：`for (const config of configs) await agentCtx.plugin(McpClient, config)`。
- `agent/created` 在 `agents.create()` 内部被 await（`dsh-agent-loop` 的 `publish()` → `await agents.announce(...)`），所以监听器里的异步挂载会挡在会话创建完成之前。
- `agent.ctx` 是 agent 自己的 scope：注册物随 agent 释放自动拆除，子 agent 继承父 scope。

## 安全边界

**`.mcp.json` 是可执行代码载体。** stdio 条目的 `command` 会在 DSH 宿主进程里被 spawn，拥有宿主的权限。只在你信任的仓库里放这个文件；`git clone` 下来的第三方项目自带的 `.mcp.json` 等价于让它执行命令。

本插件做的是：用宿主 MCP 桥自己的 schema 校验每一条配置（名字非法、字段类型错、transport 不支持都拒绝），逐条隔离失败，并且**只**读会话 cwd 及其祖先目录里的 `.mcp.json`（越过 git 根就停），不读用户层、不读 `~/.claude.json`。

## 与已有插件的关系

同生态里已有实现，本插件的取舍是「最小」：

| | 本项目 | [`dsh-project-mcp-manager`](https://www.npmjs.com/package/dsh-project-mcp-manager) | [`dsh-cc-mcp`](https://www.npmjs.com/package/dsh-cc-mcp) |
|---|---|---|---|
| 来源 | 只读 `<cwd>/.mcp.json` | 六层（`.dsh/mcp.yml`、`.dsh/mcp.json`、`.mcp.json`、用户层…） | `.mcp.json` + 插件清单 |
| 挂载粒度 | 每个会话一套 | 每个项目共享一套（宿主全局挂 + `tools.restrict` 隔离） | 每个会话，工具急切注册、连接懒建 |
| 热重载 | 无（开新会话即生效） | chokidar + 去抖全量重算 | watchFile |
| MCP 实现 | 复用宿主 `dsh-mcp-client` | 复用宿主 `dsh-mcp-client` | 自带一套 bridge |
| 规模 | 单文件核心 | lib 约 4700 行 | — |

代价：N 个并发会话 = N 份 server 进程（上者是每项目一份）。

## 已知限制

1. **不热重载**：改完 `.mcp.json` 要开新会话（或重启 dsh）。已存在的会话仍用挂载时的配置。
2. **每个会话一套连接**：多会话同时开在同一项目会各起一份 MCP server 进程。
3. **不支持 `sse`**：宿主 MCP 桥只支持 `stdio` 与 `streamable-http`，`sse` 条目会被跳过并告警。
4. **只看 `.mcp.json`**：不读 `.dsh/mcp.yml`、用户层配置或 `~/.claude.json`。

## 开发

```powershell
pnpm install
pnpm test          # 或在本目录：node --test-isolation=none --test
```

```
lib/config.js       纯逻辑：定位 .mcp.json、解析、映射、${VAR} 展开（零宿主依赖）
lib/index.js        接线：McpClient.Config 校验 + agent.ctx.plugin 挂载 + agent/created
cordis.patch.yml    bundle patch：插入本插件的宿主行
test/               node:test（config 13 项 / index 10 项 / manifest 2 项）
```

`lib/config.js` 刻意不导入任何宿主包，所以解析与映射分支可以在没有 dsh 安装的环境里完整跑测试；宿主接缝由 `lib/index.js` 承担。

## 发布（给维护者）

```powershell
cd dsh-project-mcp
pnpm test
npm publish        # publishConfig.access 已设为 public
```

`prepublishOnly` 每次发布前自动跑 `npm test`；发版前先 `node ../scripts/smoke-profile.mjs` 走真实安装 + 真启动。

## 许可与来源

MIT。`.mcp.json` 是 Claude Code 的项目级 MCP 配置格式，本插件只实现它的读取，不含任何 Claude Code 代码。

> `@deepseek-ai/dsh-mcp-client` 由**正在运行的 dsh 安装**提供，本包只在 `peerDependencies` 里声明（`devDependencies` 供本仓测试）。**不要**把它写进 `dependencies` —— 那会让 pnpm 往 profile 里塞一份自己的副本，遮蔽安装目录里的同名包，两代混装会让整棵插件树启动失败。`test/manifest.test.js` 守着这条不变量。
