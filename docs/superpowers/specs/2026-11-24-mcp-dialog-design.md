# /mcp 弹窗（MCP 状态与开关）设计

日期：2026-11-24
状态：已由用户口头批准（聊天中确认）

## 意图

在 DSH Web GUI 的输入框里敲 `/mcp`，弹出对话框，集中查看并操作当前会话的两类 MCP：
全局注册的（对所有会话可见）和当前工作区 `.mcp.json` 声明的。用户要能当场把某个工具
关掉（模型看不到、调不到），也能新增 MCP 服务器（全局或当前工作区），还能把工作区里的
一台服务器一键注册到全局。

## 目标

1. 输入 `/mcp`（裸命令）打开弹窗；带参数仍执行原宿主命令。
2. 弹窗分两区：
   - 全局 MCP：按服务器分组列出工具，每个工具一个开关。
   - 当前工作区：列出 `.mcp.json` 里的服务器，每台一个开关（挂载/卸载），工具列表只读。
3. 开关状态**按工作区路径记住**（本机状态文件），换项目互不影响。
4. 新增 MCP：表单填名称、stdio（command/args）或 http（url/headers），选「全局」或「工作区」。
5. 工作区服务器旁提供「注册到全局」：把该条目写进全局 MCP 配置，并自动把当前工作区这台置为关闭。

## 非目标

- 不做服务器连接探测（probe 会真的拉起服务器，太重）；没连上的服务器显示 0 个工具。
- 不改已发布契约：不新增 Loader 行、不改现有行 id/name、不动 `exports`/`files` 形状。
- 不做「全局服务器整体开关」（mcp-manager 的 enabled 已有设置页，弹窗只展示状态）。
- 不做工具级开关对工作区服务器生效——DSH 只允许屏蔽全局层工具。

## 约束（来自 AGENTS.md 与实测）

- DSH 0.2.3-alpha.2（安装版）。`/mcp` 已由 project-mcp 行全局注册；同一层不能再注册同名命令。
- 浏览器半是手写 lazy-CJS，只能 require react；控件用 inline style + 主题变量。
- 插件不能直接向浏览器暴露自定义 remote（要手写 typert descriptor）；改用
  `webServer.register` 注册同源 HTTP 路由，浏览器 `fetch` 调用（lan-access 已有先例）。
- 工具屏蔽必须 `agent.ctx.tools.restrict({deny})`，且只对全局层工具生效；未知名字会抛错，
  所以要按当前可见工具名过滤，并在工具表变化后重算。
- 全局新增写 mcp-manager 的 `servers`（`ctx.settings.update("mcp-manager", …)`，volatile，写进 profile patch）；
  工作区新增写项目根 `.mcp.json`（原子写）。
- row 的 host 半不能把 `webServer` 加进 `inject`（ACP/desktop 无 webServer 时会整行不加载），
  必须像 lan-access 那样用可选 `ctx.inject(["webServer"], …)`。

## 决定

- 状态文件：`~/.dsh/hiss-mcp.json`，形如 `{ workspaces: { "<cwd>": { disabledTools: [], disabledServers: [] } } }`。
- 状态读写逻辑与 HTTP 分发器做成纯模块（可离线单测），`index.js` 只做宿主接缝。
- 弹窗入口用 `ctx.commandUi.decorate({ name: "mcp", ui: { kind: "action", run } })`。
- 一次 POST 一个动作：`status` / `set-tool` / `set-server` / `add-server` / `promote`。

## 未验证 / 风险

- `webServer.register` 的鉴权在 0.2.1-alpha.4 与 0.2.3-alpha.2 上是否一致（lan-access 已在 0.2.1 上用）。
- `tools.restrict` 拒绝对未知名字；工具异步连接导致的重算依赖 `tools/change` 事件。
- 工作区路径大小写/符号链接不做归一（Windows 同一目录不同写法可能各自记住一套状态）。
