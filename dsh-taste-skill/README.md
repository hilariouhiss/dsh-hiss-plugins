# @hilariouhiss/dsh-taste-skill

把 [taste-skill](https://github.com/Leonxlnx/taste-skill)（“给 AI 一副好品味，止住无聊、千篇一律的产出”）移植为 DeepSeek Harness 插件。

本插件以 DSH **bundle 插件**形式提供 **13 个技能**，安装后对 `web`、`headless` 等任意 profile 的所有会话生效。它只注册技能来源：**没有斜杠命令，也不注入系统提示词段** —— 技能目录本身进入会话的技能清单，模型按各技能的 `description` 自行选用。

## 技能

| 技能 | 作用 |
|---|---|
| `design-taste-frontend` | 默认设计技能（v2 实验）：读 brief、推断设计语言、调 VARIANCE / MOTION / DENSITY 三档，产出不像模板的落地页、作品集与改版；含硬规则 pre-flight 自检。 |
| `design-taste-frontend-v1` | v1 原版，仅为依赖其精确行为的项目保留。 |
| `gpt-taste` | Awwwards 级前端与 GSAP 动效：布局随机化、AIDA 结构、宽排版（禁 6 行折行）、无缝隙 bento、严格 ScrollTrigger。 |
| `redesign-existing-projects` | 既有站点/应用审计 → 升级到高级质感，不破坏现有功能，兼容任意 CSS 方案。 |
| `high-end-visual-design` | “贵”的观感规格：字体、间距、阴影、卡片结构、动效，并封掉让 AI 设计显廉价的默认套路。 |
| `minimalist-ui` | 编辑式极简：暖色单色、排版对比、扁平 bento、克制柔和色；无渐变、无重阴影。 |
| `industrial-brutalist-ui` | 粗野主义 / 军用终端美学：刚性网格、极端字号对比、实用主义配色、模拟劣化。 |
| `imagegen-frontend-web` | **只出图**：为落地页每个 section 生成独立横向设计参考图（不写代码）。 |
| `imagegen-frontend-mobile` | **只出图**：iOS / Android / 跨端屏幕概念与流程（不写代码）。 |
| `brandkit` | **只出图**：品牌规范板、logo 系统、色板、字体、样机（不写代码）。 |
| `image-to-code` | 先自行生成设计图 → 深读 → 实现到贴合；倾向大而可读的分区配图，避免“卡片套卡片套卡片”。 |
| `stitch-design-taste` | 为 Google Stitch 生成语义化 `DESIGN.md` 设计系统（严格排版、校准色、非对称布局、常驻微动效）。 |
| `full-output-enforcement` | 压制截断与占位符：强制完整输出，并干净处理 token 上限切分。 |

## 安装

```powershell
dsh plugin --profile web add @hilariouhiss/dsh-taste-skill
```

把 `web` 换成你的 profile 名（例如 `headless`）。然后**重启 dsh**（关闭并重新运行 `dsh --profile web`）。

`dsh plugin` 会把本包安装进 profile 的 `node_modules`；因为 `package.json` 声明了 `dsh.bundle.patch`，profile 的 bundle 列表会自动追加 `@hilariouhiss/dsh-taste-skill`，重启后插件行自动激活。

尚未发布时，可从本仓本地安装（开发用）：

```powershell
dsh plugin --profile web add link:C:\Mine\dsh-hiss-plugins\dsh-taste-skill
```

## 验证

1. 新建会话，会话技能清单里应出现 13 个技能（`design-taste-frontend`、`minimalist-ui`、`brandkit` …）。
2. 让模型“加载 `design-taste-frontend` 技能”，或直接派一个落地页设计任务，应看到该技能内容被读取后生效。

## 卸载

```powershell
dsh plugin --profile web remove @hilariouhiss/dsh-taste-skill
```

然后重启 dsh。

## 本地覆盖

技能注册表按 rank 分层，rank 越小越优先：

| 来源 | rank |
|---|---|
| 项目 `.dsh/skills/` | 100 |
| 项目 `.agents/skills/` | 200 |
| 自定义（命令行指定） | 300 |
| 用户 `~/.dsh/skills/` | 400 |
| 用户 `~/.agents/skills/` | 500 |
| **本插件（bundled）** | **600** |

因此：想调整某个 taste 技能，把同名目录放进 `~/.dsh/skills/`（或项目 `.dsh/skills/`）即可覆盖本包的副本，不必 fork 本包；反过来，`~/.agents/skills/` 里已有的同名技能会**盖住本插件的同名副本**（内容一致时无行为差异，但升级本插件后请留意旧副本仍在生效）。

## 开发

```powershell
pnpm install
pnpm test
```

结构：

```
lib/index.js        插件入口:apply(ctx) 只注册 makeSkillProvider
skills/             13 个上游技能目录(逐字复制,含 stitch-skill/DESIGN.md 与上游 llms.txt)
cordis.patch.yml    bundle patch:插入本插件的宿主行
test/               node:test 单元测试(真实解析 vendored skills/)
```

测试是端到端的：它实例化插件注册的 provider，对 `skills/` 真实 `list()` + `get()`，因此任何一个 SKILL.md 的 frontmatter 变得不合规（或漏进 `files`）都会让测试红掉，而不是只在运行时打一条 warn。

## 发布（给维护者）

```powershell
cd dsh-taste-skill
pnpm install
pnpm test
npm login       # 首次发布前登录 npm
npm publish     # publishConfig.access 已设为 public
```

`prepublishOnly` 会在每次发布前自动运行 `npm test`；发布新版本前记得递增 `package.json` 的 `version`。

## 许可与来源

本插件为 MIT 许可。技能内容（`skills/**`）逐字来自 [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) commit `ccbc156`（2026-08-24，© 2026 Leonxlnx，MIT），未做任何本地改动。上游升级时整体覆盖 `skills/`，然后跑测试（§开发）并把上面的 commit 号更新为新的上游版本。

> `@deepseek-ai/dsh-skill` / `@deepseek-ai/dsh-llm` 由**正在运行的 dsh 安装**提供，本包只在 `peerDependencies` 里声明（`devDependencies` 供本仓测试）。**不要**把它们写进 `dependencies` —— 那会让 pnpm 往 profile 里塞一份自己的副本，遮蔽安装目录里的同名包，两代混装会让整棵插件树启动失败。升级 dsh 后先跑 `node ../scripts/smoke-profile.mjs` 再发版。
