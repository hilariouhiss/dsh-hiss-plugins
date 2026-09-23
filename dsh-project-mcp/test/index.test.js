import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, mountProjectMcp } from "../lib/index.js";

/** A project directory holding one `.mcp.json` with the given raw text. */
function projectWith(text) {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	mkdirSync(join(root, ".git"), { recursive: true });
	writeFileSync(join(root, ".mcp.json"), text);
	return root;
}

/** A project directory whose `.mcp.json` declares the given servers. */
function projectWithServers(servers) {
	return projectWith(JSON.stringify({ mcpServers: servers }));
}

/**
 * Stand in for one live agent: the session cwd the plugin reads, plus the
 * scoped context it mounts into.
 * @param {string} [cwd] - the session directory, or omitted for no cwd.
 * @param {{ failOn?: string }} [options] - server name whose mount should reject.
 */
function fakeAgent(cwd, options = {}) {
	const mounted = [];
	const agent = {
		id: "agent-1",
		session: { header: cwd === undefined ? {} : { cwd } },
		ctx: {
			plugin(plugin, config) {
				if (options.failOn !== undefined && config.serverName === options.failOn) {
					return Promise.reject(new Error("bridge refused to activate"));
				}
				mounted.push({ plugin, config });
				return Promise.resolve();
			},
		},
	};
	return { agent, mounted };
}

/** Collect warnings so error branches are asserted, not assumed. */
function fakeContext() {
	const warnings = [];
	return {
		warnings,
		logger: {
			warn(message) {
				warnings.push(String(message));
			},
		},
	};
}

/** Poll until `ready` holds, so a background sweep needs no fixed sleep. */
async function waitFor(ready) {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (ready()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("condition never became true");
}

test("mountProjectMcp mounts every server of the session's project into the agent scope", async () => {
	const cwd = projectWithServers({
		fs: { command: "npx", args: ["-y", "server-fs"] },
		web: { type: "http", url: "https://example.com/mcp" },
	});
	const { agent, mounted } = fakeAgent(cwd);

	const count = await mountProjectMcp(fakeContext(), agent);

	assert.equal(count, 2);
	assert.deepEqual(
		mounted.map((entry) => entry.config.transport),
		["stdio", "streamable-http"],
	);
	assert.deepEqual(
		mounted.map((entry) => entry.config.serverName),
		["fs", "web"],
	);
	for (const entry of mounted) {
		assert.equal(typeof entry.plugin.apply, "function", "mounts the host bridge module");
		assert.deepEqual(entry.plugin.inject, ["tools"], "mounts the bridge, not a look-alike");
	}
});

test("mountProjectMcp does nothing when the session has no working directory", async () => {
	const { agent, mounted } = fakeAgent(undefined);

	assert.equal(await mountProjectMcp(fakeContext(), agent), 0);
	assert.deepEqual(mounted, []);
});

test("mountProjectMcp does nothing when the project has no .mcp.json", async () => {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	mkdirSync(join(root, ".git"), { recursive: true });
	const { agent, mounted } = fakeAgent(root);

	assert.equal(await mountProjectMcp(fakeContext(), agent), 0);
	assert.deepEqual(mounted, []);
});

test("mountProjectMcp keeps mounting after one server fails to load", async () => {
	const cwd = projectWithServers({ broken: { command: "npx" }, working: { command: "npx" } });
	const { agent, mounted } = fakeAgent(cwd, { failOn: "broken" });
	const ctx = fakeContext();

	assert.equal(await mountProjectMcp(ctx, agent), 1);
	assert.deepEqual(
		mounted.map((entry) => entry.config.serverName),
		["working"],
	);
	assert.equal(ctx.warnings.length, 1);
	assert.match(ctx.warnings[0], /broken/);
});

test("mountProjectMcp reports an unusable server name instead of throwing", async () => {
	const cwd = projectWithServers({ "not a valid name": { command: "npx" } });
	const { agent, mounted } = fakeAgent(cwd);
	const ctx = fakeContext();

	assert.equal(await mountProjectMcp(ctx, agent), 0);
	assert.deepEqual(mounted, []);
	assert.equal(ctx.warnings.length, 1);
	assert.match(ctx.warnings[0], /not a valid name/);
});

test("mountProjectMcp reports a malformed config without failing the session", async () => {
	const cwd = projectWith("{ not json");
	const { agent, mounted } = fakeAgent(cwd);
	const ctx = fakeContext();

	assert.equal(await mountProjectMcp(ctx, agent), 0);
	assert.deepEqual(mounted, []);
	assert.equal(ctx.warnings.length, 1);
	assert.match(ctx.warnings[0], /not valid JSON/);
});

test("mountProjectMcp warns by name for each skipped server", async () => {
	const cwd = projectWithServers({ modern: { type: "sse", url: "https://example.com/sse" } });
	const { agent, mounted } = fakeAgent(cwd);
	const ctx = fakeContext();

	assert.equal(await mountProjectMcp(ctx, agent), 0);
	assert.deepEqual(mounted, []);
	assert.equal(ctx.warnings.length, 1);
	assert.match(ctx.warnings[0], /modern/);
});

test("apply mounts the project's servers for every agent created afterwards", async () => {
	const cwd = projectWithServers({ fs: { command: "npx" } });
	const listeners = new Map();
	const ctx = {
		...fakeContext(),
		agents: { list: () => [] },
		on(event, listener) {
			listeners.set(event, listener);
		},
	};
	apply(ctx);
	const { agent, mounted } = fakeAgent(cwd);

	await listeners.get("agent/created")({ agent });

	assert.deepEqual(
		mounted.map((entry) => entry.config.serverName),
		["fs"],
	);
});

test("apply mounts for agents that already exist when the plugin loads", async () => {
	const cwd = projectWithServers({ fs: { command: "npx" } });
	const { agent, mounted } = fakeAgent(cwd);
	const ctx = {
		...fakeContext(),
		agents: { list: () => [agent] },
		on() {},
	};

	apply(ctx);
	await waitFor(() => mounted.length > 0);

	assert.deepEqual(
		mounted.map((entry) => entry.config.serverName),
		["fs"],
	);
});

test("apply never lets a mounting failure escape the creation listener", async () => {
	const cwd = projectWithServers({ fs: { command: "npx" } });
	const listeners = new Map();
	const ctx = {
		...fakeContext(),
		agents: { list: () => [] },
		on(event, listener) {
			listeners.set(event, listener);
		},
	};
	apply(ctx);
	const { agent } = fakeAgent(cwd);
	agent.ctx.plugin = () => {
		throw new Error("bridge refused to activate");
	};

	await assert.doesNotReject(() => listeners.get("agent/created")({ agent }));
	assert.equal(ctx.warnings.length, 1);
	assert.match(ctx.warnings[0], /fs/);
});
