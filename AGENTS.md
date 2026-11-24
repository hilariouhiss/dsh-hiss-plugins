# AGENTS.md

> pnpm workspace 单仓：只发布一个包 `dsh-hiss-plugins/`（npm `dsh-hiss-plugins`），把九个功能打成一个 **DSH（DeepSeek Harness）bundle 插件**。
> 最高优先级：**不要破坏已发布的插件契约** —— `package.json` 的 `dsh`/`exports`/`files`、`cordis.patch.yml` 的十行、`lib/*/index.js` 与 `lib/client.js` 的导出形状。

## 安装与检查（先看这里）

- 工具链：Node ≥ 20（CI 用 24）、pnpm 12.3.4（`pnpm-lock.yaml` 的生成版本，CI 同版本）。
- 安装：在仓库根目录跑 `pnpm install`（普通终端；沙箱内的 reparse-point 限制见 §6）。
- 全量检查：`pnpm test`（根脚本 = `pnpm -r test && node --test scripts/resolve-tag.test.mjs`，即包内全部 `node:test` 文件 + tag 解析器测试）。测试离线，不联网、不依赖 `colgrep` / `codegraph` CLI；本仓没有 lint / format / typecheck 脚本，别臆造。
- 单包 / 单文件：`cd dsh-hiss-plugins && node --test`；单个文件如 `node --test test/gitbash/resolve.test.js`。
- 沙箱内 `pnpm test` 若报 `spawn EPERM`：改在包目录跑 `node --test-isolation=none --test`（环境限制，不是测试失败；见 §6）。
- 真实安装 + 真启动冒烟（需联网、`pnpm`、PATH 上的 `dsh`）：`pnpm smoke`（即 `node scripts/smoke-profile.mjs`），不属于 `pnpm test`。

## 1. 仓库地图

| 路径 | 提供 |
|---|---|
| `dsh-hiss-plugins/` | 唯一的包（v1.4.0）：九个功能 + Plugins 页里的管理标签 |
| `dsh-hiss-plugins/lib/index.js` | 载体行：空的 host 半，只为让浏览器半被送出 |
| `dsh-hiss-plugins/lib/colgrep/` | `colgrep` 模型工具（语义检索，`root` 可指定项目；`agent:true` 走本地 sub-agent） |
| `dsh-hiss-plugins/lib/codegraph/` | 经 MCP 注册 `mcp__codegraph__*` 工具 + 无索引时的建图引导 |
| `dsh-hiss-plugins/lib/project-mcp/` | 读会话项目根的 `.mcp.json`，挂进该 agent 自己的 scope（按会话隔离、子 agent 继承）；`config.js` 定位/解析/映射/原子写、`state.js` 按工作区的开关状态、`view.js` 弹窗数据（工具归属）、`actions.js` 弹窗动作分发、`status.js` 是 `/mcp` 文本报告；`index.js` 注册宿主 `/mcp` 命令、按工作区用 `tools.restrict` 屏蔽工具、并提供 `/hiss-mcp/action` 同源 POST 路由给浏览器半的弹窗 |
| `dsh-hiss-plugins/lib/gitbash/` | Windows 上接入 Git Bash：行自带 realm 隔离，同一 realm 内提供 `ctx.shell` 与宿主 `bash` 工具 |
| `dsh-hiss-plugins/lib/superpowers/` | superpowers 常驻引导：只注册全局提示词段 `superpowers:adoption`（技能仍由 DSH 原生发现，不安装、不内置技能） |
| `dsh-hiss-plugins/lib/ponytail/` | ponytail 采纳提示段 + 宿主 `/ponytail` 等级命令；`lib/ponytail/mode.js` 管等级语法、默认值解析与按 agent 的等级表 |
| `dsh-hiss-plugins/lib/init/` | 宿主 `/init` 命令：`lib/init/prompt.js` 是指令正文（纯逻辑），`lib/init/index.js` 把指令作为非 user 来源的上下文消息经 `agent.followup` 交给模型，读项目并写 `AGENTS.md` |
| `dsh-hiss-plugins/lib/fix/` | 宿主 `/fix` 命令：`lib/fix/prompt.js` 是先诊断后修复的指令正文（纯逻辑），`lib/fix/index.js` 把指令经 `agent.followup` 交给模型；本轮只报告根因，用户确认后才修复 |
| `dsh-hiss-plugins/lib/lan-access/` | 局域网网关：`lib/gateway.js` 是纯 Node 转发器（HTTP + WebSocket，无宿主导入，把 `Host`/`Origin` 改写成 loopback authority；`?pair=…` 由网关自己换 Host cookie 并按客户端 IP 维持会话），`lib/qr.js` 是字节模式二维码编码器，`lib/index.js` 启动监听、注册 `/lan` 命令与 loopback 上的 `/lan-access` QR 页；默认关闭，`config.debug` 打开 `~/.dsh/lan-access.log` 诊断 |
| `dsh-hiss-plugins/lib/client.js` | 浏览器半（手写 lazy-CJS）：Plugins 页管理标签、`/mcp`/`/lan` 的 chat 节点投影、侧边栏底部「手机连接」按钮 + `shell.overlay` 二维码弹窗、裸 `/mcp` 的 MCP 管理弹窗（`commandUi.decorate` + `shell.overlay` 的 `mcp.dialog`） |
| `dsh-hiss-plugins/locale/` | 管理标签的中 / 英文字典；`meta` 是 Plugins 页显示的包信息 |
| `dsh-hiss-plugins/test/` | node:test 单测：九个 `<feature>/` 目录 + `manifest.test.js` + `patch.test.js` + `client.test.js` |

