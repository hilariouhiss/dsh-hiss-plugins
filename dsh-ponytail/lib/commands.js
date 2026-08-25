import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { renderSkillContent } from "@deepseek-ai/dsh-skill";
import { loadSkill, registerSkillCommands } from "@hilariouhiss/dsh-skill-kit";

const LEVELS = new Set(["lite", "full", "ultra", "off"]);
const SKILL_COMMANDS = [
	{
		name: "ponytail-review",
		description: "review current changes for over-engineering (what to delete)",
	},
	{
		name: "ponytail-audit",
		description: "audit the whole repo for over-engineering",
	},
	{
		name: "ponytail-debt",
		description: "harvest ponytail: shortcut comments into a debt ledger",
	},
	{
		name: "ponytail-gain",
		description: "show ponytail's measured impact scoreboard",
	},
	{
		name: "ponytail-help",
		description: "quick reference for ponytail levels, skills, and commands",
	},
];

/**
 * Register the six `/ponytail*` commands on the host `commands` registry.
 *
 * The `/ponytail` command switches intensity (`lite|full|ultra|off`) and, like
 * the remaining five, injects the matching skill's rendered content as a
 * durable user message via `agent.followup` — the same mechanism `/goal` uses —
 * so the model reads the instructions in its very next step.
 */
export function registerCommands(ctx) {
	ctx.commands.register({
		name: "ponytail",
		description: "switch ponytail lazy-mode intensity (lite|full|ultra|off)",
		input: { hint: "[lite|full|ultra|off]" },
		handler: (invocation) => ponytailCommand(ctx, invocation),
	});
	registerSkillCommands(ctx, SKILL_COMMANDS, "@hilariouhiss/dsh-ponytail");
}

async function ponytailCommand(ctx, invocation) {
	const level = parseLevel(invocation.rawInput);
	if (level === undefined) {
		return { kind: "error", text: "Usage: /ponytail [lite|full|ultra|off]" };
	}
	if (level === "off") {
		invocation.agent.followup(createUserMessage({
			content: [{
				type: "text",
				text: "Ponytail off — revert to normal mode. Ignore the ponytail instructions until it is turned back on with /ponytail.",
			}],
			source: { kind: "skill-invocation", name: "ponytail", form: "instructions" },
		}));
		return { kind: "success", text: "Ponytail off." };
	}
	const skill = await loadSkill(ctx, invocation, "ponytail");
	if (skill === undefined) return missingSkill("ponytail");
	invocation.agent.followup(createUserMessage({
		content: [{
			type: "text",
			text: `${renderSkillContent(skill)}\n\nPonytail level: ${level}. Apply the ${level} column of the Intensity table from now on.`,
		}],
		source: { kind: "skill-invocation", name: "ponytail", form: "instructions" },
	}));
	return { kind: "success", text: `Ponytail mode set to ${level}.` };
}

/** Trimmed `/ponytail` argument → `lite|full|ultra|off`, bare = `full`, unknown = `undefined`. */
export function parseLevel(rawInput) {
	const input = (typeof rawInput === "string" ? rawInput.trim() : "").toLowerCase();
	if (input.length === 0) return "full";
	return LEVELS.has(input) ? input : undefined;
}

function missingSkill(name) {
	return {
		kind: "error",
		text: `The "${name}" skill is not available; check that the @hilariouhiss/dsh-ponytail plugin is installed and enabled.`,
	};
}
