import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import { findConfigPath, loadServers } from "./config.js";

export const name = "project-mcp";
export const inject = ["agents"];

/** Readable text for anything a rejected promise or a schema can throw. */
function message(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Mount every server declared by the session project's `.mcp.json` into one
 * agent's own scope. `agent.ctx` is the agent's scoped context, so the mount
 * lives and dies with the agent: two sessions in different projects never
 * collide on a server name, and a subagent created under this agent inherits
 * the same tools without mounting anything itself.
 *
 * Every failure is reported and skipped. `.mcp.json` is untrusted project
 * content, and a bad entry must cost its own server at most — never the
 * session, which is why nothing here rejects.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx - host context, for logging.
 * @param {{ session?: { header?: { cwd?: string } }, ctx?: unknown }} agent - the live agent.
 * @returns {Promise<number>} how many servers were mounted.
 */
export async function mountProjectMcp(ctx, agent) {
	const cwd = agent?.session?.header?.cwd;
	if (typeof cwd !== "string" || cwd === "") return 0;
	const configPath = await findConfigPath(cwd);
	if (configPath === undefined) return 0;

	let loaded;
	try {
		loaded = await loadServers(configPath, cwd);
	} catch (error) {
		ctx.logger.warn(`project-mcp: ${message(error)}`);
		return 0;
	}
	for (const { serverName, reason } of loaded.skipped) {
		ctx.logger.warn(`project-mcp: ${configPath}: "${serverName}" was skipped: ${reason}`);
	}

	let mounted = 0;
	for (const { serverName, spec } of loaded.servers) {
		let config;
		try {
			// The bridge's own schema is the gate: it decides what a server may
			// ask the host process to do, and it rejects a name that would make
			// an unusable tool namespace.
			config = McpClient.Config(spec);
		} catch (error) {
			ctx.logger.warn(`project-mcp: ${configPath}: "${serverName}" is not a usable MCP server: ${message(error)}`);
			continue;
		}
		try {
			await agent.ctx.plugin(McpClient, config);
			mounted += 1;
		} catch (error) {
			ctx.logger.warn(`project-mcp: ${configPath}: "${serverName}" failed to start: ${message(error)}`);
		}
	}
	return mounted;
}

/**
 * Mount the project's servers for every agent whose session directory declares
 * them. The registration is awaited by the agent registry before creation
 * completes, so a session's first turn already sees its MCP tools.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx - the host context.
 */
export function apply(ctx) {
	const wire = async (agent) => {
		try {
			const mounted = await mountProjectMcp(ctx, agent);
			if (mounted > 0) ctx.logger.info(`project-mcp: mounted ${mounted} server(s) for ${agent.id}`);
		} catch (error) {
			ctx.logger.warn(`project-mcp: mounting failed for ${String(agent?.id)}: ${message(error)}`);
		}
	};
	ctx.on("agent/created", ({ agent }) => wire(agent));
	// A reload mid-session must reach agents that are already live.
	for (const agent of ctx.agents.list()) void wire(agent);
}
