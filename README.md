# dsh-plugins

DeepSeek Harness (dsh) 插件集合仓库。

## 插件列表

| 插件 | 说明 |
|------|------|
| [dsh-ponytail](dsh-ponytail)（npm: `@hilariouhiss/dsh-ponytail`） | Lazy senior dev 模式插件，源自 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |
| [dsh-superpowers](dsh-superpowers)（npm: `dsh-superpowers`） | Superpowers 软件开发方法论插件（brainstorming、TDD、系统化调试、subagent 驱动开发等 14 个技能 + 会话引导），源自 [obra/superpowers](https://github.com/obra/superpowers) |

## 添加新插件

新建目录 `<plugin-name>/`，复制插件源码与 `package.json`，并声明 `dsh.bundle.patch`（参见已有插件的 `cordis.patch.yml` 与 `package.json`）。

## 发布

各插件在根目录有对应的便捷发布脚本。首次发布前先登录 npm（一次即可），并确保依赖已安装：

```powershell
cd dsh-ponytail
pnpm install
cd ..
npm run publish:dsh-ponytail

# 或发布 dsh-superpowers：
cd dsh-superpowers
pnpm install
cd ..
npm run publish:dsh-superpowers
```

首次登录：在任一插件目录执行 `npm login`。

## 上游来源

- [ponytail (DietrichGebert)](https://github.com/DietrichGebert/ponytail)：Lazy senior dev 模式，强制最简可行方案（YAGNI），全套技能与模式文档见上游仓库。
- [superpowers (obra)](https://github.com/obra/superpowers)：完整软件开发方法论（brainstorming → 实现计划 → TDD → 系统化调试 → subagent 驱动开发 → 评审 → 收尾），14 个组合技能 + 会话引导。
