import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSkillProvider } from "@hilariouhiss/dsh-skill-kit";

export const name = "superpowers";
export const inject = ["skills", "systemPrompt"];

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const SuperpowersSkillProvider = makeSkillProvider({
	name: "superpowers",
	source: "superpowers-plugin",
	skillsDir,
});

const MANDATE = [
	"Before ANY response or action, check whether a superpowers skill applies and, if so, invoke it with the `skill` tool first.",
	"Process skills (brainstorming, systematic-debugging) come before implementation skills.",
	"Load the current SKILL.md via the `skill` tool; never follow a skill from memory alone.",
].join(" ");

/**
 * DSH plugin entry point.
 *
 * Registered in the host plane (see cordis.patch.yml), so the skill provider
 * lands in the global `skills` layer — visible to every agent preset — while
 * the bootstrap section registers globally. The section re-assembles each
 * turn, so the mandate survives compaction; the full instructions stay in the
 * `using-superpowers` skill and load through the `skill` tool on demand.
 */
export function apply(ctx) {
	ctx.skills.registerProvider((control) => new SuperpowersSkillProvider(ctx, control));

	ctx.systemPrompt.section({
		name: "superpowers:adoption",
		order: 5,
		text: [
			"<EXTREMELY_IMPORTANT>",
			"You have superpowers.",
			"",
			MANDATE,
			"",
			"For the full instructions, load the `using-superpowers` skill with the `skill` tool.",
			"</EXTREMELY_IMPORTANT>",
		].join("\n"),
	});
}
