# /mcp 弹窗实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在输入框敲 `/mcp` 打开一个对话框，展示全局与当前工作区的 MCP 服务器/工具，按工作区记住每个工具的开关，并能新增 MCP（全局/工作区）与把工作区服务器一键注册到全局。

**Architecture:** 扩展现有 `project-mcp` 行，不新增 Loader 行。宿主半新增三个纯逻辑模块（按工作区状态、弹窗数据组装、动作分发）加一个同源 HTTP 路由；浏览器半用 `commandUi.decorate` 接管裸 `/mcp`，在 `shell.overlay` 里画对话框。工具屏蔽用 `agent.ctx.tools.restrict({deny})`，按工作区状态在 agent 创建时和工具表变化后重算。

**Tech Stack:** 纯 JS（ESM，无构建）、node:test、React（手写 lazy-CJS）、Cordis ctx 服务、`webServer` 同源 HTTP 路由。

**Spec:** `docs/superpowers/specs/2026-11-24-mcp-dialog-design.md`

## Global Constraints

- 不新增 Loader 行、不改 `cordis.patch.yml`、不改已有行的 `id`/`name`、不改 `exports` 形状。
- 缩进 TAB；双引号；分号；具名导出；import 带 `.js`；行尾 LF。
- `lib/project-mcp/index.js` 导入宿主包，**不加单测**；逻辑都放进不导入宿主包的纯模块。
- 测试离线：`cd dsh-hiss-plugins && node --test-isolation=none --test`（沙箱内）；全量 `pnpm test`。
- `@deepseek-ai/*` 只进 `peerDependencies`；本计划不新增任何 peer。
- 状态文件路径：`~/.dsh/hiss-mcp.json`；工作区键 = `resolve(cwd)`。

## Review Focus

- `/mcp` 带参数（`/mcp foo`）时宿主命令仍报 Usage，弹窗不打开。
- 弹窗打开时某个服务器连接失败/没连上：显示 0 个工具而不是报错或空白。
- 关闭某个工具后，模型下一轮真的看不到它；重新打开后又能看到。
- `.mcp.json` 缺失、损坏、或含不认识的条目时：读不炸、写不毁掉原文件其它键。
- 新增服务器的名字非法（空格、斜杠、超 32 字符）或与已有重名：给出明确错误，不写坏配置。

---

### Task 1: 按工作区的开关状态存储

**Files:**
- Create: `dsh-hiss-plugins/lib/project-mcp/state.js`
- Test: `dsh-hiss-plugins/test/project-mcp/state.test.js`

**Interfaces:**
- Produces:
  - `emptyState(): { workspaces: {} }`
  - `normalizeState(raw: unknown): State` — 任何畸形输入归一成空状态；`workspaces` 里每个值只保留 `disabledTools`/`disabledServers` 两个字符串数组
  - `isToolEnabled(state, cwd, tool): boolean`
  - `isServerEnabled(state, cwd, server): boolean`
  - `withTool(state, cwd, tool, enabled): State` / `withServer(state, cwd, server, enabled): State` — 不改入参，返回新对象；`enabled=true` 从列表移除，`false` 加入（去重）
  - `statePath(home: string): string` — `join(home, ".dsh", "hiss-mcp.json")`
  - `async readState(path): Promise<State>` — 文件不存在/JSON 坏/形状不对一律返回空状态
  - `async writeState(path, state): Promise<void>` — 建父目录，写 `<path>.<random>.tmp` 再 rename

- [ ] **Step 1: 写失败测试** `dsh-hiss-plugins/test/project-mcp/state.test.js`

