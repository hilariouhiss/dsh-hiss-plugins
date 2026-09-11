import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSkillProvider } from "@hilariouhiss/dsh-skill-kit";

export const name = "taste-skill";
export const inject = ["skills"];

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const TasteSkillProvider = makeSkillProvider({
	name: "taste-skill",
	source: "taste-skill-plugin",
	skillsDir,
});

/**
 * DSH plugin entry point.
 *
 * Registered in the host plane (see cordis.patch.yml), so the skill provider
 * lands in the global `skills` layer — visible to every agent preset. The 13
 * skills are upstream's, verbatim: a same-name skill under `~/.dsh/skills/`,
 * `.dsh/skills/`, or `~/.agents/skills/` still wins, because the provider keeps
 * the kit's `BUNDLED_SKILL_RANK` default. That layering is the point — it is
 * how a user overrides one taste skill without forking this package.
 */
export function apply(ctx) {
	ctx.skills.registerProvider((control) => new TasteSkillProvider(ctx, control));
}
