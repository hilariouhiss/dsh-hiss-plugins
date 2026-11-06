/**
 * The `/fix` command: hand the model one instruction to diagnose the root cause,
 * report it, and wait for the user's confirmation before changing anything.
 *
 * The row does no filesystem work of its own. The agent already has the reading,
 * search, and writing tools, and the prompt is the product; a guard here would
 * duplicate those tools and still guess at the bug. The thin seam also keeps the
 * command usable from every UI that composes `commands`.
 *
 * @module dsh-hiss-plugins/fix
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { buildFixPrompt } from "./prompt.js";

export const name = "fix";
export const inject = ["commands"];

/**
 * Register the `/fix` command.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx - host context carrying `commands`.
 */
export function apply(ctx) {
	ctx.commands.register({
		name: "fix",
		description: "Investigate a bug's root cause and report it before fixing",
		input: { hint: "[<symptom>]" },
		handler: (invocation) => runFix(invocation),
	});
}

/**
 * Execute one `/fix` invocation.
 *
 * @param {object} invocation the command invocation.
 * @returns {{ kind: "success", text: string }} the command result.
 */
function runFix(invocation) {
	const symptom = invocation.rawInput.trim();
	invocation.agent.followup(createUserMessage({
		content: [{ type: "text", text: buildFixPrompt(symptom) }],
		// A non-user source keeps the instruction out of the user's chat bubble;
		// Chat renders it as a collapsed context/turn-trigger row instead.
		source: { kind: "fix", form: "notice", summary: "Diagnose the root cause before fixing" },
	}));
	return {
		kind: "success",
		text: "Investigating the root cause. I'll report before changing anything; confirm the fix after the report.",
	};
}
