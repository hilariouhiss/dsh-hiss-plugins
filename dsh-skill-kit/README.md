# @hilariouhiss/dsh-skill-kit

Shared kit for the `@hilariouhiss/dsh-*` plugins. Extracts the common skill plumbing
that every plugin previously duplicated:

- `parseFrontmatter` / `SKILL_NAME` / `isValidSkillName` — parse a `SKILL.md` document's
  YAML frontmatter (mirrors `@deepseek-ai/dsh-skill-filesystem`).
- `makeSkillProvider({ name, source, skillsDir, rank })` — a global-layer directory skill
  provider that lists a `skills/` tree and loads bodies on demand.
- `registerSkillCommands(ctx, commands, pluginLabel)` + `loadSkill` — the slash-command →
  skill → followup wiring shared by command-bearing plugins.

This package is a runtime dependency of the plugins, so it must be published to npm before
(or with) them.
