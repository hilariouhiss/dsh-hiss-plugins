import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { dispatch } from "./actions.js";
import { findConfigPath, loadServers, readConfig, validateEntry, writeConfig } from "./config.js";
import { normalizeState, readState, statePath, withServer, withTool, writeState } from "./state.js";
import { countTools, renderStatus } from "./status.js";
import { buildView } from "./view.js";

export const name = "project-mcp";
export const inject = ["agents"];

/** The dialog route: same-origin POST from the browser half, one JSON answer. */
const DIALOG_PATH = "/hiss-mcp/action";
/** A dialog request larger than this is not a switch or a server entry. */
const BODY_LIMIT = 64 * 1024;

/**
 * Per-agent bookkeeping: the fibers this row mounted and the restriction in force.
 * A restriction is per agent scope, so toggling one tool means re-applying the
 * whole deny set for that agent, never a global switch.
 */
const records = new Map();

/** Readable text for anything a rejected promise or a schema can throw. */
function message(error) {
	return error instanceof Error ? error.message : String(error);
}

/** One agent's mounted servers, remembered deny set, and live restriction disposer. */
function recordFor(agent) {
	let record = records.get(agent);
	if (record === undefined) {
		record = { servers: new Map(), deny: new Set(), lift: undefined };
		records.set(agent, record);
	}
	return record;
}

/** The session directory an agent reads its project from. */
function cwdOf(agent) {
	const cwd = agent?.session?.header?.cwd;
	return typeof cwd === "string" && cwd !== "" ? cwd : undefined;
}

/** A host service when this profile has one, without requiring it. */
function serviceOf(ctx, key) {
	return typeof ctx.get === "function" ? ctx.get(key) : ctx[key];
}

/** The switches one workspace remembers. */
function switchesOf(state, cwd) {
	const entry = normalizeState(state).workspaces[resolve(cwd)];
	return { disabledTools: entry?.disabledTools ?? [], disabledServers: entry?.disabledServers ?? [] };
}

/** The public tool names a scope sees, or the global view when no scope is given. */
function toolNamesOf(ctx, scope) {
	return ctx.tools.schemas(scope).map((schema) => schema.name);
}

/**
 * Hide the tools this workspace switched off from one agent.
 *
 * `tools.restrict` only reaches global registrations, refuses unknown names, and
 * applies to one agent scope, so the deny set is filtered against what actually
 * exists and re-applied after the tool list changes. The deny set is recorded
 * before the call: `restrict` emits `tools/change`, and the re-entrant pass must
 * see an unchanged set and stop.
 *
 * @param {object} ctx - host context, for logging and the global tool view.
 * @param {object} agent - the live agent whose scope hides the tools.
 * @param {object} state - the switch state to apply.
 * @returns {void}
 */
function applyRestriction(ctx, agent, state) {
	const cwd = cwdOf(agent);
	if (cwd === undefined || agent?.ctx?.tools === undefined) return;
	const known = new Set(toolNamesOf(ctx, undefined));
	const deny = switchesOf(state, cwd).disabledTools.filter((tool) => known.has(tool));
	const record = recordFor(agent);
	const same = deny.length === record.deny.size && deny.every((tool) => record.deny.has(tool));
	if (same) return;
	record.deny = new Set(deny);
	record.lift?.();
	record.lift = undefined;
	if (deny.length === 0) return;
	try {
		record.lift = agent.ctx.tools.restrict({ deny });
	} catch (error) {
		ctx.logger.warn(`project-mcp: could not hide ${deny.join(", ")} for ${String(agent.id)}: ${message(error)}`);
	}
}

