# dsh-plugins

DeepSeek Harness (dsh) 插件集合仓库（pnpm workspace 单仓）。

## 插件列表

| 插件 | 说明 |
|------|------|
| [dsh-ponytail](dsh-ponytail)（npm: `@hilariouhiss/dsh-ponytail`） | Lazy senior dev 模式插件，源自 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |
| [dsh-superpowers](dsh-superpowers)（npm: `@hilariouhiss/dsh-superpowers`） | Superpowers 软件开发方法论插件（brainstorming、TDD、系统化调试、subagent 驱动开发等 14 个技能 + 会话引导），源自 [obra/superpowers](https://github.com/obra/superpowers) |
| [dsh-colgrep](dsh-colgrep)（npm: `@hilariouhiss/dsh-colgrep`） | colgrep 语义代码检索插件（`colgrep` 工具，按含义而非精确文本找代码，需 `colgrep` CLI），源自 [lightonai/next-plaid](https://github.com/lightonai/next-plaid) |
| [dsh-codegraph](dsh-codegraph)（npm: `@hilariouhiss/dsh-codegraph`） | CodeGraph 代码图插件（MCP 集成，`codegraph_explore` 工具，需 `codegraph` CLI），源自 [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) |
| [dsh-gitbash](dsh-gitbash)（npm: `@hilariouhiss/dsh-gitbash`） | Windows 上把 Git Bash 接入为一级 shell（`bash` 工具，解析真正的 Git for Windows `bash.exe` 而非 PATH 上的 WSL 启动器；三档权限模式语义不变，受限模式下按标准升级路径使用） |
| [dsh-taste-skill](dsh-taste-skill)（npm: `@hilariouhiss/dsh-taste-skill`） | 前端设计品味技能集（13 个技能：设计/改版/出图/图转码/品牌板/完整输出），源自 [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) |

## 共享依赖

[dsh-skill-kit](dsh-skill-kit)（npm: `@hilariouhiss/dsh-skill-kit`）是 `dsh-ponytail`、`dsh-taste-skill` 与 `dsh-superpowers` 的运行时依赖：SKILL.md frontmatter 解析、目录型 skill provider、以及 `/命令 → 技能` 的注册逻辑。它是普通 npm 包（非 dsh 插件），必须先于插件发布。

## 一次装齐全部插件

`dsh plugin` 是 pnpm 的透传（`dsh plugin --profile <p> add ...` 等于在 profile 目录里跑 `pnpm add ...`），装完会按**已安装状态**把声明了 `dsh.bundle.patch` 的依赖追加进 `dsh.profile.bundles`，所以一条命令就能装完，不需要手工改 bundles：

```powershell
# 从 npm 装（要求各包都已发布）
dsh plugin --profile web add @hilariouhiss/dsh-ponytail @hilariouhiss/dsh-colgrep @hilariouhiss/dsh-codegraph @hilariouhiss/dsh-gitbash @hilariouhiss/dsh-taste-skill @hilariouhiss/dsh-superpowers

# 从本仓 checkout 装（含尚未发布的包；在仓库根目录执行；自动跟随以后新增的插件目录）
dsh plugin --profile web add (Get-ChildItem -Directory -Filter "dsh-*" | Where-Object Name -ne "dsh-skill-kit" | ForEach-Object { "link:./$($_.Name)" })
```

装完重启 dsh。两点注意：

- **不要**把 `dsh-skill-kit` 加进命令：它是普通库（没有 `dsh.bundle`），会被装成普通依赖并打一条 `declares no dsh.bundle` 警告。三个技能插件都依赖它，pnpm 会自动带上。
- profile 的 `pnpm-workspace.yaml` 带供应链策略（`minimumReleaseAge`）：**不写版本号时，刚发布的版本会被挡住**，解析到上一代（例如 `dsh-ponytail` 装成 1.0.2 而不是 1.1.0）。要立刻用新版本就显式写版本号（`@hilariouhiss/dsh-ponytail@1.1.0`），或把该版本加进 profile 的 `minimumReleaseAgeExclude`。

## 开发

```powershell
pnpm install   # 根目录一次安装，全仓共享
pnpm test      # 运行所有包的测试（91 个，离线）
pnpm smoke     # 真实安装 + 真启动冒烟检查（需联网 + pnpm + PATH 上的 dsh）
```

### 依赖约定

插件用到的 `@deepseek-ai/*` 由**正在运行的 dsh 安装**提供，只写进 `peerDependencies`；
`devDependencies` 写精确版本供本仓安装与测试。**绝不写进 `dependencies`** —— 那会让 pnpm
往 profile 的 `node_modules` 里塞一份自己的副本，遮蔽安装目录里的同名包；两代混装会在 ESM
链接期报错，连宿主自己的核心行一起炸掉，`dsh` 直接起不来。规则与症状见 `AGENTS.md` §3.4 与
§7；`test/manifest.test.js` 会守住这条不变量，`pnpm smoke` 能复现整类故障。

已经装坏的 profile 恢复方式：

```powershell
dsh plugin --profile web remove @hilariouhiss/dsh-colgrep   # 先让 dsh 能起来
dsh plugin --profile web add    @hilariouhiss/dsh-colgrep@latest
```

若 `dsh` 已完全无法启动，直接删掉 profile 里被 hoist 的旧副本再重启：
`Remove-Item -Recurse ~/.dsh/profiles/web/node_modules/@deepseek-ai`（该目录本应由上一层
`~/.dsh/profiles/node_modules` 的安装镜像提供）。

## 添加新插件

1. 新建目录 `<plugin-name>/`，复制插件源码与 `package.json`，声明 `dsh.bundle.patch`（参见已有插件的 `cordis.patch.yml` 与 `package.json`）。
2. 将该目录加进根目录 `pnpm-workspace.yaml` 的 `packages` 列表。

## 发布

首次登录 npm（一次即可）：在任一包目录执行 `npm login`。

先发布共享依赖，再发布各插件：

```powershell
pnpm run publish:dsh-skill-kit
pnpm run publish:dsh-ponytail
pnpm run publish:dsh-superpowers
pnpm run publish:dsh-colgrep
pnpm run publish:dsh-codegraph
pnpm run publish:dsh-gitbash
pnpm run publish:dsh-taste-skill
```
