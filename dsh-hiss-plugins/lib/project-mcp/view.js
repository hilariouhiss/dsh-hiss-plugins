/**
 * The `/mcp` dialog view: one pure function that turns what the session sees into
 * the two lists the dialog draws, so the host seam stays thin and every attribution
 * rule is testable without a host.
 *
 * @module dsh-hiss-plugins/project-mcp/view
 */

/** Prefix the bridge puts on every tool it registers. */
const MCP_PREFIX = "mcp__";

/**
 * The server that owns one tool name, longest declared name first. The bridge never
 * parses a tool name back (both halves may contain underscores), so ownership is a
 * prefix match against the names this session actually declares.
 * @param {string} toolName - the public tool name.
 * @param {string[]} names - declared server names, workspace and global together.
 * @returns {string | undefined} the owner, or undefined when nothing declares it.
 */
function ownerOf(toolName, names) {
	return names.find((name) => toolName.startsWith(`${MCP_PREFIX}${name}__`));
}

/**
 * The server a tool belongs to: its declared owner, else the first segment after the prefix.
 * @param {string} toolName - the public tool name.
 * @param {string[]} names - declared server names.
 * @returns {string} the server name used in the dialog.
 */
function serverOf(toolName, names) {
	const owner = ownerOf(toolName, names);
	if (owner !== undefined) return owner;
	const [first = ""] = toolName.slice(MCP_PREFIX.length).split("__");
	return first;
}

/**
 * Build the dialog view.
 * @param {object} input - what the session currently holds.
 * @param {string} input.cwd - the session workspace directory.
 * @param {string[]} input.toolNames - tools the agent can see right now.
 * @param {string[]} [input.globalServers] - server names configured outside this workspace.
 * @param {string[]} [input.workspaceServers] - server names this workspace declares.
 * @param {string[]} [input.disabledTools] - tools this workspace switched off.
 * @param {string[]} [input.disabledServers] - workspace servers this workspace switched off.
 * @returns {{ cwd: string, global: { name: string, enabled: boolean, tools: { name: string, enabled: boolean }[] }[], local: { name: string, enabled: boolean, tools: { name: string, enabled: boolean }[] }[] }}
 *   the two sections the dialog draws.
 */
export function buildView({ cwd, toolNames = [], globalServers = [], workspaceServers = [], disabledTools = [], disabledServers = [] }) {
	const local = new Set(workspaceServers);
	const declared = [...new Set([...workspaceServers, ...globalServers])].sort((left, right) => right.length - left.length);
	const global = new Map(globalServers.map((name) => [name, []]));
	const localTools = new Map(workspaceServers.map((name) => [name, []]));
	const visible = new Set(toolNames.filter((name) => name.startsWith(MCP_PREFIX)));
	// A switched-off tool is no longer visible, so the remembered name is what keeps its row alive.
	for (const name of [...visible, ...disabledTools.filter((tool) => !visible.has(tool))]) {
		if (!name.startsWith(MCP_PREFIX)) continue;
		const server = serverOf(name, declared);
		const row = { name, enabled: !disabledTools.includes(name) };
		const bucket = localTools.get(server) ?? global.get(server);
		if (local.has(server)) localTools.get(server).push(row);
		else if (bucket !== undefined) bucket.push(row);
		else global.set(server, [row]);
	}
	const section = (entries, off) => [...entries]
		.sort(([left], [right]) => (left < right ? -1 : 1))
		.map(([name, tools]) => ({ name, enabled: !off.includes(name), tools: [...tools].sort((left, right) => (left.name < right.name ? -1 : 1)) }));
	return { cwd, global: section(global, []), local: section(localTools, disabledServers) };
}
