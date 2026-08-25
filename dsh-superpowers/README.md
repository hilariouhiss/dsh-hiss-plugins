# dsh-superpowers

[Superpowers](https://github.com/obra/superpowers) ported to DeepSeek Harness:
the 14 composable skills (brainstorming, writing-plans, test-driven-development,
systematic-debugging, subagent-driven-development, …) plus the `using-superpowers`
bootstrap that makes them auto-trigger.

## What it installs

- **Skills** — served by a global skill provider, so all 14 appear in every
  agent's `available_skills` catalog and load via the `skill` tool.
- **Bootstrap** — a system-prompt section that injects the `using-superpowers`
  mandate ("if a skill applies, you must use it") into every turn, so
  `brainstorming` and friends trigger on their own.

## Install

From this package's parent directory:

```sh
dsh plugin --profile web add link:./dsh-superpowers
```

Then restart the DSH server (bundle layers load at profile boot). To confirm the
row composes before restarting:

```sh
dsh web --dump-config
```

## Verify

In a fresh session after restart, send exactly:

> Let's make a react todo list

A working install auto-triggers `brainstorming` before writing any code.

## Updating the skills

The skills are vendored from the upstream `superpowers/skills/` tree. To refresh
them after an upstream update, copy that directory over `skills/` again (the one
local addition, `using-superpowers/references/dsh-tools.md`, is re-added by hand).

## License

MIT — skill content and bootstrap derived from
[`obra/superpowers`](https://github.com/obra/superpowers), © Jesse Vincent.
