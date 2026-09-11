# DeepSeek Harness Tool Mapping

Skills speak in actions ("invoke a skill", "dispatch a subagent", "create a
todo", "run a command"). On DeepSeek Harness (DSH) these resolve to the tools
below.

| Action skills request | DSH equivalent |
| --- | --- |
| Invoke a skill (`superpowers:brainstorming`, "use the Skill tool") | `skill` tool with the **bare** kebab-case name (e.g. `brainstorming`). The `superpowers:` prefix is prose only — drop it. |
| Dispatch a subagent (isolated context) | `subagent` (background by default; set `run_in_background: false` only when the next step depends on it) |
| Dispatch a subagent that needs this conversation's context | `subagent_fork` (inherits completed turns) |
| Resume / message a live subagent | `send_message` |
| Reconcile outstanding subagents | `list_agents` (never busy-poll; completion notices arrive on their own) |
| Cancel a running subagent | `interrupt_agent` |
| Track long background commands | `job_list` / `job_output` / `job_kill` |
| Task tracking ("create a todo", "mark complete") | `todo_write` |
| Run commands / git / scripts | the shell tool — `pwsh` on Windows, `bash` where configured. `git worktree`/`merge`/`diff` run through it. |
| Fan out many independent pieces | `workflow` (scripted multi-agent phases), or several background `subagent` calls |

## Subagent model selection

Skills' "Model Selection" rules assume per-dispatch model tiers. DSH's plain
`subagent`/`subagent_fork` tools take no per-call model override and inherit the
session model — so when a tier matters (cheap implementer, most-capable final
reviewer), route through the `workflow` tool's `agent(prompt, { provider, model })`
instead of a bare `subagent`. When tiering is not material, a plain `subagent`
is fine.

## Waiting on children

DSH dispatches subagents in the background by default and delivers a completion
notice when one settles. While you have local work, keep working; when idle,
reconcile with `list_agents` (and `job_output` for shell jobs) rather than
polling on short timeouts — a child's result reaches you on its own.

## Notes

- Skills refer to `superpowers:name` in prose; the `skill` tool takes the bare name.
- There is no `close_agent` lifecycle step in DSH — finished children settle on
  their own; `interrupt_agent` only cancels an in-flight turn.