/** Mount one declared server into an agent scope and remember how to unmount it. */
async function mountServer(ctx, agent, spec) {
	let config;
	try {
		// The bridge's own schema is the gate: it decides what a server may
		// ask the host process to do, and it rejects a name that would make
		// an unusable tool namespace.
		config = McpClient.Config(spec);
	} catch (error) {
		ctx.logger.warn(`project-mcp: "${spec.serverName}" is not a usable MCP server: ${message(error)}`);
		return false;
	}
	try {
		const fiber = await agent.ctx.plugin(McpClient, config);
		recordFor(agent).servers.set(spec.serverName, fiber);
		return true;
	} catch (error) {
		ctx.logger.warn(`project-mcp: "${spec.serverName}" failed to start: ${message(error)}`);
		return false;
	}
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
 * @param {object} [state] - the switch state; a switched-off server is not mounted.
 * @returns {Promise<number>} how many servers were mounted.
 */
export async function mountProjectMcp(ctx, agent, state) {
	const cwd = cwdOf(agent);
	if (cwd === undefined) return 0;
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

	const disabled = state === undefined ? [] : switchesOf(state, cwd).disabledServers;
	let mounted = 0;
	for (const { serverName, spec } of loaded.servers) {
		if (disabled.includes(serverName)) continue;
		if (await mountServer(ctx, agent, spec)) mounted += 1;
	}
	return mounted;
}

/**
 * Register the `/mcp` command beside the mount wiring.
 *
 * Mounting does not need `commands` or `tools`, so the command is registered
 * through `ctx.inject`: a host missing either service loses the status command,
 * never the mount. Both are optional host services from this row's point of view.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx - the host context.
 */
function registerStatusCommand(ctx) {
	ctx.inject(["commands", "tools"], (commandCtx) => {
		commandCtx.commands.register({
			name: "mcp",
			description: "Show this project's MCP servers and their status",
			handler: (invocation) => runMcp(commandCtx, invocation),
		});
	});
}

/**
 * Report the session project's MCP servers and which of them are live.
 *
 * Liveness comes from the agent's own tool registry, not from the mount attempt:
 * the bridge registers a server's tools only after a successful connect and tool
 * sync, and removes them when the reconnect budget runs out. A declared server
 * with no tools is therefore not connected (or genuinely exposes none); the host
 * log has the reason.
 *
 * @param {object} ctx - host context carrying `tools`.
 * @param {object} invocation - the command invocation.
 * @returns {Promise<{ kind: "success" | "error", text: string }>} the command result.
 */
async function runMcp(ctx, invocation) {
	if (invocation.rawInput.trim() !== "") return { kind: "error", text: "Usage: /mcp (no arguments)" };
	const cwd = invocation.agent?.session?.header?.cwd;
	if (typeof cwd !== "string" || cwd === "") {
		return { kind: "error", text: "No session working directory; no project MCP servers are mounted." };
	}
	const toolNames = toolNamesOf(ctx, invocation.agent);
	const configPath = await findConfigPath(cwd);
	if (configPath === undefined) {
		return { kind: "success", text: renderStatus({ cwd, otherTools: countTools(toolNames, []).other }) };
	}
	let loaded;
	try {
		loaded = await loadServers(configPath, cwd);
	} catch (error) {
		return { kind: "error", text: message(error) };
	}
	const accepted = [];
	const invalid = [];
	for (const { serverName, spec } of loaded.servers) {
		try {
			// Re-judge the entry with the same schema the mount used, so the report
			// never claims a server is fine when the bridge would have refused it.
			McpClient.Config(spec);
			accepted.push(serverName);
		} catch (error) {
			invalid.push({ serverName, reason: message(error) });
		}
	}
	const { tools, other } = countTools(toolNames, accepted);
	return {
		kind: "success",
		text: renderStatus({
			cwd,
			configPath,
			servers: accepted.map((serverName) => ({ serverName, tools: tools.get(serverName) })),
			invalid,
			skipped: loaded.skipped,
			otherTools: other,
		}),
	};
}
/**
 * The servers configured outside this workspace, so the dialog can list one that
 * currently exposes no tools. The manager is optional: a profile without it falls
 * back to whatever the tool names reveal.
 * @param {object} ctx - host context.
 * @param {string[]} workspaceServers - names this workspace declares.
 * @returns {string[]} global server names, workspace ones excluded.
 */
function globalServerNames(ctx, workspaceServers) {
	const manager = serviceOf(ctx, "mcpManager");
	if (manager === undefined || typeof manager.list !== "function") return [];
	return manager.list()
		.map((entry) => entry?.name)
		.filter((entry) => typeof entry === "string" && !workspaceServers.includes(entry));
}

/** The two-section view for one agent.
 * @param {object} ctx - host context.
 * @param {object} agent - the live agent.
 * @param {string} cwd - the session workspace directory.
 * @param {object} state - the switch state.
 * @returns {Promise<object>} the dialog view.
 */
async function viewOf(ctx, agent, cwd, state) {
	const { disabledTools, disabledServers } = switchesOf(state, cwd);
	const configPath = await findConfigPath(cwd);
	let workspaceServers = [];
	if (configPath !== undefined) {
		const loaded = await loadServers(configPath, cwd);
		workspaceServers = loaded.servers.map((entry) => entry.serverName);
	}
	return buildView({
		cwd,
		toolNames: toolNamesOf(ctx, agent),
		globalServers: globalServerNames(ctx, workspaceServers),
		workspaceServers,
		disabledTools,
		disabledServers,
	});
}

/** Split a dialog argument line into argv, without shell quoting. */
function splitArgs(value) {
	if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
	return typeof value === "string" ? value.split(/\s+/).filter((entry) => entry !== "") : [];
}

/** A `.mcp.json` entry built from the dialog's add form. */
function entryFromInput(input) {
	if (input.type === "http") {
		return {
			type: "http",
			url: String(input.url ?? ""),
			...(input.headers !== null && typeof input.headers === "object" ? { headers: input.headers } : {}),
		};
	}
	const args = splitArgs(input.args);
	return {
		type: "stdio",
		command: String(input.command ?? ""),
		...(args.length === 0 ? {} : { args }),
		...(input.env !== null && typeof input.env === "object" ? { env: input.env } : {}),
	};
}

/** The manager-shaped entry one declared server becomes when registered globally. */
function managerEntry(entry, projectDir) {
	const type = entry?.type ?? "stdio";
	if (type === "http") {
		return { transport: "streamable-http", url: String(entry.url ?? ""), headers: entry.headers ?? {}, enabled: true };
	}
	return {
		transport: "stdio",
		command: String(entry.command ?? ""),
		args: Array.isArray(entry.args) ? entry.args : [],
		env: entry.env ?? {},
		cwd: resolve(projectDir, typeof entry.cwd === "string" ? entry.cwd : "."),
		enabled: true,
	};
}

/** Unmount one remembered server for one agent. */
async function unmountServer(agent, serverName) {
	const record = recordFor(agent);
	const fiber = record.servers.get(serverName);
	if (fiber === undefined) return;
	record.servers.delete(serverName);
	await fiber?.dispose?.();
}

/** Mount one declared server by name, or report that the project no longer declares it. */
async function mountNamed(ctx, agent, cwd, serverName) {
	if (recordFor(agent).servers.has(serverName)) return;
	const configPath = await findConfigPath(cwd);
	if (configPath === undefined) throw new Error(`no .mcp.json for ${cwd}`);
	const loaded = await loadServers(configPath, cwd);
	const found = loaded.servers.find((entry) => entry.serverName === serverName);
	if (found === undefined) throw new Error(`"${serverName}" is not declared in ${configPath}`);
	await mountServer(ctx, agent, found.spec);
}

/**
 * The host operations the dialog dispatcher calls, bound to the live host.
 * @param {object} ctx - host context.
 * @returns {object} one method per dialog action.
 */
function depsFor(ctx) {
	const path = statePath(homedir());
	const agentOf = (sessionId) => {
		const agent = typeof ctx.agents?.get === "function" ? ctx.agents.get(sessionId) : undefined;
		if (agent === undefined) throw new Error(`no live agent for session ${String(sessionId)}`);
		const cwd = cwdOf(agent);
		if (cwd === undefined) throw new Error("the session has no working directory");
		return { agent, cwd };
	};
	const settings = () => {
		const service = serviceOf(ctx, "settings");
		if (service === undefined || typeof service.update !== "function") {
			throw new Error("this profile has no settings service; global MCP servers cannot be added here");
		}
		return service;
	};
	return {
		async status(sessionId) {
			const { agent, cwd } = agentOf(sessionId);
			return viewOf(ctx, agent, cwd, await readState(path));
		},
		async setTool(sessionId, tool, enabled) {
			const { cwd } = agentOf(sessionId);
			const state = await readState(path);
			await writeState(path, withTool(state, cwd, tool, enabled));
			// One workspace's switch reaches every agent reading that workspace.
			for (const agent of ctx.agents.list()) {
				if (cwdOf(agent) === cwd) applyRestriction(ctx, agent, await readState(path));
			}
			const { agent } = agentOf(sessionId);
			return viewOf(ctx, agent, cwd, await readState(path));
		},
		async setServer(sessionId, server, enabled) {
			const { agent, cwd } = agentOf(sessionId);
			await writeState(path, withServer(await readState(path), cwd, server, enabled));
			if (enabled) await mountNamed(ctx, agent, cwd, server);
			else await unmountServer(agent, server);
			return viewOf(ctx, agent, cwd, await readState(path));
		},
		async add(sessionId, input) {
			const { agent, cwd } = agentOf(sessionId);
			const serverName = String(input.name ?? "").trim();
			const entry = entryFromInput(input);
			validateEntry(serverName, entry, cwd);
			if (input.scope === "global") {
				if (globalServerNames(ctx, []).includes(serverName)) throw new Error(`"${serverName}" is already a global MCP server`);
				await settings().update("mcp-manager", { servers: { [serverName]: managerEntry(entry, cwd) } });
			} else {
				const configPath = (await findConfigPath(cwd)) ?? join(resolve(cwd), ".mcp.json");
				const parsed = await readConfig(configPath);
				const declared = parsed.mcpServers !== null && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
				if (Object.hasOwn(declared, serverName)) throw new Error(`"${serverName}" already exists in ${configPath}`);
				await writeConfig(configPath, { ...parsed, mcpServers: { ...declared, [serverName]: entry } });
				await mountNamed(ctx, agent, cwd, serverName);
			}
			return viewOf(ctx, agent, cwd, await readState(path));
		},
		async promote(sessionId, serverName) {
			const { agent, cwd } = agentOf(sessionId);
			const configPath = await findConfigPath(cwd);
			if (configPath === undefined) throw new Error(`no .mcp.json for ${cwd}`);
			const parsed = await readConfig(configPath);
			const declared = parsed.mcpServers !== null && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
			const entry = declared[serverName];
			if (entry === undefined) throw new Error(`"${serverName}" is not declared in ${configPath}`);
			validateEntry(serverName, entry, dirname(resolve(configPath)));
			await settings().update("mcp-manager", { servers: { [serverName]: managerEntry(entry, dirname(resolve(configPath))) } });
			// The global copy now serves this server; the workspace copy would double the tools.
			await writeState(path, withServer(await readState(path), cwd, serverName, false));
			await unmountServer(agent, serverName);
			return viewOf(ctx, agent, cwd, await readState(path));
		},
	};
}

/** Answer one request with JSON. */
function respond(response, status, answer) {
	response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(answer));
}

