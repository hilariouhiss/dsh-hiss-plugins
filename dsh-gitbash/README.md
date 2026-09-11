# @hilariouhiss/dsh-gitbash

在 Windows 上把 **Git Bash** 接入 DeepSeek Harness，成为一个一级 shell：注册 `bash` 模型工具（`bash -c`），由 Git for Windows 的 `bash.exe` 真实执行。

本插件以 DSH **bundle 插件**形式提供，安装后对 `web`、`headless` 等任意 profile 的**所有 preset、所有会话**生效（工具进入 global `tools` 层，与 `dsh-colgrep` 等同机制）。

## 为什么需要它

Windows 上 DSH 自带的 shell 工具是 `pwsh`（PowerShell）；想让智能体跑 shell 脚本、`grep`/`sed`/`ls` 那一套，需要 bash。而 Windows 上直接找 `bash` 有两个坑：

1. PATH 上的 `bash` 通常是 **WSL** 的 `C:\Windows\System32\bash.exe`——它跑在 Linux 虚拟机里，`cwd`、路径、文件系统全都不是 Git Bash 的那一套；
2. DSH 在 Windows 上的文件沙箱用**受限令牌**（write-restricted token）包裹每条命令，而 MSYS2 运行时启动时需要创建带用户 SID 的命名对象，受限令牌必然拒绝。

本插件解决第 1 点（解析出真正的 Git for Windows `bash.exe`），并如实登记第 2 点的后果（见下面的模式表）。

## 三种权限模式下的行为

**宿主原有的三档权限模式语义完全不变**：本插件不替换 `pwsh-sandbox`，不改任何沙箱行，`pwsh` 工具与文件沙箱一切照旧。差别只在于 `bash` 工具能在哪一档下真正跑起来：

| 会话权限模式 | `bash` 工具的行为 | `pwsh` 工具 |
|---|---|---|
| 完全权限 `danger-full-access` | 直接运行 Git Bash（不套沙箱），一切正常 | 照旧 |
| 工作区内修改 `workspace-write` | MSYS2 无法在受限令牌下启动 → 结果返回 `[sandbox: file access denied under workspace-write mode]` 与升级提示；模型可用 `sandbox_permissions: "danger-full-access"` + 一句 `justification` **单次升级**（走正常审批），批准后 Git Bash 真正执行 | 照旧（受限、可用） |
| 仅可查看 `read-only` | 同上（受限令牌一样无法启动 MSYS2），升级路径相同 | 照旧 |

也就是说：**想不受打扰地用 Git Bash，就把会话权限切到「完全权限」**；留在受限模式时，PowerShell 仍是可用的受限 shell，Git Bash 通过按次审批的升级路径使用。这是沙箱的边界，不是插件的取舍——插件不绕过它。

受限模式下 `bash` 调用失败时的真实 stderr 形如：

```text
      0 [main] bash (16432) C:\Software\Git\bin\..\usr\bin\bash.exe: *** fatal error -
      couldn't create signal pipe, Win32 error 5
[sandbox: file access denied under workspace-write mode]
```

插件把这条启动失败**登记为沙箱拒绝特征**（该行文本 + 非零退出码），因此框架会用标准拒绝面与同轮升级提示呈现它，而不是抛一个看不懂的崩溃；同时在 stderr 末尾追加一句成因说明。

## 前置要求