功能与宿主 peer 的对应：`colgrep` → `dsh-tools`；`codegraph`、`project-mcp` → `dsh-mcp-client`（`/mcp` 另用 `commands` / `tools` 两个 ctx 服务，经 `ctx.inject` 注册：缺服务只丢命令，不影响挂载）；`gitbash` → `dsh-bash-sandbox` + `dsh-tool-bash`；注意 project-mcp 另用**可选**的 `webServer`（经 `ctx.inject`；缺它只丢 `/mcp` 弹窗，MCP 挂载与文本命令照常）；`ponytail` → `dsh-llm` + `dsh-skill`（`createUserMessage` 与 `renderSkillContent`）；`init` → `dsh-llm`（`createUserMessage`），另用 `commands` / `workingDirectory` 两个 ctx 服务；`fix` → `dsh-llm`（`createUserMessage`），另用 `commands` 服务；`lan-access` 只用 `webServer` / `connection` 两个 ctx 服务与 Node 标准库、不导入宿主包，因此不新增 peer；`superpowers` 只用 ctx 服务、不导入宿主包。这六个 `@deepseek-ai/*` 都是**宿主提供的 peer**，见 §3.4。

> 历史：原有六块功能各自是一个独立发布的 bundle 包（superpowers 与 ponytail 那两个技能包在合并前先被删掉，现在以功能行的形式回到同一个包里；每个旧包各有自己的 `package.json`、`cordis.patch.yml`、`test/manifest.test.js` 和发布 tag）。现在只有上面的一个包、一条发布线；旧包名、旧目录名不要再出现在代码或文档里。

## 2. 插件如何工作

`dsh plugin --profile <p> add dsh-hiss-plugins` → 装进 profile 的 `node_modules` → DSH 读到 `package.json` 的 `dsh.bundle.patch` → 启动时应用 `cordis.patch.yml` 的 `- insert: [{ id, name }]` → DSH 用 `name`（模块说明符）解析该模块并调用 `apply(ctx)`。
运行在 **host plane**，注册物进入 global layer：对该 profile 的**所有 preset、所有会话**可见。

### 2.1 bundle patch 如何组行

profile 的每个 bundle 各贡献一层 patch，本包的 `cordis.patch.yml` 只做一件事：`insert` 十条**顶层行**。profile 自己的 `cordis.patch.yml` 再按 `id` 叠加覆盖（开关就写在那里）：

