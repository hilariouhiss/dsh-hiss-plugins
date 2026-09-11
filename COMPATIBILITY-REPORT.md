# 兼容性报告：dsh-hiss-plugins × DeepSeek Harness 0.1.5

- 日期：2026-09-11
- 结论：**不适配**。源码级 API 全部兼容，但**发布安装路径**因依赖版本钉死而致命失败 —— `dsh-colgrep` 单独安装即可让整个 Harness 启动失败。
- 本报告是诊断与取证记录；对应的修复见 [§8 修复记录](#8-修复记录2026-09-11)。

---

## 1. 环境

| 项 | 值 |
|---|---|
| `@deepseek-ai/dsh` CLI | **0.1.5-rc.1**（`%APPDATA%\npm\node_modules\@deepseek-ai\dsh`） |
| 随 CLI 发布的运行时包 | **0.1.5-rc.2**（`@deepseek-ai/dsh-*`，共 244 个包） |
| `@deepseek-ai/cordis` | **4.0.2**（原 4.0.1） |
| 插件声明的 `@deepseek-ai/*` | **0.1.1-rc.2**（精确版本，落后 4 个发布） |
| 仓库开发态安装 | 0.1.1-rc.2 / cordis 4.0.1 |
| `~/.dsh/profiles/node_modules` | 安装目录依赖闭包的逐包符号链接镜像（196 项） |
| npm 上已发布版本 | skill-kit 1.0.1、ponytail 1.0.2、colgrep 1.0.1、codegraph 1.0.1 —— 与仓库 `package.json` 一致 |

---

## 2. 判定矩阵

| 包 | 源码级 API | 单独安装后启动 | 实际可用性 |
|---|---|---|---|
| `dsh-skill-kit` | ✅ | — （库，非插件） | ✅ |
| `dsh-ponytail` | ✅ | ✅ exit 0 | ✅ 技能与 6 个命令实测全部工作 |
| `dsh-colgrep` | ✅ | ❌ **exit 1，整树启动失败** | ❌ 完全不可用 |
| `dsh-codegraph` | ✅ | ✅ exit 0 | ⚠️ 仅在**未同时安装 colgrep** 时可用 |

补充：三者同时安装 → 启动失败，且 `ponytail`、`codegraph` 一并被拖死（boot 阶段整树回滚）。

---

## 3. 证据 A：源码级 API 全部兼容（通过）

把四个包挂载到**真实 0.1.5-rc.2 运行时**（`node_modules/@deepseek-ai` 指向安装目录，插件解析到 0.1.5-rc.2 副本）后，45 条断言全绿：

- **`ctx.tools.register(defineTool(...))`** —— `defineTool` 在 0.1.1-rc.2 与 0.1.5-rc.2 之间**逐字节相同**；新注册表 `assertSupportedJsonSchema` 接受 `{ type: "json" }` 编译出的 output schema；`validateJsonSchemaValue` 接受真实调用参数与产出值。
- **`ctx.shell.resolve/run`** —— `command / workdir / timeoutMs / stdoutMaxBytes / signal / sandboxPolicy / env` 全部仍在；`ShellRunResult`（`exitCode / stdout.text / stderr.text / timedOut / aborted`）形状未变。
- **`ctx.sandboxPolicy.resolve({ session })`** —— `SandboxExecutionPolicy.workspaceRoot` 未变。
- **`ctx.systemPrompt.section({ name, order, text })`** —— `AssembleContext.scope` 未变；`order: 5`（ponytail）与 `order: 100`（codegraph）未被新增的保留区间规则拒绝。
- **`ctx.commands.register({ name, description, input: { hint }, handler })`** —— `CommandInvocation{ commandId, agent, rawInput, attachments, signal }` 与 `CommandResult{ kind, text }` 未变；`/ponytail ultra`、`/ponytail-review` 实测返回 `kind:"success"`，`/ponytail bogus` 返回 `kind:"error"`。
- **`agent.followup(createUserMessage({ content, source }))`** —— `source:{ kind:"skill-invocation", form:"instructions" }` 仍被接受。
- **`ctx.skills.registerProvider(factory)`** —— `SkillProvider{ list, get }`、候选/定义字段（`rank / locator / resourceBase / invocation / whenToUse / metadata`）全部匹配。真实 `SkillRegistry` 列出 6 个 ponytail 技能，`get("ponytail")` 返回 5678 字符正文，`renderSkillContent()` 接受该定义，`BUNDLED_SKILL_RANK` 仍为 **600**。
- **技能 frontmatter 规范**（AGENTS.md §3.6）—— 与 `dsh-skill-filesystem@0.1.5-rc.2` 完全一致：kebab-case 名、`description` 必填、`whenToUse` 字段名未变、旧 camelCase 调用键仍被拒绝、未知键仍被容忍。
- **`@deepseek-ai/dsh-mcp-client`** —— 0.1.1-rc.2 → 0.1.5-rc.2 仅 22 行差异（`tools/list` 游标重复防护 + serverName 按 scope 保留）；`apply` / `inject = ["tools"]` / `StdioConfig` 形状未变，新 `Config` 接受 codegraph 传入的配置。
- **`cordis.patch.yml` 方言** —— `- insert: [{ id, name }]` 仍是 `cordis-plugin-include` 的 `PatchOptions`；`package.json` 的 `dsh.bundle.patch` 字段语义未变。`dsh --profile acp --dump-config` 能正确把三行插入组合进树。
- **仓库测试** —— 37/37 全绿（11/11/12/3，`node --test-isolation=none --test`）。**但这些测试跑在仓库自己的 0.1.1-rc.2 安装上，原理上无法发现本问题。**

---

## 4. 证据 B：部署级依赖漂移（致命）

### 4.1 机制

Profile 模板（`PROFILE_PNPM_WORKSPACE`）固定 `nodeLinker: hoisted` + `autoInstallPeers: false`；`dsh plugin --profile <p> add <pkg>` 只是在 profile 目录里转发 pnpm。于是：

1. 插件把 `@deepseek-ai/dsh-*` 声明为**精确** `dependencies` → pnpm 在 `<profile>/node_modules/@deepseek-ai/` 装上 **0.1.1-rc.2** 副本；
2. 这些副本**遮蔽**了上一层 `~/.dsh/profiles/node_modules/`（指向安装目录的 0.1.5-rc.2 符号链接）；
3. 而 `@deepseek-ai/dsh-session`、`dsh-scope`、`dsh-system-prompt` 等在 0.1.1-rc.2 的 `dsh-tools` 里是 **peerDependency** —— `autoInstallPeers: false` 使 pnpm 不安装它们，于是它们**向上解析到宿主的新版 0.1.5-rc.2**；
4. 新旧混装导致 ESM 链接期报错。

实测 pnpm 实际落盘的副本（`<profile>/node_modules/@deepseek-ai/`）：

| 单独安装 | 被 hoist 的包 |
|---|---|
| ponytail | `dsh-llm@0.1.1-rc.2`、`dsh-skill@0.1.1-rc.2`、cosmokit、schemastery |
| **colgrep** | **`dsh-tools@0.1.1-rc.2`**、cosmokit、schemastery |
| codegraph | `dsh-mcp-client@0.1.1-rc.2`、cosmokit、schemastery（**无 dsh-tools**，它是 peer） |

### 4.2 断链点

`<profile>/node_modules/@deepseek-ai/dsh-tools/lib/index.js:5`

```js
import { isJsonValue, snapshotJsonValue } from "@deepseek-ai/dsh-session";
```

- 0.1.1-rc.2 的 `dsh-session` 导出这两个符号；
- **0.1.5-rc.2 的 `dsh-session` 不再导出它们** —— 已迁移到新包 `@deepseek-ai/dsh-util-values`（`dsh-session/lib/index.js:4` 现在从那里 import）。

全量扫描确认共 **4 处**失效导入点，全部落在被钉死的 `dsh-tools@0.1.1-rc.2` 上：

```
node_modules/@deepseek-ai/dsh-tools/lib/index.js            → dsh-session: isJsonValue, snapshotJsonValue
node_modules/@deepseek-ai/dsh-tools/lib/types/code-mode.js  → dsh-session: snapshotJsonValue
node_modules/@deepseek-ai/dsh-tools/lib/types/index.js      → dsh-session: snapshotJsonValue
node_modules/@deepseek-ai/dsh-tools/lib/types/json-schema.js→ dsh-session: isJsonValue
```

### 4.3 真实启动结果

隔离 `DSH_HOME` + 真实 `dsh` CLI（`dsh --profile acp`）：

| 场景 | 退出码 | 失败的 loader row |
|---|---|---|
| 只装 ponytail | **0** | 无 |
| 只装 codegraph | **0** | 无 |
| **只装 colgrep** | **1** | `tools (@deepseek-ai/dsh-tools)` + `colgrep (@hilariouhiss/dsh-colgrep)` |
| 三个都装 | **1** | `tools` + `colgrep` + `codegraph` |
| 三个都装，但删掉 profile 里 hoist 的 `@deepseek-ai/*` | **0** | 无 |

colgrep 单独安装时的原始输出：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): loader entries failed to apply
Error: failed to import loader entry tools (@deepseek-ai/dsh-tools):
       The requested module '@deepseek-ai/dsh-session' does not provide an export named 'isJsonValue'
