# dsh-superpowers

把 [superpowers](https://github.com/obra/superpowers)（“让编码 agent 拥有超能力”的完整软件开发方法论：头脑风暴 → 实现计划 → TDD → 系统化调试 → subagent 驱动开发 → 代码评审 → 收尾）移植为 DeepSeek Harness 插件。

本插件以 DSH **bundle 插件**形式提供 14 个技能 + 会话引导（bootstrap），安装后对 `web`、`headless` 等任意 profile 的所有会话生效。

## 功能

14 个组合技能，覆盖软件开发的完整流程：

| 技能 | 作用 |
|---|---|
| `using-superpowers` | 技能系统引导：强制在回应前检查并调用适用技能（会话开始时由系统提示词注入） |
| `brainstorming` | 任何创造性工作前先探索意图/需求/设计，产出并确认设计后再动手 |
| `writing-plans` | 把规格拆成 bite-size 的实现任务（精确文件路径、完整代码、验证步骤） |
| `test-driven-development` | RED-GREEN-REFACTOR：先写失败测试 → 看它失败 → 写最小实现 → 看它通过 |
| `systematic-debugging` | 四阶段根因定位流程，先找根因再修复 |
| `verification-before-completion` | 声称“完成/已修复/通过”前先跑验证命令并确认输出 |
| `subagent-driven-development` | 每个任务派发独立 subagent，任务后做规格 + 质量两级评审 |
| `executing-plans` | 在独立会话按计划批量执行，带人工检查点 |
| `dispatching-parallel-agents` | 2+ 个相互独立的任务并行派发 |
| `requesting-code-review` | 完成任务/大特性/合并前请求代码评审 |
| `receiving-code-review` | 收到评审反馈后先验证再实现，不盲从 |
| `using-git-worktrees` | 在隔离 workspace / 新分支上做特性开发 |
| `finishing-a-development-branch` | 实现完成后决定如何合入（merge/PR/保留/丢弃）并清理 |
| `writing-skills` | 创建/编辑技能，部署前验证 |

行为要点：

- **会话引导（bootstrap）**：通过 `systemPrompt.section` 在每个回合注入 `using-superpowers` 的强制指令（“只要技能有 1% 可能适用，就必须调用”）。与上游的 SessionStart hook 不同，DSH 版每个回合重新组装，因此 compaction 后引导依然有效。
- **自动触发**：技能由模型按 `available_skills` 目录 + 引导自动选择，无需手动开启，也没有斜杠命令。
- **相对资源**：provider 把每个技能目录设为 `resourceBase`，技能正文里的相对引用（`implementer-prompt.md`、`references/*.md`、`scripts/*`、`examples/*`）都能通过 read 工具解析。
- **DSH 工具映射**：`using-superpowers/references/dsh-tools.md` 把技能里的动作（调用技能、派发 subagent、建 todo、跑命令）映射到 DSH 的 `skill` / `subagent` / `todo_write` / shell 工具。

## 安装

```powershell
dsh plugin --profile web add dsh-superpowers
```

把 `web` 换成你的 profile 名（例如 `headless`）。然后**重启 dsh**（bundle 层在 profile 启动时加载）。

本地开发可改用 link 安装（改动即时生效）：

```powershell
dsh plugin --profile web add link:./dsh-superpowers
```

重启前可用下面命令确认 bundle 行已正确编入（无 "did not activate"/"cannot find package" 警告即正常）：

```powershell
dsh web --dump-config
```

## 验证

重启后新建会话，发送：

> Let's make a react todo list

正常安装会在写任何代码前自动触发 `brainstorming`。此外，会话的 `available_skills` 应列出全部 14 个技能。

## 卸载

```powershell
dsh plugin --profile web remove dsh-superpowers
```

然后重启 dsh。

## 本地覆盖

若你在 `~/.dsh/skills/` 或项目 `.dsh/skills/` 放了同名技能，DSH 会优先使用本地副本（技能注册表的层级语义），可用于定制 superpowers 行为。

## 开发

```powershell
pnpm install
pnpm test
```

结构：

```
lib/index.js        插件入口 apply(ctx)：注册 provider + 注入引导 section
lib/provider.js     全局层技能 provider（扫描 skills/ 目录）
lib/frontmatter.js  YAML frontmatter 解析
skills/             14 个技能目录（上游逐字复制，含 references/scripts/examples）
cordis.patch.yml    bundle patch：插入本插件的宿主行
test/               node:test 单元测试
```

## 发布（给维护者）

```powershell
cd dsh-superpowers
pnpm install
pnpm test
npm login       # 首次发布前登录 npm
npm publish     # publishConfig.access 已设为 public
```

发布后其他用户即可 `dsh plugin --profile web add dsh-superpowers`。`prepublishOnly` 会在每次发布前自动运行 `npm test`；发布新版本前记得递增 `package.json` 的 `version`。`files` 白名单确保只发布 `lib/`、`skills/`、`cordis.patch.yml`、`README.md`、`LICENSE`（不含 `test/` 与本地开发产物）。

## 更新技能

技能 vendored 自上游 `superpowers/skills/`。上游更新后，重新把该目录复制到 `skills/`，并手工补回两处 DSH 适配：`using-superpowers/references/dsh-tools.md`，以及 `using-superpowers/SKILL.md` 的 "Platform Adaptation" 列表里新增的 `DeepSeek Harness` 一行。

## 许可与来源

本插件为 MIT 许可。技能内容（`skills/**`）逐字来自 [obra/superpowers](https://github.com/obra/superpowers) v6.3.0（© Jesse Vincent，MIT）。DSH 适配仅新增 `using-superpowers/references/dsh-tools.md` 及该技能 "Platform Adaptation" 里的一行。

> 提示：本插件通过 `ctx.skills` 的 `SkillProvider` 接口（结构型）注册技能，并内联了技能名校验规则；若日后升级 dsh 后该接口发生变化，需同步更新 `lib/provider.js` / `lib/frontmatter.js`。
