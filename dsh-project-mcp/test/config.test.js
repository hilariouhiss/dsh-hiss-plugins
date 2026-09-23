import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expand, findConfigPath, loadServers } from "../lib/config.js";

/** Build `{root}/{name}` and return its absolute path. */
function dir(root, name) {
	const path = join(root, name);
	mkdirSync(path, { recursive: true });
	return path;
}

/** Write a marker file so the walk-up logic has something to find. */
function touch(path, content = "{}") {
	writeFileSync(path, content);
	return path;
}

test("findConfigPath prefers the .mcp.json in the session directory", async () => {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	const project = dir(root, "project");
	touch(join(project, ".git"));
	const expected = touch(join(project, ".mcp.json"));

	assert.equal(await findConfigPath(project), expected);
});

test("findConfigPath walks up to the project root", async () => {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	const project = dir(root, "project");
	touch(join(project, ".git"));
	const expected = touch(join(project, ".mcp.json"));
	const nested = dir(project, "packages/deep");

	assert.equal(await findConfigPath(nested), expected);
});

test("findConfigPath stops at the git root and ignores an ancestor's .mcp.json", async () => {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	touch(join(root, ".git"));
	touch(join(root, ".mcp.json"));
	const nested = dir(root, "nested/project");
	touch(join(nested, ".git"));

	assert.equal(await findConfigPath(nested), undefined);
});

test("findConfigPath returns undefined when no project config exists", async () => {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	const project = dir(root, "project");
	touch(join(project, ".git"));

	assert.equal(await findConfigPath(project), undefined);
});

/** Build a project directory holding one `.mcp.json` with the given servers. */
function withServers(servers) {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	touch(join(root, ".git"));
	const configPath = touch(join(root, ".mcp.json"), JSON.stringify({ mcpServers: servers }));
	return { root, configPath };
}

test("loadServers maps a stdio server and defaults its cwd to the project", async () => {
	const { root, configPath } = withServers({
		fs: { command: "npx", args: ["-y", "server-fs"], env: { ROOT: "." } },
	});

	const { servers, skipped } = await loadServers(configPath, root);

	assert.deepEqual(skipped, []);
	assert.deepEqual(servers, [
		{
			serverName: "fs",
			spec: {
				transport: "stdio",
				serverName: "fs",
				command: "npx",
				args: ["-y", "server-fs"],
				env: { ROOT: "." },
				cwd: root,
			},
		},
	]);
});

test("loadServers maps an http server to the streamable-http transport", async () => {
	const { root, configPath } = withServers({
		web: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer t" } },
	});

	const { servers, skipped } = await loadServers(configPath, root);

	assert.deepEqual(skipped, []);
	assert.deepEqual(servers, [
		{
			serverName: "web",
			spec: {
				transport: "streamable-http",
				serverName: "web",
				url: "https://example.com/mcp",
				headers: { Authorization: "Bearer t" },
			},
		},
	]);
});

test("loadServers reports an unsupported transport by name", async () => {
	const { root, configPath } = withServers({ old: { type: "sse", url: "https://example.com/sse" } });

	const { servers, skipped } = await loadServers(configPath, root);

	assert.deepEqual(servers, []);
	assert.equal(skipped.length, 1);
	assert.equal(skipped[0].serverName, "old");
	assert.match(skipped[0].reason, /sse/);
});

test("loadServers skips one invalid server and keeps its siblings", async () => {
	const { root, configPath } = withServers({ bad: { args: ["no-command"] }, good: { command: "npx" } });

	const { servers, skipped } = await loadServers(configPath, root);

	assert.deepEqual(
		servers.map((server) => server.serverName),
		["good"],
	);
	assert.deepEqual(
		skipped.map((server) => server.serverName),
		["bad"],
	);
	assert.match(skipped[0].reason, /command/);
});

test("expand interpolates ${VAR} and ${VAR:-default}", () => {
	process.env.PROJECT_MCP_TEST_TOKEN = "token";
	try {
		assert.equal(expand("Bearer ${PROJECT_MCP_TEST_TOKEN}"), "Bearer token");
		assert.equal(expand("${PROJECT_MCP_TEST_ABSENT:-fallback}"), "fallback");
		assert.equal(expand("${PROJECT_MCP_TEST_ABSENT}"), "");
	} finally {
		delete process.env.PROJECT_MCP_TEST_TOKEN;
	}
});

test("loadServers expands variables inside the server entry", async () => {
	process.env.PROJECT_MCP_TEST_TOKEN = "s3cret";
	try {
		const { root, configPath } = withServers({
			api: {
				type: "http",
				url: "https://example.com/${PROJECT_MCP_TEST_TOKEN:-none}",
				headers: { Authorization: "Bearer ${PROJECT_MCP_TEST_TOKEN}" },
			},
		});

		const { servers } = await loadServers(configPath, root);

		assert.equal(servers[0].spec.url, "https://example.com/s3cret");
		assert.deepEqual(servers[0].spec.headers, { Authorization: "Bearer s3cret" });
	} finally {
		delete process.env.PROJECT_MCP_TEST_TOKEN;
	}
});

test("loadServers returns nothing for a config without mcpServers", async () => {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	const configPath = touch(join(root, ".mcp.json"), "{}");

	assert.deepEqual(await loadServers(configPath, root), { servers: [], skipped: [] });
});

test("loadServers rejects a config whose mcpServers is not an object", async () => {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	const configPath = touch(join(root, ".mcp.json"), '{"mcpServers": []}');

	await assert.rejects(() => loadServers(configPath, root), /mcpServers/);
});

test("loadServers rejects a config that is not valid JSON", async () => {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	const configPath = touch(join(root, ".mcp.json"), "{ not json");

	await assert.rejects(() => loadServers(configPath, root), /not valid JSON/);
});