| 行 id | `name`（模块说明符） | 作用 |
|---|---|---|
| `dsh-hiss-plugins` | `dsh-hiss-plugins` | 载体行：空 host 半，占一条 Loader 行 |
| `dsh-hiss-plugins-colgrep` | `dsh-hiss-plugins/colgrep` | colgrep 工具 |
| `dsh-hiss-plugins-codegraph` | `dsh-hiss-plugins/codegraph` | codegraph MCP 桥 + 引导 |
| `dsh-hiss-plugins-project-mcp` | `dsh-hiss-plugins/project-mcp` | 按会话挂载 `.mcp.json` |
| `dsh-hiss-plugins-gitbash` | `dsh-hiss-plugins/gitbash` | Windows Git Bash（自带 realm 隔离） |
| `dsh-hiss-plugins-superpowers` | `dsh-hiss-plugins/superpowers` | superpowers 常驻引导提示词段 |
| `dsh-hiss-plugins-ponytail` | `dsh-hiss-plugins/ponytail` | ponytail 采纳提示段 + `/ponytail` 等级命令 |
| `dsh-hiss-plugins-init` | `dsh-hiss-plugins/init` | 宿主 `/init` 命令：读项目、生成/更新 `AGENTS.md` |
| `dsh-hiss-plugins-fix` | `dsh-hiss-plugins/fix` | 宿主 `/fix` 命令：先查根因并报告，确认后才修复 |
| `dsh-hiss-plugins-lan-access` | `dsh-hiss-plugins/lan-access` | 局域网网关（默认关闭）：把 loopback 上的 GUI 转给手机，`/lan` 打印配对地址 |

**这十行必须是顶层行，永远不要改成 `cordis:group` + children。** 插件管理器只能给「组合后的 patch 里存在同 `id`、同 `name`，且该行挂载后父 entry 就是 profile 的 `include`」的行持久化开关 —— `dsh-plugin-manager` 的 `listPlugins()` 逐个检查 `candidate.name !== entry.moduleName || actual?.parent.tree.ctx.fiber.entry?.id !== "include"`，命中就标 `unaddressable`。组会把子行变成不可寻址：**包在 `cordis:group` 里的一组功能在 Plugins 页永远不会出现开关**。git-bash 行因此把 realm 隔离写在自己身上（`isolate: { shell: true, settings: true }`），而不是包在一个 realm 组里；同一行内的模块再把宿主 `bash` 工具挂进这个 realm（消费方离开 provider 的 realm 会解析到宿主的 pwsh 执行器）。

两条地址规则：

- 行的 `id` 是**持久化地址**。用户每点一次开关，宿主就往 profile 的 `cordis.patch.yml` 追加/更新一条 `{ id, disabled }` 覆盖；改 `id` 等于丢掉所有用户已有的开关状态。
- 行的 `name` 必须逐字等于本包 `exports` 里真实存在的模块说明符（载体行是包名本身）。写成不存在的子路径，该行解析失败；写成与挂载模块不一致的名字，该行 `unaddressable`。

### 2.2 浏览器半（客户端契约）

