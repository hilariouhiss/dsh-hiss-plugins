# @hilariouhiss/dsh-openspec

把 [OpenSpec](https://github.com/Fission-AI/OpenSpec)（“AI-native spec-driven development”，先对齐要构建什么，再写代码）移植为 DeepSeek Harness 插件。

本插件以 DSH **bundle 插件**形式提供 12 个 workflow 技能 + 12 个宿主侧斜杠命令，安装后对 `web`、`headless` 等任意 profile 的所有会话生效。技能内容**逐字**来自上游的 `skills/*/SKILL.md`（v1.10.0），并沿用其 CLI 驱动方式。

## 前置依赖

OpenSpec 技能通过 `openspec` CLI 完成状态查询、产物生成、校验、归档与 spec 合并（如 `openspec new change`、`openspec status --json`、`openspec instructions --json`）。安装本插件前，先全局安装 CLI：

```powershell
npm install -g @fission-ai/openspec@latest
```

在目标项目里执行 `openspec init` 初始化 `openspec/` 目录后即可开始使用。

## 功能

| 命令 | 技能 | 作用 |
|---|---|---|
| `/opsx-propose` | `openspec-propose` | 一步创建 change 并生成全部规划产物（proposal/specs/design/tasks） |
| `/opsx-explore` | `openspec-explore` | 探索想法、澄清需求，提交 change 前的思考伙伴 |
| `/opsx-new` | `openspec-new-change` | 新建 change 脚手架，逐步推进 |
| `/opsx-continue` | `openspec-continue-change` | 按依赖顺序创建下一个产物 |
| `/opsx-ff` | `openspec-ff-change` | 快进：一次性生成全部规划产物 |
| `/opsx-apply` | `openspec-apply-change` | 从 tasks.md 逐条实现 |
| `/opsx-update` | `openspec-update-change` | 修订规划产物并保持相互一致（不改代码） |
| `/opsx-verify` | `openspec-verify-change` | 校验实现与产物是否一致 |
| `/opsx-sync` | `openspec-sync-specs` | 把 delta spec 合并进主 specs |
| `/opsx-archive` | `openspec-archive-change` | 归档已完成的 change |
| `/opsx-bulk-archive` | `openspec-bulk-archive-change` | 一次归档多个已完成的 change |
| `/opsx-onboard` | `openspec-onboard` | 在真实代码库上走一遍完整工作流的引导教程 |

行为要点：

- **系统提示词引导**：会话开始时注入一行轻量引导，提示模型在规格/规划类任务前用 `skill` 工具加载对应 `openspec-*` 技能。
- **命令注入**：执行任意 `/opsx-*` 命令会把对应技能内容作为用户消息注入会话（与内置 `/goal` 同一机制），模型下一步即可读到并按其指令经 `pwsh` 调用 `openspec` CLI。

## 安装

```powershell
dsh plugin --profile web add @hilariouhiss/dsh-openspec
```

把 `web` 换成你的 profile 名（例如 `headless`）。然后**重启 dsh**（关闭并重新运行 `dsh --profile web`，其他 profile 同理）。

`dsh plugin` 会把本包安装进 profile 的 `node_modules`；因为 `package.json` 声明了 `dsh.bundle.patch`，profile 的 bundle 列表会自动追加 `@hilariouhiss/dsh-openspec`，重启后插件行自动激活。

## 验证

1. 在 GUI 新建会话，输入任意内容后，会话目录应包含 12 个 `openspec-*` 技能。
2. 让模型“加载 openspec-propose 技能”，或直接输入 `/opsx-propose <描述>`，应能看到技能内容 / 命令执行结果。
3. 确保 `openspec --version` 可运行，且在目标项目里已 `openspec init`，随后 `/opsx-apply`、`/opsx-archive` 等命令中的 CLI 调用才能生效。

## 卸载

```powershell
dsh plugin --profile web remove @hilariouhiss/dsh-openspec
```

然后重启 dsh。

## 本地覆盖

若你在 `~/.dsh/skills/` 或项目 `.dsh/skills/` 放了同名技能，DSH 会优先使用本地副本（技能注册表的层级语义），可用于定制 OpenSpec 行为。

## 开发

```powershell
pnpm install
pnpm test
```

结构：

```
lib/index.js        插件入口:apply(ctx) 注册 provider + 提示词 section + 12 命令
lib/commands.js     12 个 /opsx-* 命令
skills/             12 个技能目录(上游 SKILL.md 逐字复制，含 allowed-tools/metadata 等键)
cordis.patch.yml    bundle patch:插入本插件的宿主行
test/               node:test 单元测试
OpenSpec/           上游 clone(参考用,不发布)
```

## 发布（给维护者）

```powershell
cd dsh-openspec
pnpm install
pnpm test
npm login       # 首次发布前登录 npm
npm publish     # publishConfig.access 已设为 public
```

发布后其他用户即可：

```powershell
dsh plugin --profile web add @hilariouhiss/dsh-openspec
```

`prepublishOnly` 会在每次发布前自动运行 `npm test`；发布新版本前记得递增 `package.json` 的 `version`。

## 许可与来源

本插件为 MIT 许可。技能内容（`skills/**`）逐字来自 [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) v1.10.0（© OpenSpec Contributors，MIT）。

> 提示：若日后升级 dsh 后 `@deepseek-ai/dsh-skill` / `@deepseek-ai/dsh-llm` 的公开 API 发生变化，需同步更新本插件的依赖版本；上游 OpenSpec 的 CLI 命令/产物格式变化时，需重新同步 `skills/**`。