Error: failed to import loader entry colgrep (@hilariouhiss/dsh-colgrep):
       The requested module '@deepseek-ai/dsh-session' does not provide an export named 'isJsonValue'
```

**要点：受损的不只是插件行，宿主自己的核心 `tools` 行也一起挂掉，loader 整树回滚，进程 exit 1 —— 即装了 colgrep 之后 Harness 直接起不来。**

codegraph 本身不直接依赖 `dsh-tools`（只在运行时通过 `mcp-client` 的 peer 解析到宿主的 0.1.5-rc.2），所以单独装没事；但只要 colgrep 同时在 profile 里 hoist 了旧的 `dsh-tools`，codegraph 的 `mcp-client@0.1.1-rc.2` 通过 `assertSupportedJsonSchema` 也会解析到那份旧副本并一起挂掉。

### 4.4 为什么之前没暴露

- `dsh plugin --profile <p> add link:./dsh-colgrep`（AGENTS.md §6 的本地验证路径）走的是仓库自身的 `node_modules`，那一套 0.1.1-rc.2 是**自洽**的，import 正常 —— 实测 `dev-link import OK`。
- 仓库测试同样跑在这套自洽的旧依赖上。
- 因此「本地验证通过 + 37 测试全绿」和「线上装不上」可以同时成立。

---

## 5. 次要发现（非版本相关，非阻塞）

1. **`colgrep` 的 `quoteArg` 在 POSIX shell 下转义错误**：`'` + `value.replace(/'/g,"''")` + `'` 是 PowerShell 语义；POSIX shell 中单引号内 `''` 会直接结束并重开字符串，含引号的路径会串味。当前宿主是 Windows/pwsh 所以不发作，换 POSIX 宿主即为真 bug。
2. **`dsh` CLI 版本号为 0.1.5-rc.1，其内附运行时包为 0.1.5-rc.2**，两者不同步；判定插件依赖时以运行时包为准。
3. **AGENTS.md 已过期**：§3.4「当前 `0.1.1-rc.2`」与 §7 最后一行「升级 DSH 后插件崩」需要更新到 0.1.5-rc.2 并补上本报告指向的 hoist 遮蔽机制。（已在 §8 修复记录中更新。）

