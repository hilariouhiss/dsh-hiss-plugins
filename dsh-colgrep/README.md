# @hilariouhiss/dsh-colgrep

把 [colgrep](https://github.com/lightonai/next-plaid/tree/main/colgrep)（LightOn 的语义代码检索工具：ColBERT 多向量搜索，按“含义”而非“精确文本”找代码）接入 DeepSeek Harness。

本插件以 DSH **bundle 插件**形式提供一个宿主侧模型工具 `colgrep`，安装后对 `web`、`headless` 等任意 profile 的所有会话生效。

## 功能

注册一个 `colgrep` 工具，智能体可用自然语言检索工作区代码，例如：

- `colgrep "error handling for database connections"`
- `colgrep "auth" -e "async fn" --include "*.rs"`
- `colgrep command:"init"` / `command:"status"` / `command:"clear"`

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
- **索引重定位**：DSH 文件沙箱禁止写工作区之外，而 colgrep 检索需要写索引锁文件。插件把索引目录重定位到 `<工作区>/.colgrep-data`（通过 `COLGREP_DATA_DIR`），使全部写入落在沙箱允许范围内。ColBERT 模型与 ONNX runtime 从 `~/.cache` 只读加载，无需联网。
- **显式根目录**：`root` 只改变检索**运行的位置**（`workdir`），不改变索引位置 —— 索引数据始终留在 `<工作区>/.colgrep-data`，因为 colgrep 的索引是**按项目注册的**（`<data_dir>/indices/<项目名>-<hash>`），一个数据目录可以同时容纳多个项目的索引，跨项目检索不会把数据写到别人的仓库里。**真正限制结果范围的是 `root`**（换项目）；`path` 相对 `root` 解析（无 `root` 时相对工作区，与旧行为一致），只做聚焦、不保证排他。
- 首次检索会自动建立索引（CPU 上大仓库可能需数分钟）；可用 `command:"init"` 显式建索引，`no_update:true` 走现有索引。
- **主动使用**：注册 `colgrep:guidance` 提示词段（每回合重算，带上当前会话工作区路径），让模型在「按含义找代码、但说不出确切标识符」时优先用 `colgrep` 而不是 grep。

## 前置要求

- 已安装 [colgrep](https://github.com/lightonai/next-plaid/tree/main/colgrep) CLI（`cargo install colgrep` 或官方预编译二进制），且 `colgrep` 在 PATH 上。
- 首次使用前，colgrep 需已下载默认模型 `lightonai/LateOn-Code-edge`（`colgrep "任意查询"` 会自动下载；私有模型需 `HF_TOKEN`，可用 `colgrep set-model` 切换）。

## 安装

```powershell
dsh plugin --profile web add @hilariouhiss/dsh-colgrep
```

把 `web` 换成你的 profile 名（例如 `headless`）。然后**重启 dsh**。

`dsh plugin` 会把本包安装进 profile 的 `node_modules`；因为 `package.json` 声明了 `dsh.bundle.patch`，profile 的 bundle 列表会自动追加 `@hilariouhiss/dsh-colgrep`，重启后插件行自动激活。

## 验证

1. 重启后在会话中让模型调用 `colgrep`，例如“用 colgrep 搜索 error handling 相关代码”。
2. 或让模型执行 `colgrep command:"status"`，应看到当前工作区的索引状态。

## 卸载

```powershell
dsh plugin --profile web remove @hilariouhiss/dsh-colgrep
```

然后重启 dsh。

## 开发

```powershell
pnpm install
pnpm test
```

结构：

```
lib/index.js        插件入口：apply(ctx) 注册 colgrep 工具（defineTool）
cordis.patch.yml    bundle patch：插入本插件的宿主行
test/               node:test 单元测试（argv 组装、渲染、execute 管道）
```

## 发布（给维护者）

```powershell
cd dsh-colgrep
pnpm install
pnpm test
npm login       # 首次发布前登录 npm
npm publish     # publishConfig.access 已设为 public
```

`prepublishOnly` 会在每次发布前自动运行 `npm test`；发布新版本前记得递增 `package.json` 的 `version`。

## 许可与来源

本插件为 MIT 许可。它只调用外部的 `colgrep` CLI，未内置 colgrep 源码；colgrep 本身来自 [lightonai/next-plaid](https://github.com/lightonai/next-plaid)（© LightOn，其自身许可见上游仓库）。

> `@deepseek-ai/dsh-tools` 由**正在运行的 dsh 安装**提供，本包只在 `peerDependencies` 里声明（`devDependencies` 供本仓测试）。**不要**把它写进 `dependencies` —— 那会让 pnpm 往 profile 里塞一份自己的副本，遮蔽安装目录里的同名包，两代混装会让整棵插件树启动失败。升级 dsh 后先跑 `node ../scripts/smoke-profile.mjs` 再发版。
