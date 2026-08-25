# dsh-plugins

DeepSeek Harness (dsh) 插件集合仓库。

## 插件列表

| 插件 | 说明 |
|------|------|
| [dsh-ponytail](dsh-ponytail)（npm: `@hilariouhiss/dsh-ponytail`） | Lazy senior dev 模式插件，源自 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |

## 添加新插件

新建目录 `<plugin-name>/`，复制插件源码与 `package.json` 即可。

## 发布

各插件在根目录有对应的便捷发布脚本。首次发布前先登录 npm，并确保依赖已安装：

```powershell
cd dsh-ponytail
pnpm install
npm login
cd ..
npm run publish:dsh-ponytail
```

## 上游来源

- [ponytail (DietrichGebert)](https://github.com/DietrichGebert/ponytail)：Lazy senior dev 模式，强制最简可行方案（YAGNI），全套技能与模式文档见上游仓库。
