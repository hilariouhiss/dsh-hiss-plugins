/**
 * The `/init` command: hand the model one self-contained instruction to read the
 * repository and write its AGENTS.md.
 *
 * The row does no filesystem work of its own. The agent already has the reading,
 * search, and writing tools, and the prompt is the product; a generator here would
 * duplicate those tools and still guess at the repository's commands. The thin seam
 * also keeps the command usable from every UI that composes `commands`.
 *
 * @module dsh-hiss-plugins/init
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { buildInitPrompt } from "./prompt.js";

export const name = "init";
export const inject = ["commands", "workingDirectory"];

/** The command is argument-free; extra input is a usage error, not a silent no-op. */
const USAGE = "Usage: /init (no arguments)";

/**
 * Register the `/init` command.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx - host context carrying
 *   `commands` and `workingDirectory`.
 */
export function apply(ctx) {
	ctx.commands.register({
		name: "init",
		description: "Read this project and write AGENTS.md",
		handler: (invocation) => runInit(ctx, invocation),
	});
}

/**
 * Execute one `/init` invocation.
 *
 * @param {object} ctx host context.
 * @param {object} invocation the command invocation.
 * @returns {Promise<{ kind: "success" | "error", text: string }>} the command result.
 */
async function runInit(ctx, invocation) {
	if (invocation.rawInput.trim().length > 0) return { kind: "error", text: USAGE };
	const cwd = await resolveCwd(ctx, invocation);
	invocation.agent.followup(createUserMessage({
		content: [{ type: "text", text: buildInitPrompt(cwd) }],
		// A non-user source keeps the long instruction out of the user's chat
		// bubble; Chat renders it as a collapsed context/turn-trigger row instead.
		source: { kind: "init", form: "notice", summary: "Generate or update AGENTS.md" },
	}));
	return { kind: "success", text: "Reading this project and writing AGENTS.md." };
}

/**
 * Name the session directory in the prompt, best effort.
 *
 * A failed lookup is not a reason to refuse: the agent's own tools still resolve
 * relative paths against the session cwd, so the prompt simply omits the absolute
 * path and lets the agent find the project root itself.
 *
 * @param {object} ctx host context.
 * @param {object} invocation the command invocation.
 * @returns {Promise<string | undefined>} the session working directory, when known.
 */
async function resolveCwd(ctx, invocation) {
	try {
		return await ctx.workingDirectory.ensure(invocation.agent, invocation.signal);
	} catch (error) {
		// A cancellation is not a bookkeeping failure: never enqueue a prompt the
		// user has already withdrawn.
		if (invocation.signal.aborted) throw error;
		return undefined;
	}
}
