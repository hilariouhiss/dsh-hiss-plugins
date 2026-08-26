# @hilariouhiss/dsh-codegraph

把 [codegraph](https://github.com/colbymchenry/codegraph)（本地优先的代码图 / 知识图谱，让 AI agent 用「预建的符号·调用边·依赖图」回答代码结构问题，而非逐文件 grep）接入 DeepSeek Harness。

本插件以 DSH **bundle 插件**形式，通过 DSH 内置的 MCP 客户端桥（`@deepseek-ai/dsh-mcp-client`）连接 CodeGraph 的 MCP server，注册 `mcp__codegraph__*` 工具，并注入一条轻量使用引导。安装后对 `web`、`headless` 等任意 profile 的所有会话生效。

## 功能

- 注册 **`mcp__codegraph__codegraph_explore`** 工具：一次调用返回相关符号的逐字源码（按文件分组）、符号间调用链（含动态分派跳转）与影响范围（blast radius）。
- 注入系统提示词引导，让智能体对结构性问题（「X 如何工作」「X 如何到达 Y」「改某处会影响什么」）**优先直接调 `codegraph_explore`**，而不是 grep/逐文件读，并**传 `projectPath`** 指向当前工作区。

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
2. 若某项目尚未建图，工具会返回「无索引」提示——在该项目跑一次 `codegraph init` 即可。

## 卸载

```powershell
dsh plugin --profile web remove @hilariouhiss/dsh-codegraph
```

然后重启 dsh。

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

> 提示：若日后升级 dsh 后 `@deepseek-ai/dsh-mcp-client` 的公开 API 发生变化，需同步更新本插件的依赖版本。
