import test from "node:test";
import assert from "node:assert/strict";
import { countTools, renderStatus } from "../../lib/project-mcp/status.js";

test("countTools attributes bridge tools to their declared server and counts the rest", () => {
	const { tools, other } = countTools(
		["mcp__fs__read", "mcp__fs__write", "mcp__web__search", "mcp__matlab__run", "read", "bash"],
		["fs", "web"],
	);

	assert.deepEqual(
		[...tools],
		[
			["fs", 2],
			["web", 1],
		],
	);
	assert.equal(other, 1, "the matlab tool belongs to a server this project does not declare");
});

test("countTools prefers the longest declared name when both prefixes match", () => {
	const { tools, other } = countTools(["mcp__foo__bar__x"], ["foo", "foo__bar"]);

	assert.deepEqual(
		[...tools],
		[
			["foo", 0],
			["foo__bar", 1],
		],
	);
	assert.equal(other, 0);
});

test("countTools ignores non-MCP tools and leaves other bridge-shaped names unattributed", () => {
	const { tools, other } = countTools(["read", "mcp__fs", "mcp__fs_extra"], ["fs"]);

	assert.equal(tools.get("fs"), 0);
	assert.equal(other, 2);
});

test("renderStatus lists every server, refused entry, and skipped entry", () => {
	const text = renderStatus({
		cwd: "C:\\project",
		configPath: "C:\\project\\.mcp.json",
		servers: [
			{ serverName: "fs", tools: 2 },
			{ serverName: "web", tools: 1 },
			{ serverName: "memory", tools: 0 },
		],
		invalid: [{ serverName: "bad name", reason: '"bad name": serverName is not valid' }],
		skipped: [{ serverName: "old", reason: '"old": unsupported transport "sse"' }],
		otherTools: 3,
	});

	assert.match(text, /^MCP servers for C:\\project\\.mcp.json:$/mu);
	assert.match(text, /^- fs: connected, 2 tools$/mu);
	assert.match(text, /^- web: connected, 1 tool$/mu);
	assert.match(text, /^- memory: no tools \(not connected, or the server exposes none\)$/mu);
	assert.match(text, /^- bad name: unusable - "bad name": serverName is not valid$/mu);
	assert.match(text, /^- old: skipped - "old": unsupported transport "sse"$/mu);
	assert.match(text, /^Other MCP tools in this session: 3 \(servers configured outside this project\)\.$/mu);
});

test("renderStatus says so when the file declares no servers", () => {
	const text = renderStatus({ cwd: "C:\\project", configPath: "C:\\project\\.mcp.json" });

	assert.equal(text, "MCP servers for C:\\project\\.mcp.json:\n- none declared");
});

test("renderStatus reports a missing project config and still counts other MCP tools", () => {
	assert.equal(
		renderStatus({ cwd: "C:\\project" }),
		"No .mcp.json found for this project (C:\\project).",
	);
	assert.equal(
		renderStatus({ cwd: "C:\\project", otherTools: 2 }),
		"No .mcp.json found for this project (C:\\project).\n\nOther MCP tools in this session: 2 (servers configured outside this project).",
	);
});
