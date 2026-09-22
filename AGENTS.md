# AGENTS.md

> pnpm workspace 单仓：把外部开发方法论打包成 **DSH（DeepSeek Harness）bundle 插件**。
> 最高优先级：**不要破坏已发布的插件契约** —— `package.json` 的 `dsh`/`files`、`cordis.patch.yml`、技能 frontmatter、`lib/index.js` 的导出形状。

## 1. 仓库地图

| 目录 | 提供 | 测试 |
|---|---|---|
| `dsh-skill-kit` | 共享库（**非**插件）：frontmatter 解析、目录型 skill provider、命令→技能注册 | 12 |
| `dsh-ponytail` | 6 技能 + 6 个 `/ponytail*` 命令 | 12 |
| `dsh-colgrep` | `colgrep` 模型工具（语义检索，`root` 可指定项目） | 20 |
| `dsh-codegraph` | 经 MCP 注册 `mcp__codegraph__*` 工具 + 无索引时的建图引导 | 5 |
| `dsh-gitbash` | Windows 上接入 Git Bash：realm 组内提供 `ctx.shell` + 宿主 `bash` 工具 | 37 |
| `dsh-taste-skill` | 13 技能（上游逐字副本；无命令、无提示词段，只注册 provider） | 7 |
| `dsh-superpowers` | 14 技能（上游逐字副本 + 2 处 DSH 适配）+ 引导提示词段 | 9 |

npm 名统一为 `@hilariouhiss/<目录名>`。依赖：`dsh-ponytail`、`dsh-taste-skill`、`dsh-superpowers` → `dsh-skill-kit`（**必须先发布**）；`colgrep` → `dsh-tools`；`codegraph` → `dsh-mcp-client`；`gitbash` → `dsh-bash-sandbox` + `dsh-tool-bash`。后四者（以及 skill-kit 的 `dsh-skill`/`dsh-llm`）是**宿主提供的 peer**，见 §3.4。
`skills/**` 是上游**逐字副本**（ponytail v4.9.0、taste-skill `ccbc156`、superpowers v6.3.0）；colgrep、codegraph 无技能。

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
| `ctx.shell.resolve` → `ctx.shell.execute` → `result()` + `ctx.sandboxPolicy.resolve` | 在沙箱策略内调用外部 CLI（0.1.7 起 `execute()` 先给进程句柄，结算结果在 `result()` 上；旧的 `run()` 已移除） |
| `ctx.plugin({ inject, apply }, config)` | 嵌套加载其它插件 |

- `makeSkillProvider` 的 `rank` 默认 `BUNDLED_SKILL_RANK`（**600**），因此 `~/.dsh/skills/`、项目 `.dsh/skills/` 的同名技能会**覆盖**插件技能 —— 这是预期的层叠语义，别为"让插件生效"去调高。
- 技能目录会作为 `resourceBase` 暴露，所以正文里的相对引用（`references/*`、`scripts/*`）可解析。
- 命令把技能喂给模型：`agent.followup(createUserMessage({ content:[{type:"text",text:renderSkillContent(skill)}], source:{kind:"skill-invocation",name,form:"instructions"} }))` —— 与内置 `/goal` 同机制，模型下一步即可读到；返回 `{ kind:"success"|"error", text }`。

## 3. 硬性不变量（破坏即发布事故）

1. `cordis.patch.yml` 的 `name` 必须**逐字等于** `package.json` 的 `name`。
2. `files` 白名单要含全部运行时文件；**带技能的插件必须列 `skills/`**，否则发出去的包里没有技能。
3. `inject` 漏列服务 → 该插件行静默不激活。
4. **`@deepseek-ai/*` 只能进 `peerDependencies`，绝不进 `dependencies`。** 写成 `dependencies` 会让 pnpm 把这份副本 hoist 进 profile 的 `node_modules`，**遮蔽**安装目录里的同名包（`$DSH_HOME/profiles/node_modules` 的镜像）；两代混装会在 ESM 链接期炸掉整棵插件树 —— 连宿主自己的核心 `tools` 行一起，`dsh` 直接 exit 1。peer 范围写 `^<该包真正兼容的那一代>` 作为兼容下限声明，`devDependencies` 写**精确版本**供本仓安装与测试解析。当前运行时是 `0.1.7-alpha.1`：`dsh-colgrep` / `dsh-gitbash` 已移植到它并声明 `^0.1.7-alpha.1`；其余包只用到该代次未改动的入口，仍声明 `^0.1.5-rc.2`。**注意 `^` 范围对预发布版本的语义**：`^0.1.5-rc.2` 并不匹配 `0.1.7-alpha.1`（semver 只在元组相同时放行预发布），所以"下限声明"不等于 pnpm 的兼容性保证，接缝得靠测试守。
5. `@hilariouhiss/dsh-skill-kit` 依赖写 `workspace:^`。
6. 技能 frontmatter 必须与 `@deepseek-ai/dsh-skill-filesystem` 对齐：`name` kebab-case、`description` 必填；旧 camelCase 调用键（`disableModelInvocation`/`modelInvocable`/`userInvocable`）**必须继续被拒绝**；未知键（`allowed-tools`/`license`/`metadata`/`argument-hint`）**必须继续被容忍**。
7. 各包的 `name`/`inject`/`apply` 导出形状与 `test/` 断言是对外契约。
8. 行尾 **LF**（`.gitattributes` 已强制）；测试必须**离线可跑**（不联网，不依赖 `colgrep`/`codegraph` CLI）。

## 4. 代码与测试风格

