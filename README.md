# dsh-plugins

DeepSeek Harness (dsh) 插件集合仓库（pnpm workspace 单仓）。

## 插件列表

| 插件 | 说明 |
|------|------|
| [dsh-ponytail](dsh-ponytail)（npm: `@hilariouhiss/dsh-ponytail`） | Lazy senior dev 模式插件，源自 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |
| [dsh-superpowers](dsh-superpowers)（npm: `@hilariouhiss/dsh-superpowers`） | Superpowers 软件开发方法论插件（brainstorming、TDD、系统化调试、subagent 驱动开发等 14 个技能 + 会话引导），源自 [obra/superpowers](https://github.com/obra/superpowers) |
| [dsh-openspec](dsh-openspec)（npm: `@hilariouhiss/dsh-openspec`） | OpenSpec spec-driven 开发工作流插件（propose/explore/apply/archive 等 12 个技能 + `/opsx-*` 命令，需 `openspec` CLI），源自 [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) |
| [dsh-colgrep](dsh-colgrep)（npm: `@hilariouhiss/dsh-colgrep`） | colgrep 语义代码检索插件（`colgrep` 工具，按含义而非精确文本找代码，需 `colgrep` CLI），源自 [lightonai/next-plaid](https://github.com/lightonai/next-plaid) |

## 共享依赖

[dsh-skill-kit](dsh-skill-kit)（npm: `@hilariouhiss/dsh-skill-kit`）是三个插件共用的运行时依赖：SKILL.md frontmatter 解析、目录型 skill provider、以及 `/命令 → 技能` 的注册逻辑。它是普通 npm 包（非 dsh 插件），必须先于插件发布。

## 开发

```powershell
pnpm install   # 根目录一次安装，全仓共享
pnpm test      # 运行所有包的测试
```

## 添加新插件

1. 新建目录 `<plugin-name>/`，复制插件源码与 `package.json`，声明 `dsh.bundle.patch`（参见已有插件的 `cordis.patch.yml` 与 `package.json`）。
2. 将该目录加进根目录 `pnpm-workspace.yaml` 的 `packages` 列表。

## 发布

首次登录 npm（一次即可）：在任一包目录执行 `npm login`。

先发布共享依赖，再发布各插件：

```powershell
pnpm run publish:dsh-skill-kit
pnpm run publish:dsh-ponytail
pnpm run publish:dsh-superpowers
pnpm run publish:dsh-openspec
```

## 上游来源

- [ponytail (DietrichGebert)](https://github.com/DietrichGebert/ponytail)：Lazy senior dev 模式，强制最简可行方案（YAGNI），全套技能与模式文档见上游仓库。
- [superpowers (obra)](https://github.com/obra/superpowers)：完整软件开发方法论（brainstorming → 实现计划 → TDD → 系统化调试 → subagent 驱动开发 → 评审 → 收尾），14 个组合技能 + 会话引导。
- [OpenSpec (Fission-AI)](https://github.com/Fission-AI/OpenSpec)：AI-native spec-driven 开发，先对齐规格再写代码；12 个 workflow 技能驱动 `openspec` CLI（propose/explore/apply/archive 等）。