- `package.json` 必须同时声明：`dsh.bundle.patch: "./cordis.patch.yml"`、`dsh.client: { platform: "web", inject: ["@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-modules"] }`、`exports["./client"]: "./lib/client.js"`。客户端模块系统按 **Loader 行**扫描：只有某条行已挂载的包才会被读 `dsh.client`，也只有 `platform: "web"` 且 `exports["./client"]` 指向真实文件的包才会被送进浏览器 —— 这就是载体行存在的唯一理由。
- `dsh.client.inject` 是**包名**列表（其它浏览器半的图依赖），不是 npm 依赖，不要写进 `dependencies`。
- `lib/client.js` 是**手写 lazy-CJS bundle，无构建步骤**：执行脚本只注册工厂（`window.__ModuleLoader__.load({ id: "dsh-hiss-plugins", factory: (require) => { ...; exports.apply = apply; exports.inject = inject; return module.exports; } })`），模块体（含一切注册副作用）在首次被 require/import 时执行；`id` 必须逐字等于包名（客户端图里的行 id 就是包名）。
- `exports.inject` 写的是**浏览器侧服务名**（`slots`、`locale`、`remote`、`remote.<命名空间>`、`uiConversation`），少列一个 → 该浏览器插件静默不激活。它与 `dsh.client.inject`（包名）不是一回事。
- 远程调用走 `ctx.remote.<命名空间>.<方法>`，命名空间就是 host 侧服务名。管理标签用 `await ctx.remote.pluginManager.listPlugins()` 取行、`await ctx.remote.pluginManager.setPluginEnabled(entryId, enabled)` 写开关。
- 标签注册进 Plugins 页（`dsh-client-ui-plugin-manager`）声明的 `plugins.tab` list slot：`ctx.slots.inject("plugins.tab", () => ctx.slots.register({ name: "plugins.tab", id, order, label, locale }, 渲染函数))`，条目按 `order` 排在该页自己的「已安装」标签之后。
- 浏览器半用 **`ctx.commandUi.decorate({ name: "mcp", ui: { kind: "action", run } })`** 接管**不带参数**的 `/mcp`：吃掉 token、不发消息，打开 `shell.overlay` 里的 `mcp.dialog`（`POST /hiss-mcp/action` 读写状态）。`commandUi` 走可选 `ctx.inject`：宿主没有这个服务时只有弹窗消失，Plugins 标签与手机弹窗不受影响；`package.json` 的 `dsh.client.inject` 因此要列 `@deepseek-ai/dsh-client-ui-commands`。开关按工作区记在 `~/.dsh/hiss-mcp.json`，工具屏蔽用 `agent.ctx.tools.restrict({deny})`（只对全局层工具有效）。
- 浏览器半还注册一个 **Conversation 投影**：`ctx.uiConversation.events.register(...)` 把宿主 `/mcp`、`/lan` 的 `command/run` 投影成 chat 节点 `hiss-mcp-command`，并在 `conversation.chat.node` 注册它的零尺寸渲染器。原因是 DSH 在会话**还没有 turn** 时把整段对话当 blank 隐藏（chat 视图的 `isActive` 只认非 `command` 节点，只有 `turn/start` 清 `sessionListMetadata.blank`），只写 command 事件的命令在新会话里会“看不见”——`/goal` 用同一招。报告本身仍由通用 command 卡片渲染。
- 侧边栏入口：`lib/client.js` 往 `sidebar.footer.action`（list，owner 传 `{ wide }`）注册一行按钮，往 `shell.overlay` 注册二维码弹窗；两者用模块内的小 store 共享开合状态。按钮点击先经 `pluginManager` 确认 `lan-access` 行已启用（未启用就开启），再探测 `/lan-access?embed=1` 后把该页嵌进 iframe；`restart-required` 时改为提示重启。
- 开关的落地：host 把 `{ id, disabled }` 覆盖写进 **profile 自己的** `cordis.patch.yml`（保留注释、原子写，`mode 0600`）。带 HMR 的 profile 立即重算并返回 `applied`；没有 HMR 时接口返回 `application: "restart-required"`（`restartReason: "no-hmr"`），重启 dsh 生效。`readOnlyReason`（`unaddressable` / `management-required`）表示该行没有开关。

### 2.3 ctx 服务速查

