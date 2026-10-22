# dsh-hiss-plugins

一个 DeepSeek Harness **bundle 插件**，把七个功能装在一个包里：**colgrep**（语义代码检索）、**codegraph**（代码图 MCP）、**project-mcp**（项目 `.mcp.json`）、**git-bash**（Windows 上的 Git Bash shell）、**superpowers**（superpowers 技能常驻引导）、**ponytail**（ponytail 采纳提示与 `/ponytail` 等级切换）、**init**（读项目生成 `AGENTS.md`）。七个功能各占一条顶层行，可以在 **Plugins 页**里单独开关；包还带一个管理标签，就挂在那个页面上。

安装后对 `web`、`headless` 等任意 profile 的**所有 preset、所有会话**生效。

## 八条行与七个开关

`cordis.patch.yml` 只做一件事：`insert` 八条**顶层行**。宿主用 `name`（模块说明符）解析模块，用 `id` 记住开关状态。

| 行 id | 模块 | 作用 | 默认 |
|---|---|---|---|
| `dsh-hiss-plugins` | `dsh-hiss-plugins` | 载体行：空的 host 半，只为让浏览器半（`lib/client.js`，即管理标签）被送出 | 开 |
| `dsh-hiss-plugins-colgrep` | `dsh-hiss-plugins/colgrep` | `colgrep` 模型工具（语义检索，`root` 可指定项目） | 开 |
| `dsh-hiss-plugins-codegraph` | `dsh-hiss-plugins/codegraph` | 经 MCP 注册 `mcp__codegraph__*` 工具 + 使用引导 | 开 |
| `dsh-hiss-plugins-project-mcp` | `dsh-hiss-plugins/project-mcp` | 读会话项目根的 `.mcp.json`，把其中的 MCP server 挂进该 agent 自己的 scope | 开 |
| `dsh-hiss-plugins-gitbash` | `dsh-hiss-plugins/gitbash` | Windows 上接入 Git Bash：提供 `ctx.shell` + 宿主 `bash` 工具 | 非 Windows 关 |
| `dsh-hiss-plugins-superpowers` | `dsh-hiss-plugins/superpowers` | superpowers 技能常驻引导：任何回复前先检查有没有适用的技能，有就先加载（技能集本身由 DSH 原生发现） | 开 |
| `dsh-hiss-plugins-ponytail` | `dsh-hiss-plugins/ponytail` | ponytail 采纳提示（随等级变化）+ 宿主 `/ponytail` 等级命令 | 开 |
| `dsh-hiss-plugins-init` | `dsh-hiss-plugins/init` | 宿主 `/init` 命令：读项目、生成/更新 `AGENTS.md` | 开 |

**七条功能行就是 Plugins 页里那七个开关。** 载体行不在标签的开关列表里 —— 它是空的 host 半，但只有它在，浏览器半才会被送进页面；关掉它，管理标签本身就没了。

为什么必须是顶层行：插件管理器只为「组合后的 patch 里存在同 `id`、同 `name`，且挂载后父 entry 就是 profile 的 `include`」的行持久化开关。包在 `cordis:group` 里的子行在 `listPlugins()` 里被判为 `unaddressable`，**永远不会有开关**。所以这里没有组：git-bash 行把 realm 隔离写在自己身上（见下）。

## 开关如何持久化

管理标签通过 host 的 `pluginManager` 远程调用读写开关：

- 取行：`await ctx.remote.pluginManager.listPlugins()`；写开关：`await ctx.remote.pluginManager.setPluginEnabled(entryId, enabled)`。
- 宿主把 `{ id: <行 id>, disabled: <bool> }` 覆盖写进 **profile 自己的** `cordis.patch.yml`（保留注释、原子写）—— 只影响这个 profile，不动包内的 `cordis.patch.yml`，所以升级/重装不会丢开关。
- **带 HMR 的 profile 立即生效**（远程结果 `application: "applied"`）；**没有 HMR 的 profile 返回 `application: "restart-required"`（`restartReason: "no-hmr"`），重启 dsh 才生效**。
- 行不可开关时，`listPlugins()` 会给出 `readOnlyReason`：`unaddressable`（不是顶层行 / 名字对不上）或 `management-required`（插件管理器自己的行或受保护模块）。
- 关掉一条功能行只是让那条行不激活：另外六条行不受影响，管理标签仍在（载体行开着）。

## 安装 / 卸载

```powershell
dsh plugin --profile web add dsh-hiss-plugins
# 或从本仓 checkout：dsh plugin --profile web add link:./dsh-hiss-plugins
```

把 `web` 换成你的 profile 名（例如 `headless`），然后**重启 dsh**。`dsh plugin` 会把本包装进 profile 的 `node_modules`；因为 `package.json` 声明了 `dsh.bundle.patch`，profile 的 bundle 列表会自动追加 `dsh-hiss-plugins`，重启后八条行一起激活。

```powershell
dsh plugin --profile web remove dsh-hiss-plugins
```

