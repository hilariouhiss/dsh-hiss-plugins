import { apply as mcpClientApply, inject as mcpClientInject } from "@deepseek-ai/dsh-mcp-client";

export const name = "codegraph";
export const inject = ["systemPrompt"];

const GUIDANCE = [
	"CodeGraph (semantic code intelligence) is available through the `mcp__codegraph__codegraph_explore` tool. ",
	"For structural questions about the codebase — how a component works, how X reaches Y, the blast radius of a change — ",
	"call `mcp__codegraph__codegraph_explore` directly instead of grepping or reading files one by one; ",
	"it returns the relevant symbols' source, call paths, and impact in one call. ",
	"Always pass `projectPath` as the workspace directory you are working in (or a subdirectory that has a `.codegraph/` index). ",
	"If the tool reports no index, tell the user to run `codegraph init` in that project first. ",
	"If the `mcp__codegraph__*` tool is not listed, the codegraph CLI is not installed or failed to start — check the DSH host logs.",
].join("");

function guidanceFor(cwd) {
	return `${GUIDANCE} Current workspace: ${cwd}; pass it as \`projectPath\`.`;
}

/**
 * Stdio config for the CodeGraph MCP server. `command` resolves `codegraph`
 * from the DSH host process's PATH (installed globally), and `cwd` is only the
 * server's default project — the model always passes `projectPath` to target
 * the actual workspace.
 *
 * @param {string} [cwd] default project directory for the spawned server.
 * @returns {import("@deepseek-ai/dsh-mcp-client").StdioConfig}
 */
export function codegraphConfig(cwd = process.cwd()) {
	return {
		transport: "stdio",
		serverName: "codegraph",
		command: "codegraph",
		args: ["serve", "--mcp"],
		env: {},
		cwd,
		toolCallTimeoutMs: 120000,
		failOnStartupError: false,
	};
}

/**
 * DSH plugin entry point. Loads the DSH MCP client bridge for the CodeGraph
 * server (registering `mcp__codegraph__*` tools globally) and injects usage
 * guidance whose text carries the current session's workspace path, so agents
 * prefer it and pass the right `projectPath`.
 */
export function apply(ctx) {
	ctx.plugin({ inject: mcpClientInject, apply: mcpClientApply }, codegraphConfig());
	ctx.systemPrompt.section({
		name: "codegraph:guidance",
		order: 100,
		text: (context) => guidanceFor(context.scope?.session?.header?.cwd ?? process.cwd()),
	});
}
