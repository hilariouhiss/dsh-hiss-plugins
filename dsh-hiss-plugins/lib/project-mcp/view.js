/**
 * The `/mcp` dialog view: one pure function that turns what the session sees into
 * the two columns the dialog draws, so the host seam stays thin and every
 * attribution rule is testable without a host.
 *
 * @module dsh-hiss-plugins/project-mcp/view
 */

/** Prefix the bridge puts on every tool it registers. */
const MCP_PREFIX = "mcp__";

/**
 * The server that owns one tool name, longest declared name first. The bridge never
 * parses a tool name back (both halves may contain underscores), so ownership is a
 * prefix match against the servers this session actually declares.
 * @param {string} toolName - the public tool name.
 * @param {string[]} names - server names, longest first.
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

/** Sort server entries by name, then their tools by name. */
function sorted(entries) {
	return entries
		.map((entry) => ({ ...entry, tools: [...entry.tools].sort((left, right) => (left.name < right.name ? -1 : 1)) }))
		.sort((left, right) => (left.name < right.name ? -1 : 1));
}

/**
 * Build the dialog view.
 *
 * Attribution answers one question: which column owns a tool right now? A tool
 * belongs to the workspace only while its declared copy is mounted; a switched-off
 * workspace copy is unmounted, so a same-named global server receives its tools.
 * That is what makes "register globally" land in the global column immediately.
 *
 * @param {object} input - what the session currently holds.
 * @param {string} input.cwd - the session workspace directory.
 * @param {string[]} [input.toolNames] - tools the agent can see right now.
 * @param {{ name: string, managed?: boolean, enabled?: boolean }[]} [input.globalServers]
 *   servers configured outside this workspace, with the manager state when known.
 * @param {string[]} [input.workspaceServers] - server names this workspace declares.
 * @param {string[]} [input.disabledTools] - tools this workspace switched off.
 * @param {string[]} [input.disabledServers] - workspace servers this workspace switched off.
 * @returns {{ cwd: string, global: object[], local: object[] }} the two columns.
 */
export function buildView({ cwd, toolNames = [], globalServers = [], workspaceServers = [], disabledTools = [], disabledServers = [] }) {
	const localEnabled = workspaceServers.filter((name) => !disabledServers.includes(name));
	const globalByName = new Map(globalServers.map((entry) => [entry.name, entry]));
	const declared = [...new Set([...localEnabled, ...globalByName.keys()])].sort((left, right) => right.length - left.length);
	const globalTools = new Map([...globalByName.keys()].map((name) => [name, []]));
	const localTools = new Map(localEnabled.map((name) => [name, []]));
	const visible = new Set(toolNames.filter((name) => name.startsWith(MCP_PREFIX)));
	// A switched-off tool is no longer visible, so the remembered name is what keeps its row alive.
	for (const name of [...visible, ...disabledTools.filter((tool) => !visible.has(tool))]) {
		if (!name.startsWith(MCP_PREFIX)) continue;
		const server = serverOf(name, declared);
		const row = { name, enabled: !disabledTools.includes(name) };
		if (localTools.has(server)) localTools.get(server).push(row);
		else if (globalTools.has(server)) globalTools.get(server).push(row);
		else globalTools.set(server, [row]);
	}
	const global = sorted([...globalByName.entries()].map(([name, entry]) => ({
		name,
		managed: entry.managed === true,
		enabled: entry.enabled !== false,
		tools: globalTools.get(name) ?? [],
	})));
	for (const [name, tools] of globalTools) {
		if (globalByName.has(name)) continue;
		global.push({ name, managed: false, enabled: true, tools });
	}
	const local = sorted(workspaceServers.map((name) => ({
		name,
		enabled: localEnabled.includes(name),
		tools: localTools.get(name) ?? [],
	})));
	return { cwd, global: sorted(global), local };
}

/**
 * The tools one workspace has switched off that still exist globally.
 *
 * `tools.restrict` refuses a name it cannot see, so a remembered name that no
 * longer exists (a server removed, a project tool) must be dropped here instead
 * of failing the whole restriction.
 * @param {string[]} disabledTools - the workspace switch list.
 * @param {string[]} globalNames - names currently registered in the global view.
 * @returns {string[]} the usable deny set, without duplicates.
 */
export function denyFor(disabledTools, globalNames) {
	const known = new Set(globalNames);
	return [...new Set(disabledTools)].filter((name) => known.has(name));
}