也要重启。单个功能不想用，不必卸载：在 Plugins 页里关掉那一行即可。

## 管理标签（浏览器半）

Plugins 页（侧边栏 **插件**）里多出一个 `dsh-hiss-plugins` 标签，列出上面七条功能行与它们的开关。

- 浏览器半是 **`lib/client.js`** —— 手写的 lazy-CJS bundle，没有构建步骤：`window.__ModuleLoader__.load({ id: "dsh-hiss-plugins", factory })` 只注册工厂，模块体（slot 注册、locale 字典）在首次被 require 时执行。`id` 必须逐字等于包名（客户端图里的行 id 就是包名）。
- `package.json` 里 `dsh.client.platform = "web"`、`exports["./client"]` 指向 `lib/client.js`；客户端模块系统按 Loader 行扫描，**只有本包有行挂载，这个文件才会被送进浏览器**。
- 标签注册进 Plugins 页声明的 `plugins.tab` list slot（`ctx.slots.inject("plugins.tab", …)`），排在页面自己的「已安装」标签之后；文案来自包内的 `locale/*.json`。
- `exports.inject` 是浏览器侧**服务名**（`slots`、`locale`、`remote`、`remote.pluginManager`）；远程调用形如 `ctx.remote.<命名空间>.<方法>`，命名空间就是 host 侧服务名。
- `dsh.client.inject` 列的是**其它浏览器半的包名**（`@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-client-modules`）—— 浏览器侧的图依赖，不是 npm 依赖。

## git-bash 行为什么自带 realm 隔离

`dsh-hiss-plugins-gitbash` 这一行写着自己的 `isolate`：

```yaml
- id: dsh-hiss-plugins-gitbash
  name: 'dsh-hiss-plugins/gitbash'
  disabled: !!js process.platform !== 'win32'
  isolate:
    shell: true
    settings: true
```

- **为什么不替换宿主的 `shell` 行**：`ctx.shell` 在 Windows 上已由 `pwsh-sandbox` 提供。替换它会连 `pwsh` 工具一起劫持（一个跑 bash 的 PowerShell 工具），并使所有声明 `tool-pwsh` 的预设失效。`isolate: { shell: true }` 让 loader 给这一行一份**私有** `shell` 实例：宿主的 `pwsh-sandbox` 继续供给根 realm，所有既有行与预设解析到的还是它。
- **为什么 `bash` 工具必须待在同一个 realm**：`@deepseek-ai/dsh-tool-bash` 消费 `ctx.shell`，留在 provider 的 realm 之外会解析到宿主的 pwsh 执行器，`bash` 工具就跑成了 PowerShell。这一行的模块同时挂执行器与这个工具，两半共用一个 realm。
- **为什么连 `settings` 一起隔离**：执行器继承 `dsh-bash-sandbox` → `dsh-bash-local`，其构造函数会注册共享的 `shell` 设置命名空间；宿主执行器已经注册过，而 `ctx.settings.register` 对重复注册是 fail loud。隔离 `settings` 后这个执行器根本看不到注册表、不注册任何命名空间，设置界面里的 `shell` 段仍归宿主执行器。
- **为什么是一个顶层行而不是一个 realm 组**：组里的子行对插件管理器不可寻址，永远拿不到开关（见上）。所以隔离写在这一行自己的 `isolate` 上。
- 行上的 `disabled: !!js process.platform !== 'win32'` 只在非 Windows 上默认禁用；它是 `!!js` 值，宿主写开关覆盖时不会与它比较，所以用户在 Windows 上的显式开关照样持久化。

## 功能：colgrep

