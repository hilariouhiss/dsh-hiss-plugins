# dsh-ponytail

把 [ponytail](https://github.com/DietrichGebert/ponytail)（“让 AI agent 像房间里最懒的资深开发者一样思考。最好的代码是你从没写过的代码。”）移植为 DeepSeek Harness 插件。

本插件以 DSH **bundle 插件**形式提供 6 个技能 + 6 个宿主侧斜杠命令，安装后对 `web`、`headless` 等任意 profile 的所有会话生效。

## 功能

| 技能 / 命令 | 作用 |
|---|---|
| `ponytail` / `/ponytail [lite\|full\|ultra\|off]` | 懒惰开发模式本体：能省则省，YAGNI → 标准库 → 平台原生 → 一行代码 → 最小实现。切换强度或关闭。 |
| `ponytail-review` / `/ponytail-review` | 只针对“过度工程”的变更评审：该删什么、用什么替代。 |
| `ponytail-audit` / `/ponytail-audit` | 全仓库过度工程审计：按可删减量排序的报告。 |
| `ponytail-debt` / `/ponytail-debt` | 收集代码里的 `ponytail:` 注释，生成“技术债”台账。 |
| `ponytail-gain` / `/ponytail-gain` | 显示 ponytail 的量化收益记分板（代码/成本/速度）。 |
| `ponytail-help` / `/ponytail-help` | 快速参考卡。 |

行为要点：

- **系统提示词引导**：会话开始时注入一行轻量引导，提示模型在编码任务前用 `skill` 工具加载 `ponytail` 技能（不是把完整指令塞进每次会话）。
- **命令注入**：执行任意 `/ponytail*` 命令会把对应技能内容作为用户消息注入会话（与内置 `/goal` 同一机制），模型下一步即可读到。
- 说 `stop ponytail` 或 `normal mode` 即可关闭（由模型按技能指令处理，无需插件逻辑）。

## 安装

```powershell
dsh plugin --profile web add C:\source_code\Other\dsh-ponytail
```

然后**重启 dsh**（关闭并重新运行 `dsh --profile web`，其他 profile 同理）。

`dsh plugin` 会把本包安装进 profile 的 `node_modules`；因为 `package.json` 声明了 `dsh.bundle.patch`，profile 的 bundle 列表会自动追加 `dsh-ponytail`，重启后插件行自动激活。

## 验证

1. 在 GUI 新建会话，输入任意内容后，会话目录应包含 6 个 `ponytail*` 技能。
2. 让模型“加载 ponytail 技能”，或直接输入 `/ponytail help`，应能看到技能内容 / 命令执行结果。
3. 输入 `/ponytail ultra` 切换强度，或说 “stop ponytail” 关闭。

## 配置

引导提示默认开启。沿用上游配置来关闭它：

- 环境变量：`PONYTAIL_DEFAULT_MODE=off`
- 配置文件：`%APPDATA%\ponytail\config.json`（Windows）或 `~/.config/ponytail/config.json`，内容 `{ "defaultMode": "off" }`

优先级：环境变量 > 配置文件 > 默认 `full`。`off` 仅关闭系统提示词引导，技能目录与命令仍可用。

## 卸载

```powershell
dsh plugin --profile web remove dsh-ponytail
```

然后重启 dsh。

## 本地覆盖

若你在 `~/.dsh/skills/` 或项目 `.dsh/skills/` 放了同名技能，DSH 会优先使用本地副本（技能注册表的层级语义），可用于定制 ponytail 行为。

## 开发

```powershell
pnpm install
pnpm test
```

结构：

```
lib/index.js        插件入口:apply(ctx) 注册 provider + 提示词 section + 6 命令
lib/provider.js     全局层技能 provider(扫描 skills/ 目录)
lib/frontmatter.js  YAML frontmatter 解析
lib/commands.js     6 个 /ponytail* 命令
skills/             6 个技能目录(上游 SKILL.md 逐字复制)
cordis.patch.yml    bundle patch:插入本插件的宿主行
test/               node:test 单元测试
```

## 许可与来源

本插件为 MIT 许可。技能内容（`skills/**`）逐字来自 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) v4.9.0（© Dietrich Gebert，MIT）。

> 提示：若日后升级 dsh 后 `@deepseek-ai/dsh-skill` / `@deepseek-ai/dsh-llm` 的公开 API 发生变化，需同步更新本插件的依赖版本。
