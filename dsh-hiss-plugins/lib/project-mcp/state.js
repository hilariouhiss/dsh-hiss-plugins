import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Per-workspace MCP switch state, owned by the `/mcp` dialog.
 *
 * A switch is remembered per workspace directory, so turning a tool off in one
 * project never reaches another. The file is untrusted local state: a corrupt or
 * hand-edited document degrades to "everything on" instead of failing the row.
 *
 * @module dsh-hiss-plugins/project-mcp/state
 */

/** One workspace's switches; both lists hold names, absent means enabled. */
function emptyWorkspace() {
	return { disabledTools: [], disabledServers: [] };
}

/**
 * The state with no switches remembered.
 * @returns {{ workspaces: Record<string, { disabledTools: string[], disabledServers: string[] }> }}
 */
export function emptyState() {
	return { workspaces: {} };
}

/** Every string of a list, ignoring anything else. */
function strings(value) {
	return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

/**
 * Coerce anything read from disk into a usable state.
 * @param {unknown} raw - parsed JSON, or whatever readState managed to produce.
 * @returns {{ workspaces: Record<string, { disabledTools: string[], disabledServers: string[] }> }}
 */
export function normalizeState(raw) {
	const state = emptyState();
	if (raw === null || typeof raw !== "object") return state;
	const workspaces = raw.workspaces;
	if (workspaces === null || typeof workspaces !== "object") return state;
	for (const [cwd, entry] of Object.entries(workspaces)) {
		if (entry === null || typeof entry !== "object") continue;
		state.workspaces[cwd] = {
			disabledTools: strings(entry.disabledTools),
			disabledServers: strings(entry.disabledServers),
		};
	}
	return state;
}

/** The switches remembered for one directory, or the all-on default. */
function workspaceOf(state, cwd) {
	return normalizeState(state).workspaces[resolve(cwd)];
}

/**
 * Whether a tool is enabled in one workspace.
 * @param {object} state - the current state.
 * @param {string} cwd - the workspace directory.
 * @param {string} tool - the public tool name.
 * @returns {boolean} true when the workspace has not turned it off.
 */
export function isToolEnabled(state, cwd, tool) {
	return !(workspaceOf(state, cwd)?.disabledTools.includes(tool) ?? false);
}

/**
 * Whether a project server is enabled in one workspace.
 * @param {object} state - the current state.
 * @param {string} cwd - the workspace directory.
 * @param {string} server - the server name declared by `.mcp.json`.
 * @returns {boolean} true when the workspace has not turned it off.
 */
export function isServerEnabled(state, cwd, server) {
	return !(workspaceOf(state, cwd)?.disabledServers.includes(server) ?? false);
}

/**
 * Return a copy with one name added to (or removed from) a workspace list.
 * @param {object} state - the current state; never mutated.
 * @param {string} cwd - the workspace directory.
 * @param {string} name - the tool or server name.
 * @param {boolean} enabled - the switch position to record.
 * @param {"disabledTools" | "disabledServers"} field - which list to edit.
 * @returns {object} the new state.
 */
function withName(state, cwd, name, enabled, field) {
	const next = normalizeState(state);
	const key = resolve(cwd);
	const entry = next.workspaces[key] ?? emptyWorkspace();
	const others = entry[field].filter((candidate) => candidate !== name);
	next.workspaces[key] = { ...entry, [field]: enabled ? others : [...others, name] };
	return next;
}

/**
 * Record one tool switch for one workspace.
 * @param {object} state - the current state; never mutated.
 * @param {string} cwd - the workspace directory.
 * @param {string} tool - the public tool name.
 * @param {boolean} enabled - whether the tool should be visible.
 * @returns {object} the new state.
 */
export function withTool(state, cwd, tool, enabled) {
	return withName(state, cwd, tool, enabled, "disabledTools");
}

/**
 * Record one project-server switch for one workspace.
 * @param {object} state - the current state; never mutated.
 * @param {string} cwd - the workspace directory.
 * @param {string} server - the server name declared by `.mcp.json`.
 * @param {boolean} enabled - whether the server should be mounted.
 * @returns {object} the new state.
 */
export function withServer(state, cwd, server, enabled) {
	return withName(state, cwd, server, enabled, "disabledServers");
}

/**
 * Where the state document lives under a harness home.
 * @param {string} home - the user's home directory.
 * @returns {string} the absolute state path.
 */
export function statePath(home) {
	return join(home, ".dsh", "hiss-mcp.json");
}

/**
 * Read the state document; a missing, corrupt, or unrecognizable file reads as empty.
 * @param {string} path - the state path.
 * @returns {Promise<object>} the normalized state.
 */
export async function readState(path) {
	try {
		return normalizeState(JSON.parse(await readFile(path, "utf8")));
	} catch {
		return emptyState();
	}
}

/**
 * Write the state document atomically: a rename never leaves a half-written file.
 * @param {string} path - the state path.
 * @param {object} state - the state to record.
 * @returns {Promise<void>}
 */
export async function writeState(path, state) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`;
	await writeFile(temporary, `${JSON.stringify(normalizeState(state), null, 2)}\n`);
	await rename(temporary, path);
}