/**
 * Serve one dialog request: read the body, hand it to the dispatcher, write its answer.
 * The route is same-origin only (the host's own authorization still applies); a
 * body over the limit is refused unread.
 * @param {object} ctx - host context.
 * @param {import("node:http").IncomingMessage} request - the request.
 * @param {import("node:http").ServerResponse} response - the response.
 * @returns {Promise<void>}
 */
async function serveDialog(ctx, request, response) {
	if (request.method !== "POST") {
		respond(response, 405, { ok: false, error: { code: "method-not-allowed", message: "POST only" } });
		return;
	}
	let size = 0;
	const chunks = [];
	for await (const chunk of request) {
		size += chunk.length;
		if (size > BODY_LIMIT) {
			respond(response, 413, { ok: false, error: { code: "too-large", message: `body over ${String(BODY_LIMIT)} bytes` } });
			return;
		}
		chunks.push(chunk);
	}
	let body;
	try {
		body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
	} catch (error) {
		respond(response, 400, { ok: false, error: { code: "invalid-body", message: message(error) } });
		return;
	}
	respond(response, 200, await dispatch(body, depsFor(ctx)));
}

/** Mount the dialog route when this profile has a Web server; other profiles lose only the dialog. */
function registerDialogRoute(ctx) {
	ctx.inject(["webServer"], (serverCtx) => {
		const webServer = serviceOf(serverCtx, "webServer");
		if (webServer === undefined || typeof webServer.register !== "function" || typeof serverCtx.effect !== "function") return;
		serverCtx.effect(() => webServer.register({
			kind: "exact",
			path: DIALOG_PATH,
			handler: (request, response) => serveDialog(ctx, request, response),
		}), "project-mcp.dialog");
	});
}