```js
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState, isToolEnabled, isServerEnabled, withTool, withServer, readState, writeState, statePath } from "../../lib/project-mcp/state.js";

test("normalizeState drops unknown shapes", () => {
  assert.deepEqual(normalizeState(null), { workspaces: {} });
  assert.deepEqual(normalizeState({ workspaces: { "C:\\p": { disabledTools: "x", extra: 1 } } }), { workspaces: { "C:\\p": { disabledTools: [], disabledServers: [] } } });
});

test("toggling a tool off then on round-trips", () => {
  const off = withTool(emptyState(), "C:\\p", "mcp__a__t", false);
  assert.equal(isToolEnabled(off, "C:\\p", "mcp__a__t"), false);
  assert.equal(isToolEnabled(off, "C:\\other", "mcp__a__t"), true);
  const on = withTool(off, "C:\\p", "mcp__a__t", true);
  assert.equal(isToolEnabled(on, "C:\\p", "mcp__a__t"), true);
  assert.deepEqual(off.workspaces["C:\\p"].disabledTools, ["mcp__a__t"], "input state is not mutated");
});

test("readState falls back to empty on a corrupt file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hiss-state-"));
  const path = join(dir, "state.json");
  writeFileSync(path, "{not json");
  assert.deepEqual(await readState(path), emptyState());
  rmSync(dir, { recursive: true, force: true });
});

test("writeState then readState round-trips atomically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hiss-state-"));
  const path = join(dir, "nested", "state.json");
  const state = withServer(emptyState(), "C:\\p", "matlab", false);
  await writeState(path, state);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), state);
  assert.deepEqual(await readState(path), state);
  assert.equal(statePath("C:\\Users\\me"), join("C:\\Users\\me", ".dsh", "hiss-mcp.json"));
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd dsh-hiss-plugins && node --test test/project-mcp/state.test.js`
Expected: FAIL — `Cannot find module .../state.js`

- [ ] **Step 3: 实现 `state.js`**

只 import `node:fs/promises` 与 `node:path`。`readState` 用 `try/catch` 包 `readFile`+\`JSON.parse`+\`normalizeState`，任何失败返回 `emptyState()`。`writeState` 用 `await mkdir(dirname(path), { recursive: true })`、`writeFile(tmp, JSON.stringify(state, null, 2) + "\n")`、`rename(tmp, path)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd dsh-hiss-plugins && node --test test/project-mcp/state.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
git add dsh-hiss-plugins/lib/project-mcp/state.js dsh-hiss-plugins/test/project-mcp/state.test.js
git commit -m "feat(project-mcp): persist per-workspace MCP switch state"
```

---

### Task 2: 弹窗数据组装

**Files:**
- Create: `dsh-hiss-plugins/lib/project-mcp/view.js`
- Test: `dsh-hiss-plugins/test/project-mcp/view.test.js`

**Interfaces:**
- Produces: `buildView({ cwd, toolNames, globalServers = [], workspaceServers = [], disabledTools = [], disabledServers = [] }): View`
  - `View = { cwd, global: Server[], local: Server[] }`
  - `Server = { name, enabled, tools: { name, enabled }[] }`
  - 工具归属：对每个 `mcp__` 前缀名，在 `workspaceServers ∪ globalServers` 里取最长前缀 `mcp__<server>__`；归到工作区服务器的进 `local` 的 tools，否则进 `global`；都不匹配时服务器名取 `name.slice(4).split("__")[0]`
  - `disabledTools` 里的名字即使当前不可见也照样列出（`enabled: false`）
  - `local` 服务器的 `enabled` = 名字不在 `disabledServers`；`global` 服务器恒为 `enabled: true`

- [ ] **Step 1: 写失败测试** `dsh-hiss-plugins/test/project-mcp/view.test.js`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildView } from "../../lib/project-mcp/view.js";

test("longest server prefix owns the tool", () => {
  const view = buildView({
    cwd: "C:\\p",
    toolNames: ["mcp__foo__a", "mcp__foo__bar__b", "mcp__zzz__c", "read"],
    globalServers: ["foo", "foo__bar"],
  });
  const foo = view.global.find((server) => server.name === "foo");
  assert.deepEqual(foo.tools.map((tool) => tool.name), ["mcp__foo__a"]);
  assert.deepEqual(view.global.find((server) => server.name === "foo__bar").tools.map((t) => t.name), ["mcp__foo__bar__b"]);
  assert.deepEqual(view.global.find((server) => server.name === "zzz").tools.map((t) => t.name), ["mcp__zzz__c"]);
});