- ESM、import 带显式 `.js` 后缀、Node ≥ 20；**纯 JS + JSDoc，无 TypeScript、无构建步骤**；**缩进用 TAB**；双引号、分号；具名导出；私有字段 `#`；注释写 why 不写 what。
- 测试用 Node 内置 `node:test` + `node:assert/strict`，零依赖。**不启动真实 DSH**：手写 fake `ctx` 捕获注册调用，`mkdtempSync` 临时目录做 fixture，用假 `agent.followup` 收集注入的消息。覆盖导出形状、注册次数、argv 组装、渲染函数、frontmatter 边界与**错误分支**。
- 运行：`pnpm install` → `pnpm test`。**在 DSH 沙箱内 `pnpm test` 会以 `spawn EPERM` 失败** —— 沙箱禁止带管道的子进程 stdio，而 `node --test` 要为每个测试文件 spawn 子进程；这是**环境限制，不是测试失败**，改在包目录内跑 `node --test-isolation=none --test`。基线：**102 个测试全绿**（12/12/20/5/37/7/9）。`dsh-colgrep` / `dsh-gitbash` 的 `devDependencies` 已跟到运行时那一代（0.1.7-alpha.1），其余包仍是 0.1.5-rc.2。新增排除项要同步 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（刚发布的预发布版会被 pnpm 的发布时长策略挡掉，报成 `ERR_PNPM_NO_MATCHING_VERSION`）。
- **覆写宿主接缝的插件，测试必须打到真实基类**：0.1.7 把执行器接缝从 `run`/`start`/`runArgv`/`startArgv` 改成 `execute`/`executeArgv`，覆写旧名字在 import 期**完全静默**，只在调用时表现为"跑错 shell"。`dsh-gitbash/test/manifest.test.js` 因此既断言接缝名/参数个数，也用真实 `SandboxBashExecutor`（只假 `ctx.subprocess`）跑一遍完整调用链——纯 fake 基类会把宿主的行为变成测试自己的假设。
- 单元测试跑的是仓内 `devDependencies`，**看不到 profile 里的模块遮蔽**。真实安装 + 真启动的冒烟检查是唯一能抓到那一类的方式：`node scripts/smoke-profile.mjs`（需联网 + `pnpm` + PATH 上的 `dsh`，非 `pnpm test` 的一部分）。
- 绝不为"让测试变绿"而削弱断言或删测试；先判断是**行为错了**还是**期望错了**，说清依据再改。

## 5. 技能（SKILL.md）规范

- **`skills/**` 是上游逐字 vendored，不要按本地口味直接改。** 当前 `dsh-ponytail/skills/**`（6 个）与 `dsh-taste-skill/skills/**`（13 个）都是 100% 逐字、无任何本地改动；`dsh-superpowers/skills/**`（14 个）逐字来自上游 v6.3.0，**另加两处有意的 DSH 适配** —— 新增 `using-superpowers/references/dsh-tools.md`，以及在 `using-superpowers/SKILL.md` 的 Platform Adaptation 列表里加 `DeepSeek Harness` 一行；整体覆盖 `skills/` 后必须手工补回这两处。上游升级时整体覆盖，然后跑测试（§4）并更新 README 的「许可与来源」版本号。技能内部的同级引用必须相对 SKILL.md 所在目录（§2 的 `resourceBase` 语义），不要写"仓库根相对"路径。

## 6. 新增插件

- 新增插件：照抄现有包骨架（`package.json`、`cordis.patch.yml`、`lib/index.js`、`test/index.test.js`、`test/manifest.test.js`、`README.md`、`LICENSE`）→ 加进根 `pnpm-workspace.yaml` → 根 `package.json` 加 `publish:<pkg>` 脚本 → 根 `README.md` 补一行 → 写测试 → **`test/manifest.test.js` 里列出该插件用到的 `@deepseek-ai/*` 并按 §3.4 声明** → `dsh plugin --profile <p> add link:./<pkg>` 本地验证 → 发版前 `node scripts/smoke-profile.mjs` 走一遍真实安装 + 真启动。
- 提交用 **Conventional Commits**（英文）：`feat:`/`fix:`/`docs:`/`refactor:`/`chore:`/`test:`；一个提交只做一件事。

## 7. 常见陷阱

| 症状 | 原因 / 对策 |
|---|---|
| 重启后插件"没生效" | `cordis.patch.yml` 的 `name` 与包名不一致，或 `inject` 少列服务 |
| 命令在、技能列表为空 | `files` 漏了 `skills/`，或 frontmatter 解析失败（看 provider 的 warn 日志） |
| 升级 DSH 后插件崩 | `@deepseek-ai/*` 是预发布版，公开 API 可能变；同步 peer 范围与 `devDependencies`，再跑 `node scripts/smoke-profile.mjs` |
| 工具调用报 `ctx.shell.run is not a function`，或 `bash` 跑成了 WSL | 宿主把执行器接缝改名了（0.1.7：`run`/`start`/`runArgv`/`startArgv` → `execute`/`executeArgv`，`ctx.sandbox.confine` 变异步三参）。覆写不存在的名字**加载期无任何报错**，只在调用时暴露；按 §4 的"打到真实基类"补一条守卫测试，别只改调用点 |
| `dsh` 直接起不来、报 `does not provide an export named ...` | profile 里 hoist 了 `@deepseek-ai/*` 旧副本（§3.4）。`ls ~/.dsh/profiles/<p>/node_modules/@deepseek-ai` 有内容即为命中；修 `package.json` 后让用户 `dsh plugin --profile <p> update` |
| 单元测试全绿、真实安装却炸 | 单测跑仓内 `devDependencies`，看不见 profile 遮蔽；用 `node scripts/smoke-profile.mjs` |

## 8. "完成"的定义

- 测试全绿（看得见输出）＋ 对应断言同步更新 ＋ frontmatter 合法 ＋ 逐条对照 §3 不变量 ＋ README/版本号一并更新。没做到就**如实说没做到**，不要用模糊措辞掩盖。
