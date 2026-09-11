# dsh-plugins

DeepSeek Harness (dsh) 插件集合仓库（pnpm workspace 单仓）。

## 插件列表

| 插件 | 说明 |
|------|------|
| [dsh-ponytail](dsh-ponytail)（npm: `@hilariouhiss/dsh-ponytail`） | Lazy senior dev 模式插件，源自 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |
| [dsh-colgrep](dsh-colgrep)（npm: `@hilariouhiss/dsh-colgrep`） | colgrep 语义代码检索插件（`colgrep` 工具，按含义而非精确文本找代码，需 `colgrep` CLI），源自 [lightonai/next-plaid](https://github.com/lightonai/next-plaid) |
| [dsh-codegraph](dsh-codegraph)（npm: `@hilariouhiss/dsh-codegraph`） | CodeGraph 代码图插件（MCP 集成，`codegraph_explore` 工具，需 `codegraph` CLI），源自 [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) |

## 共享依赖

[dsh-skill-kit](dsh-skill-kit)（npm: `@hilariouhiss/dsh-skill-kit`）是 `dsh-ponytail` 的运行时依赖：SKILL.md frontmatter 解析、目录型 skill provider、以及 `/命令 → 技能` 的注册逻辑。它是普通 npm 包（非 dsh 插件），必须先于插件发布。

## 开发

```powershell
pnpm install   # 根目录一次安装，全仓共享
pnpm test      # 运行所有包的测试（41 个，离线）
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
pnpm run publish:dsh-colgrep
pnpm run publish:dsh-codegraph
```
