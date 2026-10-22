# dsh-hiss-plugins

DeepSeek Harness (dsh) 插件仓库（pnpm workspace 单仓）：装一个包，得到七个可以单独开关的功能，外加 Plugins 页里的一个管理标签。

## 插件

| 包 | 说明 |
|---|---|
| [dsh-hiss-plugins](dsh-hiss-plugins)（npm: `dsh-hiss-plugins`，v1.2.1） | 一个 bundle，八条顶层行：一条载体行 + 七条功能行；七个功能各有一个开关，Plugins 页里逐行启停 |

七个功能（行 id 就是开关的持久化地址）：

| 功能 | 行 id | 需要什么 | 说明 |
|---|---|---|---|
| colgrep | `dsh-hiss-plugins-colgrep` | `colgrep` CLI 在 PATH 上 | 语义代码检索工具（按含义找代码，不要求拼得出标识符），源自 [lightonai/next-plaid](https://github.com/lightonai/next-plaid) |
| codegraph | `dsh-hiss-plugins-codegraph` | `codegraph` CLI 在 PATH 上，项目建过图 | 经 MCP 注册 `mcp__codegraph__codegraph_explore`（一次返回符号源码 + 调用链 + 影响范围），源自 [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) |
| project-mcp | `dsh-hiss-plugins-project-mcp` | 项目根有 `.mcp.json` | 自动加载项目目录下 `.mcp.json` 声明的 MCP server，按会话挂载、按项目隔离（Claude Code 的 `.mcp.json` 格式）；宿主 `/mcp` 命令逐条报告各 server 的实时工具状态 |
| git-bash | `dsh-hiss-plugins-gitbash` | Windows + Git for Windows | 把 Git Bash 接入为一级 shell（`bash` 工具，解析真正的 Git for Windows `bash.exe` 而非 PATH 上的 WSL 启动器；三档权限模式语义不变，受限模式下按标准升级路径使用）；非 Windows 默认禁用 |
| superpowers | `dsh-hiss-plugins-superpowers` | superpowers 技能集在被扫描的技能根里 | 常驻引导提示词段：任何回复前先检查有没有适用的 superpowers 技能，有就先加载（技能集本身由 DSH 原生发现，本包不安装技能） |
| ponytail | `dsh-hiss-plugins-ponytail` | `ponytail` 技能在被扫描的技能根里 | 采纳提示段（随等级变化）+ 宿主 `/ponytail` 等级命令（`lite`/`full`/`ultra`/`off`；默认 `full`，进程内按 agent 保存，不落盘） |
| init | `dsh-hiss-plugins-init` | 无（纯宿主命令） | 宿主 `/init` 命令：读当前项目并在项目根生成/更新 `AGENTS.md`；已有文件按增量合并，命令只写有证据的 |

细节（每个功能的前置要求、参数、限制）见 [dsh-hiss-plugins/README.md](dsh-hiss-plugins/README.md)。

## 安装

`dsh plugin` 是 pnpm 的透传（`dsh plugin --profile <p> add ...` 等于在 profile 目录里跑 `pnpm add ...`），装完会按**已安装状态**把声明了 `dsh.bundle.patch` 的依赖追加进 `dsh.profile.bundles`：

```powershell
# 从 npm 装
dsh plugin --profile web add dsh-hiss-plugins

# 从本仓 checkout 装（含尚未发布的改动；在仓库根目录执行）
dsh plugin --profile web add link:./dsh-hiss-plugins
```

装完重启 dsh。注意 profile 的 `pnpm-workspace.yaml` 带供应链策略（`minimumReleaseAge`）：**不写版本号时，刚发布的版本会被挡住**，解析到上一代。要立刻用新版本就显式写版本号（`dsh-hiss-plugins@1.2.1`），或把该版本加进 profile 的 `minimumReleaseAgeExclude`。

卸载用 `dsh plugin --profile web remove dsh-hiss-plugins`，然后重启。装坏的 profile 怎么救见 [AGENTS.md](AGENTS.md) §8。

## 管理标签（Plugins 页）

侧边栏 **Plugins**（插件）页里多出一个 `dsh-hiss-plugins` 标签，列出七条功能行和它们的开关：

- 开关经 host 的 `pluginManager` 远程写入 **profile 自己的** `cordis.patch.yml`（一条 `{ id, disabled }` 覆盖），只影响这个 profile；
- profile 带 HMR 时立即生效；没有 HMR 时接口返回 `restart-required`，重启 dsh 生效；
- 标签只列七条功能行 —— 载体行（`dsh-hiss-plugins`）是空的 host 半，它要存在，浏览器半才送得出来，所以别关它。

## 开发

```powershell
pnpm install   # 根目录一次安装，全仓共享
pnpm test      # 运行全部测试（离线）
pnpm smoke     # 真实安装 + 真启动冒烟检查（需联网 + pnpm + PATH 上的 dsh）
```

在 DSH 沙箱内 `pnpm test` 可能以 `spawn EPERM` 失败 —— 沙箱禁止带管道的子进程 stdio，而 `node --test` 要为每个测试文件 spawn 子进程；这是**环境限制，不是测试失败**，改在包目录内跑 `node --test-isolation=none --test`。

### 依赖约定

插件用到的 `@deepseek-ai/*` 由**正在运行的 dsh 安装**提供，只写进 `peerDependencies`；
`devDependencies` 写精确版本供本仓安装与测试。**绝不写进 `dependencies`** —— 那会让 pnpm
往 profile 的 `node_modules` 里塞一份自己的副本，遮蔽安装目录里的同名包；两代混装会在 ESM
链接期报错，连宿主自己的核心行一起炸掉，`dsh` 直接起不来。规则与症状见 `AGENTS.md` §3.4 与
§6；`test/manifest.test.js` 会守住这条不变量，`pnpm smoke` 能复现整类故障。

当前面向的运行时是 **`0.2.1-alpha.4`**，本包统一声明 `^0.2.1-alpha.4`（六个 peer 一次改齐）。注意 `^` 对预发布
版本的语义：`^0.1.5-rc.2`、`^0.1.7-alpha.1`、`^0.2.0-rc.2` 都**不**匹配 `0.2.1-alpha.4`（semver 只在元组相同时
放行预发布），所以换代次时**必须**同步改 `peerDependencies` 与 `devDependencies` —— 只留旧范围
会让 peer 解析失败。代码接缝（`ctx.shell.execute()`→`result()`、`ctx.sandbox.confine(argv,
policy, signal)`、`ctx.sandboxPolicy.resolve`、`ctx.tools.register`/`defineTool`、`ctx.plugin`）由守卫测试守住形状（最近一次已知变动是 0.1.7 的接缝改名，见 `AGENTS.md` §4）。

## 发布

推一个 `dsh-hiss-plugins@<版本>` tag 即可：CI（[`.github/workflows/publish.yml`](.github/workflows/publish.yml)，Windows runner）解析 tag、
跑全量测试，再用 **npm trusted publishing（OIDC，无需任何 token/secret）** 发布这一个包。

```powershell
git tag dsh-hiss-plugins@1.2.1        # 必须与 dsh-hiss-plugins/package.json 的 version 逐字一致
git push origin dsh-hiss-plugins@1.2.1
```

tag 名里没有的包不会被发布；tag 与 manifest 不一致、或目录不存在时，工作流在发布前就失败
（可先本地验一遍：`node scripts/resolve-tag.mjs dsh-hiss-plugins@1.2.1`）。

**首次使用前**，在 npmjs.com 上为 `dsh-hiss-plugins` 配置 trusted publisher：
Package → Settings → Trusted Publisher → GitHub Actions，填组织 `hilariouhiss`、仓库 `dsh-hiss-plugins`、
workflow 文件名 `publish.yml`。配好之后 CI 不再需要 `NPM_TOKEN`。

手工发布（不走 CI，需先 `npm login`）：

```powershell
pnpm run publish:dsh-hiss-plugins
```

## 新增功能

本仓只发一个包，新增的是**包里的功能行**：`lib/<feature>/` + `exports` 子路径 + `cordis.patch.yml` 里一条**顶层行** + 浏览器半的开关 + 测试。步骤与不变量见 [AGENTS.md](AGENTS.md) §5。