| ctx 服务 | 用途 |
|---|---|
| `ctx.systemPrompt.section({ name, order, text })` | 注入提示词段；`text` 可为 `(context) => string`，每回合重算 |
| `ctx.tools.register(defineTool({ ... }))` | 模型工具；`ctx.tools.schemas(agent)` 读该 agent 此刻可见的工具（`/mcp` 用它判断哪些 MCP server 真正连上） |
| `ctx.commands.register(...)`、`ctx.workingDirectory.ensure(agent, signal)`、`agent.followup(...)` | 注册宿主斜杠命令；解析会话工作目录；把一条持久 user-role 消息交给模型（`/ponytail`、`/init`、`/fix`、`/mcp`）。来源 kind 不是 `user` 时，聊天把它折叠成上下文/turn-trigger 卡片，而不是用户气泡 |
| `ctx.shell.resolve` → `ctx.shell.execute` → `result()` + `ctx.sandboxPolicy.resolve` | 在沙箱策略内调用外部 CLI（0.1.7 起 `execute()` 先给进程句柄，结算结果在 `result()` 上；旧的 `run()` 已移除） |
| `ctx.plugin({ inject, apply }, config)` | 嵌套加载其它插件（codegraph 挂 MCP 桥；gitbash 在自己的 realm 里挂宿主 `bash` 工具） |
| `ctx.agents.list()` / `ctx.on("agent/created", …)` | 按会话接线：project-mcp 在 agent 建好前挂载（宿主 await 这个监听器），子 agent 自然继承 |
| `ctx.remote.<ns>.<method>`（仅浏览器半） | 调 host 侧服务；本标签用 `pluginManager.listPlugins` / `setPluginEnabled` |

## 3. 硬性不变量（破坏即发布事故）

1. `cordis.patch.yml` 的十行保持**顶层**、`id` 稳定、`name` 逐字等于本包 `exports` 的真实子路径（载体行 = 包名）。宿主用 `id` 持久化开关、用 `name` 解析模块；错一个，该功能在 Plugins 页就不可开关（`unaddressable`），包进 `cordis:group` 则永远没有开关。
2. `files` 白名单要含全部运行时文件（本包统一是 `lib/`、`locale/`、`cordis.patch.yml`、`README.md`、`LICENSE`），否则发出去的包里没有运行时文件，插件加载即失败。
3. `inject` 漏列服务 → host 行静默不激活；浏览器半的 `exports.inject` 同理（少列 `remote.<ns>` 时远程命名空间不可用）。`inject` 里不需要宿主行的 git-bash 行是空的 `[]`，那是刻意的。
4. **`@deepseek-ai/*` 只能进 `peerDependencies`，绝不进 `dependencies`。** 写成 `dependencies` 会让 pnpm 把这份副本 hoist 进 profile 的 `node_modules`，**遮蔽**安装目录里的同名包（`$DSH_HOME/profiles/node_modules` 的镜像）；两代混装会在 ESM 链接期炸掉整棵插件树 —— 连宿主自己的核心 `tools` 行一起，`dsh` 直接 exit 1。peer 范围写 `^<该包真正兼容的那一代>` 作为兼容下限声明，`devDependencies` 写**精确版本**供本仓安装与测试解析。当前运行时是 `0.2.1-alpha.4`，**本包统一声明 `^0.2.1-alpha.4` / `devDependencies` 精确 `0.2.1-alpha.4`**（六个 peer 一次改齐）。**注意 `^` 范围对预发布版本的语义**：`^0.1.5-rc.2`、`^0.1.7-alpha.1`、`^0.2.0-rc.2` 都**不**匹配 `0.2.1-alpha.4`（semver 只在元组相同时放行预发布），所以旧声明会让 **pnpm 的 peer 解析**失败（别指望宿主的兼容闸门替你发现：0.2.1-alpha.4 起 `dsh-app-boot` 的 `unmetRequirements` 用 `includePrerelease: true` 匹配 `@deepseek-ai/dsh*` peer，`^0.2.0-rc.2` 照样过闸）—— `peerDependencies` 的"兼容下限声明"不等于 pnpm 的兼容性保证，接缝得靠测试守（§4 的"打到真实基类"）。`dsh.client.inject` 里的包名是浏览器侧图依赖，不是 npm 依赖，别顺手写进 `dependencies`。
5. `lib/*/index.js` 的 `name`/`inject`/`apply`、`lib/client.js` 的 `apply`/`inject` 导出形状与 `test/` 断言是对外契约。
6. 行尾 **LF**（`.gitattributes` 已强制）；测试必须**离线可跑**（不联网，不依赖 `colgrep`/`codegraph` CLI）。

## 4. 代码与测试风格