以 DSH **bundle 插件**形式提供一个宿主侧模型工具 `colgrep`，把 [colgrep](https://github.com/lightonai/next-plaid/tree/main/colgrep)（LightOn 的语义代码检索工具：ColBERT 多向量搜索，按“含义”而非“精确文本”找代码）接进来。

```text
colgrep "error handling for database connections"
colgrep "auth" -e "async fn" --include "*.rs"
colgrep command:"init" / command:"status" / command:"clear"
```

工具参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `query` | string（必填） | 自然语言查询 |
| `command` | enum `search`(默认)/`init`/`status`/`clear` | 检索 / 建索引 / 查状态 / 清索引 |
| `root` | string | 检索/索引哪个项目（默认工作区根；可绝对路径或相对工作区解析） |
| `path` | string | `root` 内的检索目标（默认整个 `root`）。注意：colgrep 会回落到项目索引，所以它是「聚焦」而非硬过滤 —— 要硬收窄请用 `include` / `pattern` |
| `top_k` | integer | 结果数（`-k`，默认 15） |
| `pattern` | string | 正则预筛（`-e`，hybrid：先 grep 再语义排序） |
| `include` | string | 只检索匹配 glob 的文件（`--include`，如 `"*.rs"`） |
| `code_only` | boolean | 只检索代码文件，跳过 md/txt/yaml/json 等 |
| `no_update` | boolean | 跳过自动重建索引，直接检索现有索引 |

行为要点：

- 结果以 `--json` 解析后折叠为紧凑可读文本（`文件:行-行 [语言, 类型, 名称] (score)` + 首行签名），不倾倒整段代码；模型可再 `read` 具体文件。解析兼容顶层数组与 `{results:[...]}` 两种 JSON 形状；`query` 为空或纯空白时返回明确错误。
- **索引留在工作区内**：DSH 文件沙箱禁止写工作区之外，而 colgrep 检索需要写索引锁文件。插件把索引目录重定位到 `<工作区>/.colgrep-data`（通过 `COLGREP_DATA_DIR`），使全部写入落在沙箱允许范围内。ColBERT 模型与 ONNX runtime 从 `~/.cache` 只读加载，无需联网。
- **显式根目录**：`root` 只改变检索**运行的位置**（`workdir`），不改变索引位置 —— 索引数据始终留在当前工作区的 `.colgrep-data`，因为 colgrep 的索引是**按项目注册的**（`<data_dir>/indices/<项目名>-<hash>`），一个数据目录可以同时容纳多个项目的索引，跨项目检索不会把数据写到别人的仓库里。**真正限制结果范围的是 `root`**（换项目）；`path` 相对 `root` 解析（无 `root` 时相对工作区），只做聚焦、不保证排他。
- 首次检索会自动建立索引（CPU 上大仓库可能需数分钟）；可用 `command:"init"` 显式建索引，`no_update:true` 走现有索引。
- **主动使用**：注册 `colgrep:guidance` 提示词段（每回合重算，带上当前会话工作区路径），让模型在「按含义找代码、但说不出确切标识符」时优先用 `colgrep` 而不是 grep。

前置要求：

- 已安装 [colgrep](https://github.com/lightonai/next-plaid/tree/main/colgrep) CLI（`cargo install colgrep` 或官方预编译二进制），且 `colgrep` 在宿主进程的 PATH 上。
- 首次使用前，colgrep 需已下载默认模型 `lightonai/LateOn-Code-edge`（`colgrep "任意查询"` 会自动下载；私有模型需 `HF_TOKEN`，可用 `colgrep set-model` 切换）。

验证：重启后让模型调用 `colgrep`（例如“用 colgrep 搜索 error handling 相关代码”），或执行 `colgrep command:"status"` 看当前工作区的索引状态。

## 功能：codegraph

把 [codegraph](https://github.com/colbymchenry/codegraph)（本地优先的代码图 / 知识图谱）接进来：插件用宿主内置的 MCP 客户端桥（`@deepseek-ai/dsh-mcp-client`）加载 CodeGraph 的 MCP server（`codegraph serve --mcp`，serverName `codegraph`），注册 **`mcp__codegraph__codegraph_explore`** 工具 —— 一次调用返回相关符号的逐字源码（按文件分组）、符号间调用链（含动态分派跳转）与影响范围（blast radius）。

- 注入 `codegraph:guidance` 提示词段（每回合重算），让智能体对结构性问题（「X 如何工作」「X 如何到达 Y」「改某处会影响什么」）**优先直接调 `codegraph_explore`**，而不是 grep/逐文件读，并**传 `projectPath`** 指向当前工作区（引导文本里带当前会话工作区的绝对路径）。
- 引导段每回合检查当前工作区是否已有 `.codegraph/`：**没有**时多注入一句，带上可直接执行的 `codegraph init -y`，让智能体先建图再检索，而不是撞一次「无索引」错误。
- MCP server 以 `failOnStartupError: false` 加载：`codegraph` CLI 不在 PATH 上时，这一行的其它注册照常，工具缺席而不是把插件树拖垮。

前置要求：

1. 全局安装 CodeGraph CLI（`codegraph` 需在 DSH 宿主进程的 PATH 上）：

   ```powershell
   npm i -g @colbymchenry/codegraph
   # 或：irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex
   ```

2. 每个项目首次建图（生成 `.codegraph/` 索引；之后 MCP server 的 watcher 自动增量同步）：

   ```powershell
   cd <your-project>
   codegraph init
   ```

已知问题与限制：

1. **模型仍需手动传 `projectPath`（部分缓解）**：DSH 宿主是单实例、多会话（多工作区），而 mcp-client 的 `cwd` 是宿主面静态配置（`process.cwd()`）。`codegraph_explore` 无法默认指向「当前会话工作区」，模型每次调用仍要自己填 `projectPath`；引导文本已动态注入当前会话工作区的绝对路径来降低漏填/填错概率，但工具本身仍未自动注入。理想做法是包装一个能自动注入会话 `cwd` 的工具，或让 server 按会话定位项目。
2. **自动同步只覆盖 MCP server 默认目录的项目**：codegraph 的文件 watcher 只持续监视 MCP server 启动 `cwd` 对应的项目（在 DSH 里即 `dsh` 进程的工作目录）；经 `projectPath` 查询的其它项目没有持续 watcher，索引不会随编辑自动刷新，需手动 `codegraph sync`。因此当**会话工作区 ≠ dsh 启动目录**时，该仓库的索引不会自动跟进。对策：在目标仓库目录里启动 `dsh`，或手动 `codegraph sync`。
3. **不代建索引**：插件不后台跑 `codegraph init`。项目完全没建过图时，由**引导段提示模型自己执行** `codegraph init -y`（一行提示，零后台进程；`.codegraph/` 存在后该提示自动消失）。

## 功能：project-mcp

让 DSH 自动加载**项目目录下的 `.mcp.json`**（Claude Code 用的那个格式），把它声明的 MCP server 挂到**当前会话**上。在 `<项目根>/.mcp.json` 里写一次，之后在该项目里开的每个会话都自带这些 MCP 工具（`mcp__<server>__<tool>`），换个项目就换一套，互不干扰。

- **按会话加载**：会话的 `session.header.cwd` 决定读哪份 `.mcp.json`；只在会话自己的 scope 里挂载（`agent.ctx.plugin(McpClient, config)`），会话结束即拆除。
- **零冲突**：`serverName` 只在一个 agent scope 内要求唯一，所以两个项目可以有同名 server，不需要改名、不需要引用计数。
- **子 agent 自动继承**：subagent 的 scope 挂在父 agent 下，项目 MCP 工具对它自然可见，不会重复起进程。
- **首轮即生效**：挂载发生在 `agent/created`（宿主会 await 这个监听器）里，会话第一次对话就能看到工具；插件 reload 时也会给已经活着的 agent 补挂一次。
- **${VAR} 展开**：`${TOKEN}` / `${TOKEN:-默认值}` 在挂载时用宿主进程环境求值，`.mcp.json` 里不必写明文密钥。
- **失败不致命**：坏 JSON、不支持的 transport、起不来的 server 都只影响它自己，打一条 warn，会话照常开。
- **`/mcp` 看状态**：在本项目的会话里执行 `/mcp`，逐条列出 `.mcp.json` 声明的 server 与其实时状态 —— `connected, N tools`（MCP 桥连上并同步工具后才注册工具）、`no tools`（没连上，或 server 本身不暴露工具）、`skipped`（条目映射不了）、`unusable`（宿主 MCP 桥的 schema 拒绝）；另外报告本会话里来自项目外配置的 MCP 工具总数。状态读的是当前 agent 自己的工具表，所以列的是**此刻真正可用**的工具；命令不接受参数。

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

工作原理：`agent/created` → 会话 cwd → 向上找 `.mcp.json`（止于含 `.git` 的项目根）→ 解析 `mcpServers`、逐条映射成 `dsh-mcp-client` 的 config → 用宿主自己的 `McpClient.Config(...)` schema 校验 → `await agent.ctx.plugin(McpClient, config)` 挂进该 agent 的 scope。

验证：在某个项目根放一份 `.mcp.json`，重启 dsh，在该项目里开会话；执行 `/mcp` 看每个 server 的实时状态，问模型「列出你能用的 mcp 工具」，或直接调用 `mcp__<server>__<tool>`。宿主日志里能看到 `project-mcp: mounted N server(s) for <agent id>`。

安全边界：

**`.mcp.json` 是可执行代码载体。** stdio 条目的 `command` 会在 DSH 宿主进程里被 spawn，拥有宿主的权限。只在你信任的仓库里放这个文件；`git clone` 下来的第三方项目自带的 `.mcp.json` 等价于让它执行命令。本插件做的是：用宿主 MCP 桥自己的 schema 校验每一条配置（名字非法、字段类型错、transport 不支持都拒绝），逐条隔离失败，并且**只**读会话 cwd 及其祖先目录里的 `.mcp.json`（越过 git 根就停），不读用户层、不读 `~/.claude.json`。

已知限制：

1. **不热重载**：改完 `.mcp.json` 要开新会话（或重启 dsh）。已存在的会话仍用挂载时的配置。
2. **每个会话一套连接**：多会话同时开在同一项目会各起一份 MCP server 进程。
3. **不支持 `sse`**：宿主 MCP 桥只支持 `stdio` 与 `streamable-http`，`sse` 条目会被跳过并告警。
4. **只看 `.mcp.json`**：不读 `.dsh/mcp.yml`、用户层配置或 `~/.claude.json`。
5. **`/mcp` 只列本项目声明的 server**：项目外（profile / preset 里）配置的 MCP server 只计入末尾的工具总数，不列名字 —— 宿主没有公开这些行的配置，公开的工具名也按设计不可反解出 server 名。

## 功能：git-bash

在 Windows 上把 **Git Bash** 接入 DSH，成为一个一级 shell：注册 `bash` 模型工具（`bash -c`），由 Git for Windows 的 `bash.exe` 真实执行（工具进入 global `tools` 层，与其它功能同机制）。

**为什么需要它**：Windows 上 DSH 自带的 shell 工具是 `pwsh`（PowerShell）；想让智能体跑 shell 脚本、`grep`/`sed`/`ls` 那一套，需要 bash。而 Windows 上直接找 `bash` 有两个坑：① PATH 上的 `bash` 通常是 **WSL** 的 `C:\Windows\System32\bash.exe` —— 它跑在 Linux 虚拟机里，`cwd`、路径、文件系统全都不是 Git Bash 的那一套；② DSH 在 Windows 上的文件沙箱用**受限令牌**（write-restricted token）包裹每条命令，而 MSYS2 运行时启动时需要创建带用户 SID 的命名对象，受限令牌必然拒绝。本插件解决第 1 点（解析出真正的 Git for Windows `bash.exe`），并如实登记第 2 点的后果。

**三种权限模式下的行为**：宿主原有的三档权限模式语义完全不变 —— 本插件不替换 `pwsh-sandbox`，不改任何沙箱行，`pwsh` 工具与文件沙箱一切照旧。差别只在于 `bash` 工具能在哪一档下真正跑起来：

| 会话权限模式 | `bash` 工具的行为 | `pwsh` 工具 |
|---|---|---|
| 完全权限 `danger-full-access` | 直接运行 Git Bash（不套沙箱），一切正常 | 照旧 |
| 工作区内修改 `workspace-write` | MSYS2 无法在受限令牌下启动 → 结果返回 `[sandbox: file access denied under workspace-write mode]` 与升级提示；模型可用 `sandbox_permissions: "danger-full-access"` + 一句 `justification` **单次升级**（走正常审批），批准后 Git Bash 真正执行 | 照旧（受限、可用） |
| 仅可查看 `read-only` | 同上（受限令牌一样无法启动 MSYS2），升级路径相同 | 照旧 |

也就是说：**想不受打扰地用 Git Bash，就把会话权限切到「完全权限」**；留在受限模式时，PowerShell 仍是可用的受限 shell，Git Bash 通过按次审批的升级路径使用。这是沙箱的边界，不是插件的取舍 —— 插件不绕过它。受限模式下 `bash` 调用失败时的真实 stderr 形如：

```text
      0 [main] bash (16432) C:\Software\Git\bin\..\usr\bin\bash.exe: *** fatal error -
      couldn't create signal pipe, Win32 error 5
[sandbox: file access denied under workspace-write mode]
```

插件把这条启动失败**登记为沙箱拒绝特征**（该行文本 + 非零退出码），因此框架会用标准拒绝面与同轮升级提示呈现它，而不是抛一个看不懂的崩溃；同时在 stderr 末尾追加一句成因说明。

**前置要求**：Windows（非 win32 平台该行默认禁用，零影响）；已安装 [Git for Windows](https://git-scm.com/download/win)，且能按下列任一方式被解析到：

1. 环境变量 `DSH_GIT_BASH` 指向 `bash.exe`（优先级最高，非标准/便携安装用这个）；
2. 环境变量 `GIT_ROOT` / `GIT_INSTALL_ROOT` 指向安装根目录；
3. PATH 里有 `<安装根>\cmd\git.exe`（Git for Windows 默认安装会加）；
4. 默认安装位置：`%ProgramFiles%\Git`、`%ProgramFiles(x86)%\Git`、`%LOCALAPPDATA%\Programs\Git`。

解析只认 Git for Windows 的目录结构（`bin/bash.exe` 旁边有 `cmd/git.exe` 或 `usr/bin/bash.exe`），所以 `System32`、`WindowsApps` 里的 WSL 启动器**永远不会**被当成 Git Bash。`DSH_GIT_BASH` / `GIT_ROOT` 指错了会直接报错而不是悄悄回退 —— 避免跑成另一个 shell。

解析成功时执行器输出一行 info 级日志（形如 `confined shell git bash = <路径>`，是否出现取决于该 profile 的日志等级）。解析失败则**启动即报错、插件树不加载**（fail loud，不会悄悄回退到别的 shell），错误里点名 `dsh-hiss-plugins-gitbash` 这一行与失败原因（例如 `DSH_GIT_BASH points at a missing file: C:\Definitely\Not\Here\bash.exe`）。

验证：任一会话里让智能体执行 `bash -c "uname -o; pwd"`。完全权限下应返回 `Msys` 与 `/c/...` 形式的路径（WSL 会是 `GNU/Linux` 与 `/mnt/c/...`）。

**配置**：只有两个环境变量（在启动 dsh 之前设置），没有配置文件。

| 变量 | 作用 |
|---|---|
| `DSH_GIT_BASH` | 直接指定要执行的 `bash.exe`（最高优先级） |
| `GIT_ROOT` / `GIT_INSTALL_ROOT` | 指定 Git for Windows 安装根目录 |

**工作原理**（细节见 `cordis.patch.yml` 与该行的模块）：`lib/gitbash/index.js` 是一个组合根 —— 它把执行器（`createGitBashExecutor(SandboxBashExecutor)`，注册 `ctx.shell`）与宿主 `bash` 工具（`@deepseek-ai/dsh-tool-bash`，消费 `ctx.shell`）一起挂进这一行自己的 realm。执行器继承 `dsh-bash-sandbox` 的 `SandboxBashExecutor`（复用 DSH 自己的沙箱分类、后台进程事实、超时/溢出/清理机制），只覆写三处（接缝名自 0.1.7 起为 `execute` / `executeArgv`，`confine` 为异步三参；`test/gitbash/` 打到真实基类，把这三个接缝钉在当前运行时代次 `0.2.1-alpha.4` 上）：

- `confine()`：把继承来的 `bash` 换成解析出的绝对路径，并把 MSYS2 启动失败追加进 `denialSignatures`。提供方的 `ctx.sandbox.confine` 是**异步**的且接受取消信号，所以这里必须 `await` 并把信号透传（把 Promise 当对象展开会丢掉整个 argv）；前台与后台都经这条路径分类，判定一致。
- `executeArgv()`：`danger-full-access` 下父类**不走** `confine()`，而是自己拼一个字面量 `bash -c` 的 argv —— Windows 上那正是 WSL 启动器，所以在这个 argv 接缝上把裸 `bash` 换成解析出的路径（只重写数组形状的 `["bash","-c",cmd]`；受限路径交给 `confine()` 的是准备回调，原样通过）。
- `execute()`：公开入口解析出的是**进程句柄**而非结算结果，所以给受限模式的启动失败补成因说明要包在 `result()` 上。

**`0.2.1-alpha.4` 起的新依赖**：同一 realm 内消费 `ctx.shell` 的 `@deepseek-ai/dsh-tool-bash` 在这一代把 `workingDirectory` 加进了 `inject`（`resolveWorkdir` 改从 `await ctx.workingDirectory.ensure(agent, signal)` 取 cwd，工具输出 DTO 多了 `cwd`）。这一行只隔离 `shell` / `settings`，所以该服务仍从根 realm 解析（`dsh-base` 的 `working-directory` 行）—— 根 realm 里没有它时，`bash` 工具会**静默不激活**（`inject` 不满足的行只是不启动，不报错）。

**排错**：

| 症状 | 处理 |
|---|---|
| 启动日志报 `no Git for Windows installation found` | 装 Git for Windows，或设 `DSH_GIT_BASH` 指向 `bash.exe` |
| 日志报 `DSH_GIT_BASH points at a missing file` | 变量值写错了（要求完整文件路径，不是目录） |
| `bash` 工具每次都被判沙箱拒绝 | 正常：受限令牌无法启动 MSYS2。把会话切到「完全权限」，或让模型按提示单次升级（需审批） |
| 工具列表里没有 `bash` | 非 Windows 平台（该行默认禁用）；或执行器构造失败 —— 看启动日志里该行输出 |
| 想把 Git Bash 完全替代 PowerShell | 在你自己复制的 preset 里禁用 `tool-pwsh` 即可（本插件不替你做：受限模式下它就是唯一能跑的 shell） |

**限制**：

- **受限模式跑不了 Git Bash** —— MSYS2 与写受限令牌的冲突是操作系统层面的，插件不绕过。仅「完全权限」可直接运行。
- **不替换 PowerShell** —— `pwsh` 工具与文件沙箱保持原样；本插件是**新增**一个 bash shell。
- **后台任务失败时没有成因附加行** —— 拒绝标记与升级提示对前后台一致，但追加的那句成因说明只在前台结果里（后台读的是子进程原始增量）。
- **只解析常规 Git for Windows 布局** —— 便携版/自定义布局请显式设 `DSH_GIT_BASH`。
- **依赖宿主包内部接缝** —— 执行器继承 `dsh-bash-sandbox` 的 `confine(command, policy)`。DSH 升级若改动该形状，插件会失效（`test/gitbash/` 里的接线断言会在契约变化时暴露）。

## 功能：superpowers（常驻引导）

把 superpowers 技能集的**常驻引导**接回来：只注册一个全局提示词段 `superpowers:adoption`（`order: 5`，排在人格前缀之后、各策略与工具段之前）。段文本是上游 bootstrap 原文，外层包着 `<EXTREMELY_IMPORTANT>`；技能从插件里移出来后有两处必须改，也写在这里 —— 技能改用裸名寻址、技能集没装时忽略本段：

- **任何回复或动作之前**先检查有没有适用的 superpowers 技能，有就先调 `skill` 工具加载；
- 过程类技能（`brainstorming`、`systematic-debugging`）先于实现类技能；
- 技能用**裸 kebab-case 名**寻址（`brainstorming`、`writing-plans`、`test-driven-development`、`verification-before-completion`），不是上游的 `superpowers:<name>` 形式；
- 技能目录里没有任何 superpowers 技能时，忽略这一段；
- 完整指令在 `using-superpowers` 技能里，用 `skill` 工具加载。

没有技能 provider，没有命令。系统提示词每回合重新组装，所以这条常驻指令在上下文压缩之后依然在。

**技能本身由 DSH 原生发现**：它们就在被扫描的技能根里（`dsh-skill-filesystem` 的 `user-agents` 根，默认共享根 `~/.agents/skills`，rank 500），本插件不安装、不内置、不搬运任何技能文件。上游把「回答前先查技能」这条指令放进会话启动钩子，而 DSH 不读插件的 hook 文件 —— 缺的只有这条**常驻指令**，这也正是这个功能行存在的理由。

前置要求：superpowers 技能集装在一个 DSH 会扫描的技能根里（本机惯例是共享根 `~/.agents/skills`）。

验证：重启后给一个会命中 superpowers 技能的任务，看模型是否先调 `skill` 再动手。技能集没装时这段引导按它自己的判据被忽略，不影响其它行。

## 功能：ponytail（采纳提示与 /ponytail 等级切换）

把 ponytail 技能集的**等级状态**接回来：一个全局提示词段 `ponytail:adoption`（`order: 5`）加一个宿主命令 `/ponytail`。

- **提示词段随等级变化**：等级为 `off` 时文本是空串（等于不注入）；否则是采纳提示（任何编码任务 —— 写、改、重构、修、评审、选依赖 —— 先用 `skill` 工具加载 `ponytail` 技能并按它执行）再加当前等级。当前等级写进文本里，所以重启后默认等级重新生效时这段话仍然是真的。
- **`/ponytail` 命令**（本插件注册的宿主命令，跟同名的 `ponytail` 技能是两回事）：参数取 `lite` / `full` / `ultra` / `off`，不带参数等于 `full`。
  - `lite` / `full` / `ultra`：把该 agent 的等级设为这一档，**并立刻把渲染好的 `ponytail` SKILL.md 正文作为一条持久 user 消息交给模型**（下一步就读到），返回 `Ponytail mode set to <level>.`；
  - `off`：关掉该 agent 的等级，并注入一条「忽略 ponytail 指令」的消息，返回 `Ponytail off.`（不需要技能在场）；
  - 其它输入：返回用法错误 `Usage: /ponytail [lite|full|ultra|off]`，**不改任何状态**；
  - `ponytail` 技能缺失或读不出来：返回错误，**不改任何状态** —— 等级不能设在一个模型执行不了的技能上。
- **默认等级**按上游的顺序解析：`PONYTAIL_DEFAULT_MODE` 环境变量 → `%APPDATA%\ponytail\config.json`（非 Windows：`$XDG_CONFIG_HOME` 或 `~/.config` 下的 `ponytail/config.json`）里的 `defaultMode` → `full`。配置缺失、读不了、坏 JSON、值非法都不是错误，直接往下走。
- **等级状态在进程内、按 agent 分开（WeakMap），不落盘**：`/ponytail` 的设定在 dsh 重启后回到默认等级；要持久就写环境变量或配置文件。
- 输入框里敲 `/` 会出现**两条 `ponytail`**：宿主命令（本插件注册，用来切等级）和 `ponytail` 技能（DSH 原生发现，用来加载技能正文）；`/ponytail-review` 这类手势本来就由 `dsh-tool-skill` 原生处理。

**技能本身由 DSH 原生发现**：`ponytail`、`ponytail-review` 等技能就在被扫描的技能根里（默认共享根 `~/.agents/skills`，rank 500），本插件不安装、不内置任何技能，也不为每个技能注册命令。缺的只有等级 —— 一个让技能持续在线的常驻提示，和一个改变它施加力度的开关。

前置要求：`ponytail` 技能装在一个 DSH 会扫描的技能根里（本机惯例是共享根 `~/.agents/skills`）。

验证：`/ponytail ultra` 后给一个编码任务，模型应加载 `ponytail` 技能并按 ultra 档执行；`/ponytail off` 后该提示词段变空。

## 功能：init（读项目生成 AGENTS.md）

注册宿主命令 **`/init`**：把一条固定的、面向仓库调研的指令作为持久 user 消息交给模型，让智能体先读项目、再在项目根写 `AGENTS.md`。插件本身不读文件、不生成内容 —— 阅读、检索、写入都走智能体已有的工具，指令的质量就是功能的全部。

- **目标位置**：从会话工作目录向上找最近的、含 `.git` 的祖先目录作为项目根，写 `<项目根>/AGENTS.md`；找不到 `.git` 时用工作目录本身。
- **已有文件按增量合并**：先读 `AGENTS.md`，保留仍然正确的内容与维护者手写的规则，只删除错误或重复的部分并说明删了什么。没有 `AGENTS.md` 但有 `CLAUDE.md` / `AGENT.md` 时，读它作为上下文、新建 `AGENTS.md`，不改写旧文件。
- **命令必须有证据**：只允许记录 manifest、脚本、Makefile、CI 文件或文档里真实存在的命令；提示词明确禁止编造命令/路径/脚本名/版本，也禁止为了“发现”事实去跑安装、构建、测试、网络或破坏性命令。
- **结构**：项目概览、安装/首次运行、构建/测试/lint（含单测跑法）、架构地图、仓库特有约定、测试要求、Git/PR 规则、安全与陷阱；没有内容的段直接省略。目标 80–150 行，约 200 行是硬上限；用仓库现有文档的语言写；不写泛泛而谈的建议、不抄 README、不含密钥或个人路径。
- **完成前自检**：重新从磁盘读文件，逐条核对命令、路径、环境变量和配置名；确认文件回答了“怎么装、怎么验、核心代码在哪、什么不能碰”，并报告无法确认或刻意省略的内容。
- 命令**不接受参数**（`/init foo` 返回 `Usage: /init (no arguments)`），也不提交任何改动。
- 提示词在 `lib/init/prompt.js`（纯逻辑、无宿主导入），命令接缝在 `lib/init/index.js`（`commands` + `workingDirectory`，经 `invocation.agent.followup(createUserMessage(...))` 注入）。

前置要求：无 —— 只用宿主已有的 `commands`、`workingDirectory` 服务，以及 `@deepseek-ai/dsh-llm` 的 `createUserMessage`。

验证：在任意项目里执行 `/init`，模型应开始读仓库并写出 `AGENTS.md`；下一个会话由 DSH 的 `dsh-agent-instructions` 自动加载它。

## 开发与测试

```powershell
pnpm install
pnpm test      # 在包目录内也可：node --test-isolation=none --test
```

结构：

```text
package.json          八条行的 bundle 声明（dsh.bundle.patch）+ 浏览器半声明（dsh.client）+ exports/files
cordis.patch.yml      八条顶层行（载体 + 七个功能）
lib/index.js          载体行：空 host 半
lib/client.js         浏览器半：Plugins 页管理标签（手写 lazy-CJS，无构建步骤）
lib/colgrep/          colgrep 工具
lib/codegraph/        codegraph MCP 桥 + 引导
lib/project-mcp/      lib/config.js 纯逻辑（无宿主依赖）+ lib/index.js 接线
lib/gitbash/          lib/resolve.js 纯逻辑 + lib/gitbash-executor.js 执行器 + lib/index.js 组合根
lib/superpowers/      常驻引导提示词段（只注册 systemPrompt 段，不导入宿主包）
lib/ponytail/         lib/mode.js 纯逻辑（等级解析与默认值）+ lib/index.js 提示词段与 /ponytail 命令
lib/init/             lib/prompt.js 纯逻辑（/init 指令正文）+ lib/index.js 命令接缝
locale/*.json         管理标签的文案字典
test/                 node:test：<feature>/ 七个目录 + manifest / patch / client 三个契约测试
```

`lib/project-mcp/config.js`、`lib/gitbash/resolve.js`、`lib/ponytail/mode.js` 与 `lib/init/prompt.js` 刻意不导入任何宿主包，所以这些纯逻辑分支可以在没有 dsh 安装的环境里完整跑测试；宿主接缝由各功能的 `index.js` 承担。浏览器半用 fake `window.__ModuleLoader__` + fake `ctx` 测注册与远程调用，不启动浏览器。测试全部离线，不联网、不依赖 `colgrep`/`codegraph` CLI。

## 发布（给维护者）

```powershell
git tag dsh-hiss-plugins@1.2.1        # 必须与本目录 package.json 的 version 逐字一致
git push origin dsh-hiss-plugins@1.2.1
```

CI（`.github/workflows/publish.yml`，Windows runner）解析 tag、跑全量测试，再用 **npm trusted publishing（OIDC，无需任何 token）** 发布；包内 `prepublishOnly` 会再跑一次 `npm test`。手工发布：`npm publish`（`publishConfig.access` 已设为 public），发版前先 `node ../scripts/smoke-profile.mjs` 走一遍真实安装 + 真启动。发布新版本前记得递增 `package.json` 的 `version`。

## 许可与来源

MIT，见 [LICENSE](LICENSE)。本包只调用外部的 `colgrep` 与 `codegraph` CLI（未内置它们的源码），通过 MCP 连接 CodeGraph、通过宿主 MCP 桥读取 `.mcp.json`；上游项目与许可分别见 [lightonai/next-plaid](https://github.com/lightonai/next-plaid)、[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)。沙箱行为、拒绝方言与升级流程均来自 DSH 自身（`@deepseek-ai/dsh-shell` / `dsh-bash-sandbox` / `dsh-sandbox-*`），git-bash 功能只提供执行器接线与 Git Bash 解析。

> `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-mcp-client`、`@deepseek-ai/dsh-bash-sandbox`、`@deepseek-ai/dsh-tool-bash`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-skill` 由**正在运行的 dsh 安装**提供，本包只在 `peerDependencies` 里声明（`devDependencies` 供本仓安装与测试）。**不要**把它们写进 `dependencies` —— 那会让 pnpm 往 profile 里塞一份自己的副本，遮蔽安装目录里的同名包，两代混装会让整棵插件树启动失败。升级 dsh 后先跑 `node ../scripts/smoke-profile.mjs` 再发版。