test("workspace tools are attributed locally and stay visible", () => {
  const view = buildView({ cwd: "C:\\p", toolNames: ["mcp__matlab__run"], globalServers: [], workspaceServers: ["matlab"] });
  assert.deepEqual(view.local, [{ name: "matlab", enabled: true, tools: [{ name: "mcp__matlab__run", enabled: true }] }]);
  assert.deepEqual(view.global, []);
});

test("a disabled workspace server and a disabled global tool keep their rows", () => {
  const view = buildView({
    cwd: "C:\\p",
    toolNames: ["mcp__matlab__run"],
    globalServers: ["cg"],
    workspaceServers: ["matlab"],
    disabledTools: ["mcp__cg__explore"],
    disabledServers: ["matlab"],
  });
  assert.equal(view.local[0].enabled, false);
  assert.deepEqual(view.global.find((server) => server.name === "cg").tools, [{ name: "mcp__cg__explore", enabled: false }]);
});

test("an unknown server is derived from the tool name", () => {
  const view = buildView({ cwd: "C:\\p", toolNames: ["mcp__mystery__t"] });
  assert.deepEqual(view.global, [{ name: "mystery", enabled: true, tools: [{ name: "mcp__mystery__t", enabled: true }] }]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd dsh-hiss-plugins && node --test test/project-mcp/view.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 `view.js`**

复用 `status.js` 的归属思路（最长前缀），但按 server 归组。保持纯函数、无 import（或只 import 常量）。`global` 与 `local` 都按服务器名排序，工具按名字排序，输出稳定便于测试与 UI。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd dsh-hiss-plugins && node --test test/project-mcp/view.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
git add dsh-hiss-plugins/lib/project-mcp/view.js dsh-hiss-plugins/test/project-mcp/view.test.js
git commit -m "feat(project-mcp): assemble the /mcp dialog view"
```

---

### Task 3: `.mcp.json` 条目校验与原子写

**Files:**
- Modify: `dsh-hiss-plugins/lib/project-mcp/config.js`（在现有 `toSpec` 后追加导出，不改既有行为）
- Test: `dsh-hiss-plugins/test/project-mcp/config.test.js`（追加用例）

**Interfaces:**
- Consumes: 现有 `toSpec(serverName, entry, projectDir)`
- Produces:
  - `validateEntry(serverName: string, entry: unknown, projectDir: string): void` — 名字必须匹配 `/^[A-Za-z0-9_-]{1,32}$/`（否则 `throw new Error(`"${serverName}": name must match ...`)`），然后调用 `toSpec` 校验形状
  - `async writeConfig(configPath: string, parsed: object): Promise<void>` — 写 `JSON.stringify(parsed, null, 2) + "\n"`，先写临时文件再 rename，保留文件其它键

- [ ] **Step 1: 追加失败测试**

```js
test("validateEntry rejects an unusable server name", () => {
  assert.throws(() => validateEntry("bad name", { command: "x" }, "."), /name must match/);
});

test("writeConfig keeps unrelated keys and round-trips", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hiss-cfg-"));
  const path = join(dir, ".mcp.json");
  writeFileSync(path, JSON.stringify({ mcpServers: { old: { command: "a" } }, extra: 1 }));
  await writeConfig(path, { mcpServers: { old: { command: "a" }, fresh: { command: "b" } }, extra: 1 });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { mcpServers: { old: { command: "a" }, fresh: { command: "b" } }, extra: 1 });
  rmSync(dir, { recursive: true, force: true });
});
```

（`config.test.js` 顶部补 `validateEntry`、`writeConfig` 到 import 列表；`mkdtempSync/writeFileSync/readFileSync/rmSync/tmpdir/join` 缺哪个补哪个。）

- [ ] **Step 2: 跑确认失败**

Run: `cd dsh-hiss-plugins && node --test test/project-mcp/config.test.js`
Expected: FAIL — `validateEntry is not a function`

- [ ] **Step 3: 实现 `validateEntry` 与 `writeConfig`**

`config.js` 顶部补 `rename`、`writeFile` 到 `node:fs/promises` 的 import，补 `randomUUID`？不需要——临时文件名用 `process.pid` + `Date.now()`。`validateEntry` 放在 `toSpec` 之后，`SERVER_NAME` 常量与现有 `VARIABLE` 同级定义。

- [ ] **Step 4: 跑确认通过**

Run: `cd dsh-hiss-plugins && node --test test/project-mcp/config.test.js`
Expected: PASS（原有 + 2 tests）

- [ ] **Step 5: 提交**

```bash
git add dsh-hiss-plugins/lib/project-mcp/config.js dsh-hiss-plugins/test/project-mcp/config.test.js
git commit -m "feat(project-mcp): validate and atomically write .mcp.json entries"
```

---

### Task 4: 动作分发器

**Files:**
- Create: `dsh-hiss-plugins/lib/project-mcp/actions.js`
- Test: `dsh-hiss-plugins/test/project-mcp/actions.test.js`

**Interfaces:**
- Produces: `async dispatch(body, deps): Promise<{ ok: true, value } | { ok: false, error: { code, message } }>`
  - `deps = { status(sessionId), setTool(sessionId, tool, enabled), setServer(sessionId, server, enabled), add(sessionId, input), promote(sessionId, server) }`
  - `body.action` ∈ `"status" | "set-tool" | "set-server" | "add-server" | "promote"`
  - `body.sessionId` 必须是非空字符串，否则 `{ ok: false, error: { code: "invalid-request", message } }`
  - 未知 action → `code: "unknown-action"`；deps 抛错 → `code: "failed"`，`message` 原样
  - 成功返回 `{ ok: true, value: await deps.<method>(...) }`

- [ ] **Step 1: 写失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../../lib/project-mcp/actions.js";

const deps = (calls) => ({
  status: async (sessionId) => { calls.push(["status", sessionId]); return { global: [], local: [] }; },
  setTool: async (sessionId, tool, enabled) => { calls.push(["setTool", sessionId, tool, enabled]); },
  setServer: async (sessionId, server, enabled) => { calls.push(["setServer", sessionId, server, enabled]); },
  add: async (sessionId, input) => { calls.push(["add", sessionId, input]); },
  promote: async (sessionId, server) => { calls.push(["promote", sessionId, server]); },
});

test("status reaches the dep with the session id", async () => {
  const calls = [];
  const result = await dispatch({ action: "status", sessionId: "s1" }, deps(calls));
  assert.deepEqual(result, { ok: true, value: { global: [], local: [] } });
  assert.deepEqual(calls, [["status", "s1"]]);
});

test("set-tool forwards the switch", async () => {
  const calls = [];
  const result = await dispatch({ action: "set-tool", sessionId: "s1", tool: "mcp__a__t", enabled: false }, deps(calls));
  assert.deepEqual(result, { ok: true, value: undefined });
  assert.deepEqual(calls, [["setTool", "s1", "mcp__a__t", false]]);
});

test("a missing session id is refused without touching deps", async () => {
  const calls = [];
  assert.deepEqual(await dispatch({ action: "status" }, deps(calls)), {
    ok: false, error: { code: "invalid-request", message: "sessionId is required" },
  });
  assert.deepEqual(calls, []);
});

test("an unknown action names itself", async () => {
  assert.deepEqual(await dispatch({ action: "nope", sessionId: "s1" }, deps([])), {
    ok: false, error: { code: "unknown-action", message: 'unknown action "nope"' },
  });
});

test("a dep failure becomes a failed answer, not a throw", async () => {
  const failing = { ...deps([]), setServer: async () => { throw new Error("no such server"); } };
  assert.deepEqual(await dispatch({ action: "set-server", sessionId: "s1", server: "x", enabled: true }, failing), {
    ok: false, error: { code: "failed", message: "no such server" },
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `cd dsh-hiss-plugins && node --test test/project-mcp/actions.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 `actions.js`**

一张 `ACTION_TABLE` 映射 action → 从 body 取参的调用；`typeof body?.action !== "string"` 与未知动作都算 `unknown-action`。`enabled` 必须是 boolean，否则 `invalid-request`。`add` 的 input 为 `body.server`（对象，交给宿主校验）。

- [ ] **Step 4: 跑确认通过**

Run: `cd dsh-hiss-plugins && node --test test/project-mcp/actions.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add dsh-hiss-plugins/lib/project-mcp/actions.js dsh-hiss-plugins/test/project-mcp/actions.test.js
git commit -m "feat(project-mcp): route /mcp dialog actions"
```

---

### Task 5: 宿主接线（挂载句柄、屏蔽、HTTP 路由）

**Files:**
- Modify: `dsh-hiss-plugins/lib/project-mcp/index.js`

**Interfaces:**
- Consumes: `state.js`、`view.js`、`config.js`（`validateEntry`、`writeConfig`）、`actions.js`
- Produces（模块内，不导出新公共契约）：`/hiss-mcp/action` POST 路由，body `{ action, sessionId, ... }`，响应 JSON 为 `dispatch` 的返回值
- 行为要求：
  1. `mountProjectMcp` 把每台已挂载服务器的 fiber 记进 `Map<agent, Map<serverName, fiber>>`；agent 释放时清掉记录
  2. `applyRestriction(agent)`：读该 agent cwd 的状态，`deny` = `disabledTools` ∩ `ctx.tools.schemas(agent)` 的名字；与上次已应用的 deny 集合相同则跳过（避免 `tools/change` 自激）；先释放旧限制 disposer 再 `agent.ctx.tools.restrict({ deny })`（deny 为空就不调用）
  3. 在 `agent/created` 后调用一次；`ctx.on("tools/change", …)` 时对所有 `ctx.agents.list()` 重算
  4. `set-tool`：写状态 → 立刻对目标 agent 重算限制 → 返回 `buildView`
  5. `set-server`：写状态 → 打开时重新 `agent.ctx.plugin(McpClient, config)` 并记 fiber；关闭时 `fiber.dispose()` 并从表里删 → 返回 `buildView`
  6. `add-server`：`scope === "global"` 时 `ctx.settings.update("mcp-manager", { servers: { [name]: entry } })`；否则 `findConfigPath(cwd)` 定位（没有就用 `join(cwd, ".mcp.json")`），读原文（缺失按 `{}`）、`validateEntry`、写入 `parsed.mcpServers[name]`、`writeConfig`，然后按情况重挂该 agent
  7. `promote`：读 `.mcp.json` 该条目 → 映射成 mcp-manager 条目（`transport`/`command`/`args`/`env`/`cwd` 或 `url`/`headers`，`enabled: true`）→ `ctx.settings.update` → 该工作区里把这台服务器状态置为关闭 → 返回 `buildView`
- 路由只做：方法不是 POST → 405；body 不是 JSON 或超过 64 KiB → 400；其余交给 `dispatch`，200 + JSON。`ctx.inject(["webServer"], …)` 里注册；拿不到 `webServer` 就跳过注册（行照常工作）。

- [ ] **Step 1: 实现**（无法离线单测：该文件导入宿主包）

按上面 7 条改 `index.js`。保留现有 `/mcp` 命令行为不变；新增 import：`join`, `readFile`/`writeFile` 已有的 fs 工具、`state.js`、`view.js`、`actions.js`、`config.js` 的新导出。`ctx.settings` 用可选注入（`ctx.get("settings")`），缺失时 `add-server(global)`/`promote` 返回明确错误。

- [ ] **Step 2: 语法/导入自检**

Run: `cd dsh-hiss-plugins && node --input-type=module -e "import('node:fs')" && node --check lib/project-mcp/index.js` （`node --check` 对 ESM 需 `--input-type`；若报错就改用 `node -e "import('./lib/project-mcp/index.js').catch(e=>{ if(!/Cannot find package/.test(e.message)) throw e })"` 并确认失败只来自宿主包解析）
Expected: 无语法错误（宿主包解析失败可接受）

- [ ] **Step 3: 全量单测**

Run: `cd dsh-hiss-plugins && node --test-isolation=none --test`
Expected: PASS（新模块测试 + 原有全部）

- [ ] **Step 4: 提交**

```bash
git add dsh-hiss-plugins/lib/project-mcp/index.js
git commit -m "feat(project-mcp): serve the /mcp dialog actions over the web server"
```

---

### Task 6: 浏览器半（/mcp 弹窗）与包声明

**Files:**
- Modify: `dsh-hiss-plugins/lib/client.js`
- Modify: `dsh-hiss-plugins/package.json`（`dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-commands`）
- Test: `dsh-hiss-plugins/test/client.test.js`（追加断言）

**Interfaces:**
- Consumes: `ctx.commandUi.decorate`、`ctx.slots`（`shell.overlay`）、`fetch("/hiss-mcp/action")`
- Produces:
  - `exports.inject` 增加 `"commandUi"`
  - 模块内 `mcpUi = { store, post }`，store 保存 `{ open: boolean, sessionId }`
  - `decorate({ name: "mcp", available: () => true, ui: { kind: "action", run: (session) => { store.open(session.sessionId) } } })`
  - `shell.overlay` 注册 id `"mcp.dialog"`、order 901 的对话框组件：打开时 POST `{action:"status", sessionId}`；两区渲染；工具/服务器开关 POST 后重新拉状态；「注册到全局」按钮 POST `promote`；底部新增表单 POST `add-server`
  - zh/en 字典补弹窗文案（键两边必须逐一对齐，`test/client.test.js` 会查）

- [ ] **Step 1: 追加失败测试**

在 `test/client.test.js` 已用的假 ctx 上补：`commandUi: { decorate: (decoration) => (decorations.push(decoration), () => {}) }`，并断言：

```js
test("the browser half decorates the host /mcp command", () => {
  assert.ok(inject.includes("commandUi"));
  assert.equal(decorations.length, 1);
  assert.equal(decorations[0].name, "mcp");
  assert.equal(decorations[0].ui.kind, "action");
});

test("the dialog occupies the shell overlay next to the phone popup", () => {
  const ids = overlays.map((entry) => entry.registration.id);
  assert.deepEqual(ids.sort(), ["lan-access.popup", "mcp.dialog"]);
});
```

并断言 `package.json.dsh.client.inject` 含 `"@deepseek-ai/dsh-client-ui-commands"`。

- [ ] **Step 2: 跑确认失败**

Run: `cd dsh-hiss-plugins && node --test test/client.test.js`
Expected: FAIL —— 没有 `commandUi` 调用/没有第二个 overlay

- [ ] **Step 3: 实现客户端**

沿用 `lanUi` 的模块级共享模式；对话框组件单独函数 `McpDialog`，样式常量照 `LAN_*` 的写法加一组 `MCP_*`。`post(body)`：`fetch("/hiss-mcp/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })`，非 2xx 或 `ok:false` 抛 `Error`。开关用 `<input type="checkbox">`；新增表单用 `<input>`/`<select>`。所有文案走 `t()`。

- [ ] **Step 4: 跑确认通过**

Run: `cd dsh-hiss-plugins && node --test test/client.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add dsh-hiss-plugins/lib/client.js dsh-hiss-plugins/package.json dsh-hiss-plugins/test/client.test.js
git commit -m "feat(client): open the MCP dialog on a bare /mcp"
```

---

### Task 7: 文档与全套验证

**Files:**
- Modify: `AGENTS.md`（§1 的 `lib/project-mcp/` 行、§2.2 的浏览器半说明）
- Modify: `dsh-hiss-plugins/README.md`（若其中描述 `/mcp`）

- [ ] **Step 1: 改文档**

`lib/project-mcp/` 那格补：`state.js`（按工作区开关状态）、`view.js`（弹窗数据）、`actions.js`（动作分发）、`/hiss-mcp/action` 路由、裸 `/mcp` 在浏览器半弹窗。§2.2 补一句 `commandUi.decorate` 的用法与 `dsh.client.inject` 的新包名。

- [ ] **Step 2: 全量测试**

Run: `cd dsh-hiss-plugins && node --test-isolation=none --test`
Expected: PASS，输出每个测试文件的结果

- [ ] **Step 3: 真实安装冒烟（可选，需要联网与 dsh）**

Run: `cd C:\\Mine\\dsh-hiss-plugins && node scripts/smoke-profile.mjs`
Expected: 通过；若环境不满足（无网/无 pnpm），在交付说明里如实记录未跑。

- [ ] **Step 4: 提交**

```bash
git add AGENTS.md dsh-hiss-plugins/README.md
git commit -m "docs: describe the /mcp dialog"
```