- ESM、import 带显式 `.js` 后缀、Node ≥ 20；**纯 JS + JSDoc，无 TypeScript、无构建步骤**；**缩进用 TAB**；双引号、分号；具名导出；私有字段 `#`；注释写 why 不写 what。
- 测试用 Node 内置 `node:test` + `node:assert/strict`，零依赖。**不启动真实 DSH**：手写 fake `ctx` 捕获注册调用，`mkdtempSync` 临时目录做 fixture。覆盖导出形状、注册次数、argv 组装、渲染函数与**错误分支**。浏览器半同理：`test/client.test.js` 用 fake `window.__ModuleLoader__` + fake `ctx` 捕获 slot 注册与 remote 调用（成功 / 失败 / 需要重启三个分支），不启动浏览器。
- 命令见上面的「安装与检查」。基线以 **`pnpm test` 的输出**为准，本文件不写死数字。**在 DSH 沙箱内 `pnpm test` 可能以 `spawn EPERM` 失败** —— 沙箱禁止带管道的子进程 stdio，而 `node --test` 要为每个测试文件 spawn 子进程；这是**环境限制，不是测试失败**，改在包目录内跑 `node --test-isolation=none --test`。新增 / 换代时同步 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（刚发布的预发布版会被 pnpm 的发布时长策略挡掉，报成 `ERR_PNPM_NO_MATCHING_VERSION`）：`dsh-*` 写该代精确版本；`cordis` / `cordis-plugin-*` / `cosmokit` / `schemastery` 若需要排除，用它们各自的版本号（**独立版本线**），别写成 `0.2.1-alpha.4`。`pnpm-workspace.yaml` 的 `packages:` 里那组带 `||` 的 `@deepseek-ai/*@版本` 条目不匹配任何 workspace 目录，别把新版本只加在那里。
- **`lib/` 里凡是导入宿主包的模块，在沙箱内都跑不了测试**（见 §6 的 reparse point 条目）。要测的逻辑就放进不导入宿主包的模块：`lib/project-mcp/config.js`（`.mcp.json` 定位/解析/映射/原子写）、`lib/project-mcp/status.js`（`/mcp` 报告与 MCP 工具归属）、`lib/project-mcp/state.js`（按工作区开关状态）、`lib/project-mcp/view.js`（弹窗两区的组装与工具归属）、`lib/project-mcp/actions.js`（弹窗动作分发）、`lib/gitbash/resolve.js`（Git Bash 解析）、`lib/ponytail/mode.js`（ponytail 等级语法、默认值与按 agent 的等级表）、`lib/init/prompt.js`（`/init` 指令正文与目标/章节常量）、`lib/fix/prompt.js`（`/fix` 诊断工作流正文）、`lib/lan-access/gateway.js`（LAN 转发器：地址挑选、Host/Origin 改写、HTTP/WS 隧道）与 `lib/lan-access/qr.js`（二维码编码器）零宿主依赖、分支全覆盖地跑单测，`lib/*/index.js` 只承担宿主接缝。沙箱内需要真实依赖时，用 `npm install <pkg>` 在临时目录建一份真实目录布局再跑（`npm` 不走 pnpm 的符号链接农场）。
- **覆写宿主接缝的模块，测试必须打到真实基类**：0.1.7 把执行器接缝从 `run`/`start`/`runArgv`/`startArgv` 改成 `execute`/`executeArgv`，覆写旧名字在 import 期**完全静默**，只在调用时表现为"跑错 shell"。`lib/gitbash/gitbash-executor.js` 覆写 `confine`/`executeArgv`/`execute`，`test/gitbash/` 因此既断言接缝名/参数个数，也用真实 `SandboxBashExecutor`（只假 `ctx.subprocess`）跑一遍完整调用链，把这三个接缝钉在当前运行时代次（`0.2.1-alpha.4`）上 —— 纯 fake 基类会把宿主的行为变成测试自己的假设。
- 单元测试跑的是仓内 `devDependencies`，**看不到 profile 里的模块遮蔽**。真实安装 + 真启动的冒烟检查是唯一能抓到那一类的方式：`node scripts/smoke-profile.mjs`（需联网 + `pnpm` + PATH 上的 `dsh`，非 `pnpm test` 的一部分；它还会开一个真实会话，验证 project-mcp 在 `agent/created` 里挂载 `.mcp.json` 的那条接缝）。
- 绝不为"让测试变绿"而削弱断言或删测试；先判断是**行为错了**还是**期望错了**，说清依据再改。