---

## 6. 修复方向（仅方向，未实施）

1. **解除精确钉死**：把 `@deepseek-ai/dsh-*` 从 `dependencies` 改为与宿主同代的 **`peerDependencies`**，或在运行时用宽范围（如 `^0.1.5-rc.2`）并配合 `dsh plugin update` 同步升级；关键是**不能让 profile 里出现与安装目录不同代的 `@deepseek-ai/dsh-tools`**。
2. **依赖宿主模块实例**：DSH 已有 `.dsh-module-fallback` / `healProfilesModuleFallback` 机制，其设计意图正是「安装目录拥有的包不由 profile 携带」（`installationPackageNames` 会在闭包遍历时被跳过）。让插件不再把 `@deepseek-ai/dsh-*` 装进 profile，即回到该机制的保护范围。
3. **补一条回归防线**：现有测试与 dev-link 都跑在自洽旧依赖上，建议增加一个「按真实 profile 布局安装 + 真实 boot」的冒烟检查；`dsh --dump-config` 不够（它不加载模块），必须真正 `boot`。
4. **临时规避（用户侧，非仓库改动）**：暂时移出 colgrep；或在 profile 中显式钉住 `@deepseek-ai/dsh-tools` 为 0.1.5-rc.2 以消除遮蔽。

---

## 7. 复现步骤

```powershell
# 1. 造一个隔离 DSH_HOME，按真实 profile 布局安装已发布插件
$H = "$env:TEMP\dsh-home-repro"
mkdir "$H\profiles\acp\node_modules" -Force
# <profile>/pnpm-workspace.yaml: packages:[.], nodeLinker: hoisted, autoInstallPeers: false
# <profile>/package.json: dependencies + dsh.profile.bundles 含 @hilariouhiss/dsh-colgrep
pnpm install --ignore-scripts            # 在 profile 目录内
# 2. 上一层的安装目录镜像（真实环境由 healProfilesModuleFallback 维护）
#    profiles/node_modules 为逐包符号链接
# 3. 真实启动
$env:DSH_HOME = $H
dsh --profile acp                        # → exit 1，见 §4.3
```

