# @hilariouhiss/dsh-codegraph

把 [codegraph](https://github.com/colbymchenry/codegraph)（本地优先的代码图 / 知识图谱，让 AI agent 用「预建的符号·调用边·依赖图」回答代码结构问题，而非逐文件 grep）接入 DeepSeek Harness。

本插件以 DSH **bundle 插件**形式，通过 DSH 内置的 MCP 客户端桥（`@deepseek-ai/dsh-mcp-client`）连接 CodeGraph 的 MCP server，注册 `mcp__codegraph__*` 工具，并注入一条轻量使用引导。安装后对 `web`、`headless` 等任意 profile 的所有会话生效。

## 功能

- 注册 **`mcp__codegraph__codegraph_explore`** 工具：一次调用返回相关符号的逐字源码（按文件分组）、符号间调用链（含动态分派跳转）与影响范围（blast radius）。
- 注入系统提示词引导，让智能体对结构性问题（「X 如何工作」「X 如何到达 Y」「改某处会影响什么」）**优先直接调 `codegraph_explore`**，而不是 grep/逐文件读，并**传 `projectPath`** 指向当前工作区。
- 引导段每回合检查当前工作区是否已有 `.codegraph/`：**没有**时多注入一句，带上可直接执行的 `codegraph init -y`，让智能体先建图再检索，而不是撞一次「无索引」错误。

## 前置要求

1. 全局安装 CodeGraph CLI（`codegraph` 需在 DSH 宿主进程的 PATH 上）：

   ```powershell
   npm i -g @colbymchenry/codegraph
   # 或：irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex
   ```

2. 每个项目首次建图（生成 `.codegraph/` 索引；之后 MCP server 的 watcher 自动增量同步）：

   ```powershell
   cd <your-project>
   codegraph init
   ```

## 安装

```powershell
dsh plugin --profile web add @hilariouhiss/dsh-codegraph
```

把 `web` 换成你的 profile 名（例如 `headless`）。然后**重启 dsh**。

`dsh plugin` 会把本包安装进 profile 的 `node_modules`；因为 `package.json` 声明了 `dsh.bundle.patch`，profile 的 bundle 列表会自动追加 `@hilariouhiss/dsh-codegraph`，重启后插件行自动激活。

## 验证

1. 重启后，让模型回答一个代码结构问题（如「这个请求是怎么到达数据库的」），观察它调用 `mcp__codegraph__codegraph_explore` 且返回源码 + 调用链。
2. 若某项目尚未建图，引导段会直接给出 `codegraph init -y`，模型可先建图再检索（MCP server 只暴露 `codegraph_explore`，没有任何工具能替它建图，所以这一步必须由模型执行）。

## 卸载

```powershell
dsh plugin --profile web remove @hilariouhiss/dsh-codegraph
```

然后重启 dsh。

## 已知问题与限制

当前实现是「MCP server 直连 + 动态引导」的最小可行集成，已知有以下问题：

1. **模型仍需手动传 `projectPath`（部分缓解）**：DSH 宿主是单实例、多会话（多工作区），而 mcp-client 的 `cwd` 是宿主面静态配置（`process.cwd()`）。`codegraph_explore` 无法默认指向「当前会话工作区」，模型每次调用仍要自己填 `projectPath`。引导文本现已**动态注入当前会话工作区的绝对路径**，降低漏填/填错概率；但工具本身仍未自动注入。理想做法是包装一个能自动注入会话 `cwd` 的工具，或让 server 按会话定位项目。

2. **自动同步只覆盖 MCP server 默认目录的项目**：codegraph 的文件 watcher 只持续监视 MCP server 启动 `cwd` 对应的项目（在 DSH 里即 `dsh` 进程的工作目录）；经 `projectPath` 查询的其它项目没有持续 watcher，索引不会随编辑自动刷新，需手动 `codegraph sync`。因此当**会话工作区 ≠ dsh 启动目录**时（例如在 `C:\Users\<你>` 起 `dsh web`、却让会话在别的仓库里工作），该仓库的索引不会自动跟进。对策：在目标仓库目录里启动 `dsh`，或手动 `codegraph sync`。

3. **不代建索引**：插件不后台跑 `codegraph init`。项目完全没建过图时，由**引导段提示模型自己执行** `codegraph init -y`（一行提示，零后台进程；`.codegraph/` 存在后该提示自动消失）。

## 开发

```powershell
pnpm install
pnpm test
```

结构：

```
lib/index.js        插件入口：apply(ctx) 用 ctx.plugin 加载 mcp-client + 注入引导
cordis.patch.yml    bundle patch：插入本插件的宿主行
test/               node:test 单元测试（config 组装、plugin 加载、引导注册）
```

## 发布（给维护者）

```powershell
cd dsh-codegraph
pnpm install
pnpm test
npm login       # 首次发布前登录 npm
npm publish     # publishConfig.access 已设为 public
```

`prepublishOnly` 会在每次发布前自动运行 `npm test`；发布新版本前记得递增 `package.json` 的 `version`。

## 许可与来源

本插件为 MIT 许可。它只通过 MCP 连接外部的 `codegraph` CLI，未内置 codegraph 源码；codegraph 本身来自 [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)（© Colby McHenry，MIT，其自身许可见上游仓库）。

> `@deepseek-ai/dsh-mcp-client` 由**正在运行的 dsh 安装**提供，本包只在 `peerDependencies` 里声明（`devDependencies` 供本仓测试）。**不要**把它写进 `dependencies` —— 那会让 pnpm 往 profile 里塞一份自己的副本，遮蔽安装目录里的同名包，两代混装会让整棵插件树启动失败。升级 dsh 后先跑 `node ../scripts/smoke-profile.mjs` 再发版。