## 5. 新增功能行

- 加一个功能：`lib/<feature>/index.js`（导出 `name`/`inject`/`apply`）→ `package.json` 的 `exports` 加 `"./<feature>"` → `cordis.patch.yml` 加一条**顶层**行（`id: dsh-hiss-plugins-<feature>`，`name: dsh-hiss-plugins/<feature>`）→ 确认 `files` 白名单覆盖新文件 → 要在 Plugins 页可开关就把该行加进 `lib/client.js` 的 `FEATURES`，并在 `locale/zh.json` / `locale/en.json` 补文案（`test/client.test.js` 会断言 feature 列表与中 / 英字典，新增 feature 记得同步该测试）→ 写测试（含 `test/manifest.test.js` 里列出该功能用到的 `@deepseek-ai/*` 并按 §3.4 声明、`test/patch.test.js` 里守住顶层形状）→ `dsh plugin --profile <p> add link:./dsh-hiss-plugins` 本地验证 → 发版前 `node scripts/smoke-profile.mjs` 走一遍真实安装 + 真启动。
- 提交用 **Conventional Commits**（英文）：`feat:`/`fix:`/`docs:`/`refactor:`/`chore:`/`test:`；一个提交只做一件事。

## 6. 常见陷阱

| 症状 | 原因 / 对策 |
|---|---|
| 重启后插件"没生效" | `cordis.patch.yml` 的 `name` 与 `exports` 子路径不一致，或 `inject` 少列服务 |
| **Plugins 页里某个功能没有开关 / 开关点了没用** | ① 该行不是**顶层行**（被 `cordis:group` 包着，或父 entry 不是 profile 的 `include`）→ `listPlugins()` 判 `unaddressable`；`test/patch.test.js` 守这条形状。② 行的 `name` 与挂载模块名不一致，同样 `unaddressable`。③ 命中的是插件管理器自己的行或受保护模块 → `management-required`（本来就不能关）。`listPlugins()` 返回的 `readOnlyReason` 会说明是哪种。④ 开关写进去了但界面没变：profile 没有 HMR，结果是 `restart-required`，重启 dsh 才生效。⑤ 浏览器半没被送出：包没有任何 Loader 行（载体行被删），或 `dsh.client.platform` 不是 `"web"`、`exports["./client"]` 指错文件 |
| **`/mcp` 输出要等下一条消息才出现**（新会话里 `command/run`/`command/done` 已写进日志，界面却没变） | 会话还没有 `turn/start` 时 DSH 把整段对话当 blank 隐藏（`sessionListMetadata.blank` 只由 turn 清，chat 视图 `isActive` 忽略 command 节点）。浏览器半的 `hiss-mcp-command` 伴随节点就是对策（§2.2）；浏览器半没被送出、或 `uiConversation` 服务没等到，会退回“看不见”的旧行为 |
| 升级 DSH 后插件崩 | `@deepseek-ai/*` 是预发布版，公开 API 可能变；同步 peer 范围与 `devDependencies`，再跑 `node scripts/smoke-profile.mjs` |
| 工具调用报 `ctx.shell.run is not a function`，或 `bash` 跑成了 WSL | 宿主把执行器接缝改名了（0.1.7：`run`/`start`/`runArgv`/`startArgv` → `execute`/`executeArgv`，`ctx.sandbox.confine` 变异步三参）。覆写不存在的名字**加载期无任何报错**，只在调用时暴露；按 §4 的"打到真实基类"补一条守卫测试，别只改调用点 |
| `dsh` 直接起不来、报 `does not provide an export named ...` | profile 里 hoist 了 `@deepseek-ai/*` 旧副本（§3.4）。`ls ~/.dsh/profiles/<p>/node_modules/@deepseek-ai` 有内容即为命中；修 `package.json` 后让用户 `dsh plugin --profile <p> update` |
| 单元测试全绿、真实安装却炸 | 单测跑仓内 `devDependencies`，看不见 profile 遮蔽；用 `node scripts/smoke-profile.mjs` |
| 沙箱内 `pnpm install` 报 `UNKNOWN: unknown error, open '...node_modules\\.pnpm\\...'`，随后所有 `ERR_MODULE_NOT_FOUND` | 沙箱把**工作区内的 reparse point（符号链接/junction）对子进程设为不可遍历**：`.pnpm` 里的真实目录读得到，经过链接就读不到（`scandir ... UNKNOWN`）。这不是依赖坏了，是环境限制。对策：① 别在沙箱里跑 `pnpm install`，让用户在普通终端跑；② 要在沙箱内测某个依赖真实行为的模块，用 `npm install <pkg>` 在临时目录建**真实目录**布局，再把 `lib/`+`test/` 拷进去跑（见 §4）；③ 链接被上一次安装写坏时，`readlinkSync` 仍可用，用它重建 junction 即可恢复。 |