本次取证用的探针脚本与临时 `DSH_HOME` 均在 `%TEMP%` 下创建，取数完成后已清理。

---

## 8. 修复记录（2026-09-11）

按 §6 的方向 1 + 2 + 3 实施。

### 8.1 依赖契约

`@deepseek-ai/*` 从 `dependencies` 移入 `peerDependencies`（范围 `^0.1.5-rc.2`），并在
`devDependencies` 里按精确版本 `0.1.5-rc.2` 供本仓安装与测试：

| 包 | peer（宿主提供） | 版本 |
|---|---|---|
| dsh-skill-kit | `dsh-skill`、`dsh-llm` | 1.0.1 → **1.1.0** |
| dsh-ponytail | `dsh-skill`、`dsh-llm` | 1.0.2 → **1.1.0** |
| dsh-colgrep | `dsh-tools` | 1.0.1 → **1.1.0** |
| dsh-codegraph | `dsh-mcp-client` | 1.0.1 → **1.1.0** |

profile 模板的 `autoInstallPeers: false` 使 pnpm 不再把这些包装进 profile；它们经父级
查找落到 `$DSH_HOME/profiles/node_modules`（安装目录闭包镜像），回到
`healProfilesModuleFallback` 的保护范围。`@hilariouhiss/dsh-skill-kit`（第三方库）仍是
ponytail 的普通 `dependencies`。

副作用：本仓测试与 `devDependencies` 一并升到 **0.1.5-rc.2**，因此单元测试现在跑在与运行时
同代的依赖上（此前跑 0.1.1-rc.2，原理上看不到本问题）。

### 8.2 回归防线

1. **`test/manifest.test.js`（每包一个，离线）** —— 锁定 §3.4 不变量：用到的
   `@deepseek-ai/*` 不得出现在 `dependencies`，必须在 `peerDependencies` 与
   `devDependencies` 中。实施前先跑，四包各自按预期失败（`must not be a dependency: ...`）。
2. **`scripts/smoke-profile.mjs`（opt-in，`pnpm smoke`）** —— 把四个包 `pnpm pack` 成
   tarball，按真实 profile 布局（`nodeLinker: hoisted`、`autoInstallPeers: false`、本地
   tarball override）装进临时 `DSH_HOME`，然后真启动 `dsh --profile smoke`，断言：
   - profile 的 `node_modules` 里**没有** `@deepseek-ai/` 目录；
   - `dsh` 退出码 0；
   - 输出中没有 `failed to import loader entry` / `plugin tree failed to load`。

   不进 `pnpm test`：需联网 + `pnpm` + PATH 上的 `dsh`，且要在非受限 shell 里跑
   （沙箱会拦带管道的子进程 stdio）。

### 8.3 验证

| 检查 | 结果 |
|---|---|
| 四包单元测试（`node --test-isolation=none --test`，依赖 0.1.5-rc.2） | **41/41 绿**（12/12/13/4） |
| `node scripts/smoke-profile.mjs` | **全绿**：profile 无 `@deepseek-ai/`、boot exit 0、无 loader 失败 |
| 冒烟检查负向对照（把 colgrep 改回钉死 `dependencies`） | **按预期失败**：识别出 `cosmokit, dsh-tools, schemastery` 遮蔽，boot exit 1 |

负向对照暴露的断链点与 §4.2 同源但首个命中符号不同：此配置下 `dsh-llm` 没有 hoist 进
profile，旧 `dsh-tools` 的 peer 向上解析到宿主 0.1.5-rc.2，于是先炸在
`import { CallId } from "@deepseek-ai/dsh-llm"`（`CallId` 同样已从 0.1.5-rc.2 的 `dsh-llm`
移除）。结论不变：**任何** 被 profile 携带的 `@deepseek-ai/*` 副本都可能触发这类链接期失败。

### 8.4 未处理

- §5.1 `colgrep` 的 `quoteArg` POSIX 转义问题**未改**：非版本兼容问题，且当前宿主为
  Windows/pwsh，改动 argv 组装需要 POSIX 环境实测，留待单独提交。
- 已发布到 npm 的旧版本（skill-kit 1.0.1 / ponytail 1.0.2 / colgrep 1.0.1 / codegraph 1.0.1）
  仍是坏的；本仓已递增到 1.1.0，**需重新发布**才能让用户受惠。