/**
 * Mount the project's servers for every agent whose session directory declares
 * them. The registration is awaited by the agent registry before creation
 * completes, so a session's first turn already sees its MCP tools.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx - the host context.
 */
export function apply(ctx) {
	const path = statePath(homedir());
	const wire = async (agent) => {
		try {
			const state = await readState(path);
			const mounted = await mountProjectMcp(ctx, agent, state);
			applyRestriction(ctx, agent, state);
			if (mounted > 0) ctx.logger.info(`project-mcp: mounted ${mounted} server(s) for ${agent.id}`);
		} catch (error) {
			ctx.logger.warn(`project-mcp: mounting failed for ${String(agent?.id)}: ${message(error)}`);
		}
	};
	ctx.on("agent/created", ({ agent }) => wire(agent));
	ctx.on("agent/disposed", ({ agent }) => {
		records.delete(agent);
	});
	// A server registers its tools only after it connects, so a switched-off tool
	// usually appears later than the agent: re-apply whenever the tool list moves.
	ctx.on("tools/change", () => {
		void readState(path).then((state) => {
			for (const agent of ctx.agents.list()) applyRestriction(ctx, agent, state);
		}).catch(() => {});
	});
	// A reload mid-session must reach agents that are already live.
	for (const agent of ctx.agents.list()) void wire(agent);
	registerStatusCommand(ctx);
	registerDialogRoute(ctx);
}