## 7. 发布

推一个 `dsh-hiss-plugins@<版本>` tag 即可（CI 见 [`.github/workflows/publish.yml`](.github/workflows/publish.yml)）：

```powershell
git tag dsh-hiss-plugins@1.4.0        # 必须与 dsh-hiss-plugins/package.json 的 version 逐字一致
git push origin dsh-hiss-plugins@1.4.0
```

- 工作流在 **Windows runner** 上跑（git-bash 只在 Windows 上解析得出来，测试固件也按 Windows 路径语义断言；ubuntu 上这些断言不可能通过），CI 固定 pnpm 12.3.4 / Node 24：解析 tag → `pnpm install --frozen-lockfile` → `pnpm test` → registry 上没有该版本时，在 tag 指向的目录里 `npm publish`（**npm trusted publishing / OIDC，无需任何 token/secret**；包内 `prepublishOnly` 还会再跑一次该包自己的测试）。已发布的版本会跳过发布（幂等）。
- tag 已存在但需要重跑：`gh workflow run publish.yml --ref <tag>`（`workflow_dispatch`）。
- tag 名里没有的包不会被发布；tag 与 manifest 不一致、或目录不存在时，工作流在发布前就失败（可先本地验一遍：`node scripts/resolve-tag.mjs dsh-hiss-plugins@1.4.0`）。
- **首次使用前**，在 npmjs.com 上为 `dsh-hiss-plugins` 配置一次 trusted publisher：Package → Settings → Trusted Publisher → GitHub Actions，填组织 `hilariouhiss`、仓库 `dsh-hiss-plugins`、workflow 文件名 `publish.yml`。配好之后 CI 不再需要 `NPM_TOKEN`。
- 手工发布（不走 CI，需先 `npm login`）：`pnpm run publish:dsh-hiss-plugins`。

## 8. 装坏的 profile 怎么恢复

```powershell
dsh plugin --profile web remove dsh-hiss-plugins   # 先让 dsh 能起来
dsh plugin --profile web add    dsh-hiss-plugins@latest
```

若 `dsh` 已完全无法启动，直接删掉 profile 里被 hoist 的旧副本再重启：
`Remove-Item -Recurse ~/.dsh/profiles/web/node_modules/@deepseek-ai`（该目录本应由上一层
`~/.dsh/profiles/node_modules` 的安装镜像提供）。

开关写坏了（某个功能点不开、或关了又回来）：看 profile 的 `cordis.patch.yml`，里面是对应行的
`- id: dsh-hiss-plugins-<feature>` + `disabled: ...` 覆盖；删掉那条覆盖即回到 patch 里的默认值
（git-bash 行的默认值由平台决定：非 win32 默认 `disabled`）。

## 9. "完成"的定义

- 测试全绿（看得见输出）＋ 对应断言同步更新 ＋ 逐条对照 §3 不变量 ＋ README/版本号一并更新。没做到就**如实说没做到**，不要用模糊措辞掩盖。