- Windows（非 win32 平台整组自动禁用，零影响）；
- 已安装 [Git for Windows](https://git-scm.com/download/win)，且能按下列任一方式被解析到：
  1. 环境变量 `DSH_GIT_BASH` 指向 `bash.exe`（优先级最高，非标准/便携安装用这个）；
  2. 环境变量 `GIT_ROOT` / `GIT_INSTALL_ROOT` 指向安装根目录；
  3. PATH 里有 `<安装根>\cmd\git.exe`（Git for Windows 默认安装会加）；
  4. 默认安装位置：`%ProgramFiles%\Git`、`%ProgramFiles(x86)%\Git`、`%LOCALAPPDATA%\Programs\Git`。

解析只认 Git for Windows 的目录结构（`bin/bash.exe` 旁边有 `cmd/git.exe` 或 `usr/bin/bash.exe`），所以 `System32`、`WindowsApps` 里的 WSL 启动器**永远不会**被当成 Git Bash。`DSH_GIT_BASH` / `GIT_ROOT` 指错了会直接报错而不是悄悄回退——避免跑成另一个 shell。

## 安装

```powershell
dsh plugin --profile web add @hilariouhiss/dsh-gitbash
```

把 `web` 换成你的 profile 名。然后**重启 dsh**。

解析成功时执行器输出一行 info 级日志 `dsh-gitbash: confined shell git bash = <路径>`（是否出现在控制台取决于该 profile 的日志等级）。解析失败则**启动即报错、插件树不加载**（fail loud，不会悄悄回退到别的 shell）：

```text
Error: dsh: plugin tree failed to load: failed to apply loader entry git-bash (cordis:group):
failed to apply loader entry git-bash-executor (@hilariouhiss/dsh-gitbash/executor):
dsh-gitbash: DSH_GIT_BASH points at a missing file: C:\Definitely\Not\Here\bash.exe
```

验证：任一会话里让智能体执行 `bash -c "uname -o; pwd"`。完全权限下应返回 `Msys` 与 `/c/...` 形式的路径（WSL 会是 `GNU/Linux` 与 `/mnt/c/...`）。

## 配置

本插件没有配置文件，只有两个环境变量（在启动 dsh 之前设置）：

| 变量 | 作用 |
|---|---|
| `DSH_GIT_BASH` | 直接指定要执行的 `bash.exe`（最高优先级） |
| `GIT_ROOT` / `GIT_INSTALL_ROOT` | 指定 Git for Windows 安装根目录 |

## 工作原理

`cordis.patch.yml` 只插入**一个带 realm 的 group**，里面两行：本包的执行器（`@hilariouhiss/dsh-gitbash/executor`，提供 `ctx.shell`）与 DSH 自带的 `bash` 工具（`@deepseek-ai/dsh-tool-bash`，消费 `ctx.shell`）。

- **为什么用 realm 组，而不是替换宿主的 shell 行**：`ctx.shell` 在 Windows 上已由 `pwsh-sandbox` 提供，替换它会连 `pwsh` 工具一起劫持（一个跑 bash 的 PowerShell 工具），并使所有声明 `tool-pwsh` 的预设失效。组内 `isolate: { shell: true }` 让 loader 给这一组一份**私有** `shell` 实例：宿主的 `pwsh-sandbox` 继续供给根 realm，所有既有行与预设解析到的还是它；`bash` 工具必须待在组内（消费方留在 provider 的 realm 之外会解析到宿主的 pwsh 执行器）。
- **为什么连 `settings` 一起隔离**：本执行器继承 `dsh-bash-sandbox` → `dsh-bash-local`，其构造函数会注册共享的 `shell` 设置命名空间；宿主执行器已经注册过，`ctx.settings.register` 对重复注册是 fail loud。隔离 `settings` 后本执行器根本看不到注册表、不注册任何命名空间，设置界面里的 `shell` 段仍归宿主执行器。组内没有任何行读设置。
- **执行器**：继承 `dsh-bash-sandbox` 的 `SandboxBashExecutor`（复用 DSH 自己的沙箱分类、后台进程事实、超时/溢出/清理机制），只覆写三处：
  - `confine()`：把继承来的 `bash` 换成解析出的绝对路径，并把 MSYS2 启动失败追加进 `denialSignatures`（前台 `run` 与后台 `start` 都经这条路径分类，判定一致）；
  - `runArgv()` / `startArgv()`：`danger-full-access` 下父类**不走** `confine()`，而是自己拼一个字面量 `bash -c` 的 argv——Windows 上那正是 WSL 启动器，所以在这个 argv 接缝上把裸 `bash` 换成解析出的路径（只重写 `["bash","-c",cmd]` 这一种形状，沙箱 runner 包裹过的 argv 原样通过）；
  - `run()`：给受限模式的启动失败补一句成因说明。

## 排错

| 症状 | 处理 |
|---|---|
| 启动日志报 `no Git for Windows installation found` | 装 Git for Windows，或设 `DSH_GIT_BASH` 指向 `bash.exe` |
| 日志报 `DSH_GIT_BASH points at a missing file` | 变量值写错了（要求完整文件路径，不是目录） |
| `bash` 工具每次都被判沙箱拒绝 | 正常：受限令牌无法启动 MSYS2。把会话切到「完全权限」，或让模型按提示单次升级（需审批） |
| 工具列表里没有 `bash` | 非 Windows 平台（整组禁用）；或执行器构造失败——看启动日志里 `dsh-gitbash:` 开头的行 |
| 想把 Git Bash 完全替代 PowerShell | 在你自己复制的 preset 里禁用 `tool-pwsh` 即可（本插件不替你做：受限模式下它就是唯一能跑的 shell） |

## 限制

- **受限模式跑不了 Git Bash** —— MSYS2 与写受限令牌的冲突是操作系统层面的，插件不绕过。仅「完全权限」可直接运行。
- **不替换 PowerShell** —— `pwsh` 工具与文件沙箱保持原样；本插件是**新增**一个 bash shell。
- **后台任务失败时没有成因附加行** —— 拒绝标记与升级提示对前后台一致，但追加的那句成因说明只在前台结果里（后台读的是子进程原始增量）。
- **只解析常规 Git for Windows 布局** —— 便携版/自定义布局请显式设 `DSH_GIT_BASH`。
- **依赖宿主包内部接缝** —— 执行器继承 `dsh-bash-sandbox` 的 `confine(command, policy)`。DSH 升级若改动该形状，插件会失效（单测 `test/manifest.test.js` 里的接线断言会在契约变化时暴露）。

## 许可与来源

MIT，见 [LICENSE](LICENSE)。沙箱行为、拒绝方言与升级流程均来自 DSH 自身（`@deepseek-ai/dsh-shell` / `dsh-bash-sandbox` / `dsh-sandbox-*`），本插件只提供执行器接线与 Git Bash 解析。
