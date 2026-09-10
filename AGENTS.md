# AGENTS.md

> pnpm workspace 单仓：把外部开发方法论打包成 **DSH（DeepSeek Harness）bundle 插件**。
> 最高优先级：**不要破坏已发布的插件契约** —— `package.json` 的 `dsh`/`files`、`cordis.patch.yml`、技能 frontmatter、`lib/index.js` 的导出形状。

## 1. 仓库地图

| 目录 | 提供 | 测试 |
|---|---|---|
| `dsh-skill-kit` | 共享库（**非**插件）：frontmatter 解析、目录型 skill provider、命令→技能注册 | 11 |
| `dsh-ponytail` | 6 技能 + 6 个 `/ponytail*` 命令 | 11 |
| `dsh-colgrep` | `colgrep` 模型工具（语义检索） | 12 |
| `dsh-codegraph` | 经 MCP 注册 `mcp__codegraph__*` 工具 | 3 |

npm 名统一为 `@hilariouhiss/<目录名>`。依赖：`dsh-ponytail` → `dsh-skill-kit`（**必须先发布**）；`colgrep` → `dsh-tools`；`codegraph` → `dsh-mcp-client`。
`skills/**` 是上游**逐字副本**（ponytail v4.9.0）；colgrep、codegraph 无技能。

## 2. 插件如何工作

`dsh plugin --profile <p> add <pkg>` → 装进 profile 的 `node_modules` → DSH 读到 `package.json` 的 `dsh.bundle.patch` → 启动时应用 `cordis.patch.yml` 的 `- insert: [{ id, name }]` → DSH 用 `name` 解析该包并调用 `apply(ctx)`。
运行在 **host plane**，注册物进入 global layer：对该 profile 的**所有 preset、所有会话**可见。

```js
export const name = "ponytail";
export const inject = ["skills", "systemPrompt", "commands"];  // 用到的服务必须列全
export function apply(ctx) { /* 注册 provider / section / 命令 / 工具 */ }
```

| ctx 服务 | 用途 |
|---|---|
| `ctx.skills.registerProvider(fn)` | 注册技能来源：`makeSkillProvider({ name, source, skillsDir })` |
| `ctx.systemPrompt.section({ name, order, text })` | 注入提示词段；`text` 可为 `(context) => string`，每回合重算 |
| `ctx.commands.register({ name, description, input?, handler })` | 斜杠命令 |
| `ctx.tools.register(defineTool({ ... }))` | 模型工具 |
| `ctx.shell.resolve/run` + `ctx.sandboxPolicy.resolve` | 在沙箱策略内调用外部 CLI |
| `ctx.plugin({ inject, apply }, config)` | 嵌套加载其它插件 |

- section `order`：引导段用 **5**，codegraph 指引用 **100**，不要随手取数。
- `makeSkillProvider` 的 `rank` 默认 `BUNDLED_SKILL_RANK`（**600**），因此 `~/.dsh/skills/`、项目 `.dsh/skills/` 的同名技能会**覆盖**插件技能 —— 这是预期的层叠语义，别为"让插件生效"去调高。
- 技能目录会作为 `resourceBase` 暴露，所以正文里的相对引用（`references/*`、`scripts/*`）可解析。
- 命令把技能喂给模型：`agent.followup(createUserMessage({ content:[{type:"text",text:renderSkillContent(skill)}], source:{kind:"skill-invocation",name,form:"instructions"} }))` —— 与内置 `/goal` 同机制，模型下一步即可读到；返回 `{ kind:"success"|"error", text }`。

## 3. 硬性不变量（破坏即发布事故）

1. `cordis.patch.yml` 的 `name` 必须**逐字等于** `package.json` 的 `name`。
2. `files` 白名单要含全部运行时文件；**带技能的插件必须列 `skills/`**，否则发出去的包里没有技能。
3. `inject` 漏列服务 → 该插件行静默不激活。
4. `@deepseek-ai/*` 写**精确版本**（当前 `0.1.1-rc.2`），**不要写 `^`** —— 它们是预发布版，范围会漂移。
5. `@hilariouhiss/dsh-skill-kit` 依赖写 `workspace:^`。
6. 技能 frontmatter 必须与 `@deepseek-ai/dsh-skill-filesystem` 对齐：`name` kebab-case、`description` 必填；旧 camelCase 调用键（`disableModelInvocation`/`modelInvocable`/`userInvocable`）**必须继续被拒绝**；未知键（`allowed-tools`/`license`/`metadata`/`argument-hint`）**必须继续被容忍**。
7. 各包的 `name`/`inject`/`apply` 导出形状与 `test/` 断言是对外契约。
8. 行尾 **LF**（`.gitattributes` 已强制）；测试必须**离线可跑**（不联网，不依赖 `colgrep`/`codegraph` CLI）。

## 4. 代码与测试风格

- ESM、import 带显式 `.js` 后缀、Node ≥ 20；**纯 JS + JSDoc，无 TypeScript、无构建步骤**；**缩进用 TAB**；双引号、分号；具名导出；私有字段 `#`；注释写 why 不写 what。
- 新增依赖要克制：标准库或已有依赖能做的就不加。
- 测试用 Node 内置 `node:test` + `node:assert/strict`，零依赖。**不启动真实 DSH**：手写 fake `ctx` 捕获注册调用，`mkdtempSync` 临时目录做 fixture，用假 `agent.followup` 收集注入的消息。覆盖导出形状、注册次数、argv 组装、渲染函数、frontmatter 边界与**错误分支**。
- 运行：`pnpm install` → `pnpm test`。**在 DSH 沙箱内 `pnpm test` 会以 `spawn EPERM` 失败** —— 沙箱禁止带管道的子进程 stdio，而 `node --test` 要为每个测试文件 spawn 子进程；这是**环境限制，不是测试失败**，改在包目录内跑 `node --test-isolation=none --test`。基线：**37 个测试全绿**（11/11/12/3）。
- 绝不为"让测试变绿"而削弱断言或删测试；先判断是**行为错了**还是**期望错了**，说清依据再改。

