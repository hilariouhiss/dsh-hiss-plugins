import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSkillProvider, parseFrontmatter } from "@hilariouhiss/dsh-skill-kit";

export const name = "superpowers";
export const inject = ["skills", "systemPrompt"];

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const SuperpowersSkillProvider = makeSkillProvider({
	name: "superpowers",
	source: "superpowers-plugin",
	skillsDir,
});

const FALLBACK_HINT = "Superpowers is active. Before any task, check whether a superpowers skill applies and, if so, invoke it with the `skill` tool first.";

/**
 * Read the `using-superpowers` bootstrap body once at apply time: the same
 * frontmatter-stripped content superpowers' SessionStart hook injects, wrapped
 * the same way, so the model is mandated to check for applicable skills before
 * responding.
 */
function resolveBootstrap() {
	try {
		const parsed = parseFrontmatter(
			readFileSync(join(skillsDir, "using-superpowers", "SKILL.md"), "utf8"),
			"using-superpowers",
		);
		if (parsed.ok) return parsed.value.content;
	} catch {
		// fall through to the short hint
	}
	return FALLBACK_HINT;
}

/**
 * DSH plugin entry point.
 *
 * Registered in the host plane (see cordis.patch.yml), so the skill provider
 * lands in the global `skills` layer — visible to every agent preset — while
 * the bootstrap section registers globally. Unlike superpowers' start+compact
 * hook, the section re-assembles each turn, so the mandate survives compaction.
 */
export function apply(ctx) {
	ctx.skills.registerProvider((control) => new SuperpowersSkillProvider(ctx, control));

	const body = resolveBootstrap();
	ctx.systemPrompt.section({
		name: "superpowers:adoption",
		order: 5,
		text: [
			"<EXTREMELY_IMPORTANT>",
			"You have superpowers.",
			"",
			"Below is the full content of your 'using-superpowers' skill — your introduction to using skills. For all other skills, use the 'skill' tool:",
			"",
			body,
			"</EXTREMELY_IMPORTANT>",
		].join("\n"),
	});
}
