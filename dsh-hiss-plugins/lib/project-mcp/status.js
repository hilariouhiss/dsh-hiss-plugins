/**
 * The `/mcp` report: pure formatting and tool attribution, so the command seam in
 * `index.js` stays thin and every branch is testable without a host.
 *
 * @module dsh-hiss-plugins/project-mcp/status
 */

/** Prefix the MCP bridge puts on every tool it registers. */
const MCP_PREFIX = "mcp__";

/**
 * Count the live MCP tools each declared server owns.
 *
 * The bridge names a tool `mcp__<serverName>__<rawName>` and never parses that
 * name back, because both halves may contain underscores. Attribution here is a
 * prefix match against the names this project actually declares; when two names
 * both match (a declared `foo` and `foo__bar`), the longer one owns the tool.
 * Everything else with the bridge prefix belongs to a server configured outside
 * this project.
 *
 * @param {string[]} toolNames - names visible to the session's agent.
 * @param {string[]} serverNames - server names this project declares.
 * @returns {{ tools: Map<string, number>, other: number }} the per-server tool
 *   counts and how many bridge tools no declared server owns.
 */
export function countTools(toolNames, serverNames) {
	const tools = new Map(serverNames.map((serverName) => [serverName, 0]));
	const longestFirst = [...serverNames].sort((left, right) => right.length - left.length);
	let other = 0;
	for (const toolName of toolNames) {
		if (!toolName.startsWith(MCP_PREFIX)) continue;
		const owner = longestFirst.find((serverName) => toolName.startsWith(`${MCP_PREFIX}${serverName}__`));
		if (owner === undefined) other += 1;
		else tools.set(owner, tools.get(owner) + 1);
	}
	return { tools, other };
}

/**
 * Append the session-wide MCP tool count, when there is one to report.
 * @param {string} text - the project-scoped report.
 * @param {number} other - bridge tools from servers declared outside this project.
 * @returns {string} the report, with the extra line when it applies.
 */
function withOther(text, other) {
	if (other === 0) return text;
	return `${text}\n\nOther MCP tools in this session: ${other} (servers configured outside this project).`;
}

/**
 * Format the `/mcp` report.
 *
 * @param {object} report - what the command observed.
 * @param {string} report.cwd - the session's working directory.
 * @param {string} [report.configPath] - the project's `.mcp.json`, when one governs the session.
 * @param {{ serverName: string, tools: number }[]} [report.servers] - servers the bridge accepted.
 * @param {{ serverName: string, reason: string }[]} [report.invalid] - accepted entries the bridge schema refused.
 * @param {{ serverName: string, reason: string }[]} [report.skipped] - entries that could not be mapped.
 * @param {number} [report.otherTools] - bridge tools from servers not declared here.
 * @returns {string} the command text.
 */
export function renderStatus({ cwd, configPath, servers = [], invalid = [], skipped = [], otherTools = 0 }) {
	if (configPath === undefined) {
		return withOther(`No .mcp.json found for this project (${cwd}).`, otherTools);
	}
	const lines = [`MCP servers for ${configPath}:`];
	if (servers.length + invalid.length + skipped.length === 0) lines.push("- none declared");
	for (const { serverName, tools } of servers) {
		lines.push(
			tools === 0
				? `- ${serverName}: no tools (not connected, or the server exposes none)`
				: `- ${serverName}: connected, ${tools} tool${tools === 1 ? "" : "s"}`,
		);
	}
	for (const { serverName, reason } of invalid) lines.push(`- ${serverName}: unusable - ${reason}`);
	for (const { serverName, reason } of skipped) lines.push(`- ${serverName}: skipped - ${reason}`);
	return withOther(lines.join("\n"), otherTools);
}