## 5. 技能（SKILL.md）规范

- frontmatter：`name`（kebab-case，≤64 字符）、`description`（必填，≤1024，建议 <500）、`whenToUse` 可选。
- `description` 用「**Use when …**」开头，只写**触发条件与症状**；**绝不概括技能流程** —— 摘要会变成模型抄近路的捷径，让它照着摘要做而不读正文。写上具体触发词、错误串、同义词、工具名。名字用动宾/动名词式，别叫 `utils`/`helpers`。
- 正文骨架：Overview（核心原则 1–2 句）→ When to Use（含何时**不**用）→ 速查表 → 步骤 → Rationalizations / Red Flags → 清单。祈使句，硬规则 **MUST/NEVER**；用「借口 | 现实」两列表堵死合理化。正文 < 500 行；超 100 行的参考拆成同级文件并用**相对链接**引用；引用别的技能用技能名而非路径；不用 `@` 链接、不写时效性内容、不用反斜杠路径。
- **`skills/**` 是上游逐字 vendored，不要按本地口味直接改。** 当前 `dsh-ponytail/skills/**`（6 个）是 100% 逐字、无任何本地改动；上游升级时整体覆盖，然后跑测试（§4）并更新 README 的「许可与来源」版本号。技能内部的同级引用必须相对 SKILL.md 所在目录（§2 的 `resourceBase` 语义），不要写"仓库根相对"路径。

## 6. 新增插件与发布

- 新增插件：照抄现有包骨架（`package.json`、`cordis.patch.yml`、`lib/index.js`、`test/index.test.js`、`README.md`、`LICENSE`）→ 加进根 `pnpm-workspace.yaml` → 根 `package.json` 加 `publish:<pkg>` 脚本 → 根 `README.md` 补一行 → 写测试 → `dsh plugin --profile <p> add link:./<pkg>` 本地验证。
- 提交用 **Conventional Commits**（英文）：`feat:`/`fix:`/`docs:`/`refactor:`/`chore:`/`test:`；一个提交只做一件事。
- 发布前**必须**递增 `version`（`prepublishOnly` 只跑测试，不替你升版本）；**先发 `dsh-skill-kit`，再发各插件**。本仓**没有 CI**，本地验证是唯一的闸门。
- 不要提交 `node_modules/`、`.colgrep-data/`、`*.tgz`。

## 7. 常见陷阱

| 症状 | 原因 / 对策 |
|---|---|
| 重启后插件"没生效" | `cordis.patch.yml` 的 `name` 与包名不一致，或 `inject` 少列服务 |
| 命令在、技能列表为空 | `files` 漏了 `skills/`，或 frontmatter 解析失败（看 provider 的 warn 日志） |
| `pnpm test` 报 `spawn EPERM` | 沙箱限制，非代码缺陷；改用 `node --test-isolation=none --test` |
| `colgrep` 写索引失败 | 索引必须落在工作区内：插件用 `COLGREP_DATA_DIR` 指向 `<workspace>/.colgrep-data` |
| `codegraph` 返回"无索引" | 目标项目未 `codegraph init`；`projectPath` 必须由模型显式传 |
| 升级 DSH 后插件崩 | `@deepseek-ai/*` 是预发布版，公开 API 可能变；同步改依赖版本与实现 |

## 8. 通用编码纪律

- **先爬阶梯**：① 需要存在吗（YAGNI）→ ② 仓库里已有？→ ③ 标准库？→ ④ 平台原生？→ ⑤ 已装依赖？→ ⑥ 一行？→ ⑦ 才写最小实现。删除优于新增、最少文件数、最短能工作的 diff —— 但前提是**已经理解了问题**。阶梯只缩短解法，绝不缩短阅读。
- **找根因**：报告写的是症状。读完整错误、稳定复现、在组件边界插桩、把数据追到源头；改公共函数前先 grep 所有调用方（在共享处加一个 guard，比在每个调用方各加一个更小也更对）。先写假设再动手，一次一个变量；不要"顺手改一下"、不要捆绑重构；**三次修复失败就停下来质疑架构**。
- **证据先于断言**：先写会失败的测试、亲眼看它失败，再写最小实现。说"通过/修好了/完成了"之前，在**本条消息里**跑完验证命令、读完输出、数完失败数。禁用 `should`/`probably`/`seems` 与验证前的"Done!"。
- **委派纪律**：一个任务一个子代理，只给它需要的东西（把大段材料变成文件让它读）；子代理说成功**不是证据**，去看 diff 和输出；不要并行派发会改同一批文件的任务；一轮不通过就换人或升级模型。
- **"完成"的定义**：测试全绿（看得见输出）＋ 对应断言同步更新 ＋ frontmatter 合法 ＋ 逐条对照 §3 不变量 ＋ README/版本号一并更新。没做到就**如实说没做到**，不要用模糊措辞掩盖。
