import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSkillProvider } from "@hilariouhiss/dsh-skill-kit";
import { registerCommands } from "./commands.js";

export const name = "openspec";
export const inject = ["skills", "systemPrompt", "commands"];

const HINT_TEXT = [
	"OpenSpec spec-driven development is available. Before any feature or change — planning, building, or fixing — load the matching `openspec-*` skill with the `skill` tool, or start with `/opsx-propose` (plan first) then `/opsx-apply` (implement). Each change lives in `openspec/changes/<name>/` with proposal.md, specs/, design.md, and tasks.md; the `openspec` CLI must be installed and on PATH.",
].join("");

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const OpenspecSkillProvider = makeSkillProvider({
	name: "openspec",
	source: "openspec-plugin",
	skillsDir,
});

/**
 * DSH plugin entry point.
 *
 * Registered in the host plane (see cordis.patch.yml), so the skill provider
 * lands in the global `skills` layer — visible to every agent preset — while
 * the adoption hint and `/opsx-*` commands register globally.
 */
export function apply(ctx) {
	ctx.skills.registerProvider((control) => new OpenspecSkillProvider(ctx, control));

	ctx.systemPrompt.section({
		name: "openspec:adoption",
		order: 5,
		text: HINT_TEXT,
	});

	registerCommands(ctx);
}
