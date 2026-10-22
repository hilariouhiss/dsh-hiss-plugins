import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, mountProjectMcp } from "../../lib/project-mcp/index.js";

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

/**
 * Stand in for the host context: warnings, the command registry, the tool
 * registry, and an `inject` that resolves immediately because the fake host
 * already has every service the command asks for.
 * @param {{ toolNames?: string[] }} [options] - tools the agent's registry shows.
 */
function fakeContext(options = {}) {
	const warnings = [];
	const registered = [];
	const schemas = [];
	const toolNames = options.toolNames ?? [];
	const ctx = {
		warnings,
		registered,
		schemas,
		logger: {
			warn(message) {
				warnings.push(String(message));
			},
		},
		tools: {
			schemas(scope) {
				schemas.push(scope);
				return toolNames.map((name) => ({ name }));
			},
		},
		commands: {
			register(definition) {
				registered.push(definition);
			},
		},
		inject(_services, callback) {
			callback(ctx);
		},
	};
	return ctx;
}

/** A host context with the agent registry `apply` wires into. */
function fakeHost(options = {}) {
	return { ...fakeContext(options), agents: { list: () => [] }, on() {} };
}

/** One `/mcp` invocation from a session in `cwd`. */
function commandInvocation(cwd, rawInput = "") {
	return {
		rawInput,
		agent: { id: "agent-1", session: { header: cwd === undefined ? {} : { cwd } } },
		attachments: [],
		signal: new AbortController().signal,
	};
}

/** Load the plugin into a fake host and return the registered `/mcp` command. */
function loadCommand(options = {}) {
	const ctx = fakeHost(options);
	apply(ctx);
	const command = ctx.registered.find((definition) => definition.name === "mcp");
	assert.ok(command, "the row must register the /mcp command");
	return { ctx, command };
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

test("/mcp reports connected, skipped, unusable, and other servers", async () => {
	const cwd = projectWithServers({
		fs: { command: "npx" },
		web: { type: "http", url: "https://example.com/mcp" },
		broken: {},
		"bad name": { command: "npx" },
	});
	const { command, ctx } = loadCommand({
		toolNames: ["mcp__fs__read", "mcp__fs__write", "mcp__web__search", "mcp__matlab__run", "read"],
	});
	const invocation = commandInvocation(cwd);

	const result = await command.handler(invocation);

	assert.equal(result.kind, "success");
	assert.match(result.text, /^MCP servers for .*\.mcp\.json:$/mu);
	assert.match(result.text, /^- fs: connected, 2 tools$/mu);
	assert.match(result.text, /^- web: connected, 1 tool$/mu);
	assert.match(result.text, /^- broken: skipped - "broken": command/mu);
	assert.match(result.text, /^- bad name: unusable - /mu);
	assert.match(result.text, /^Other MCP tools in this session: 1 \(servers configured outside this project\)\.$/mu);
	assert.deepEqual(ctx.schemas, [invocation.agent], "status is read from this agent's own tool view");
});

test("/mcp reports a declared server with no live tools", async () => {
	const cwd = projectWithServers({ memory: { command: "npx" } });
	const { command } = loadCommand({ toolNames: ["mcp__matlab__run"] });

	const result = await command.handler(commandInvocation(cwd));

	assert.equal(result.kind, "success");
	assert.match(result.text, /^- memory: no tools \(not connected, or the server exposes none\)$/mu);
	assert.match(result.text, /^Other MCP tools in this session: 1 \(servers configured outside this project\)\.$/mu);
});

test("/mcp reports a project config that declares no servers", async () => {
	const cwd = projectWith("{}");
	const { command } = loadCommand();

	const result = await command.handler(commandInvocation(cwd));

	assert.equal(result.kind, "success");
	assert.match(result.text, /^- none declared$/mu);
	assert.doesNotMatch(result.text, /Other MCP tools/);
});

test("/mcp reports a missing project config and the session's other MCP tools", async () => {
	const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
	mkdirSync(join(root, ".git"), { recursive: true });
	const { command } = loadCommand({ toolNames: ["mcp__matlab__run", "mcp__codegraph__explore", "read"] });

	const result = await command.handler(commandInvocation(root));

	assert.equal(result.kind, "success");
	assert.equal(
		result.text,
		`No .mcp.json found for this project (${root}).\n\nOther MCP tools in this session: 2 (servers configured outside this project).`,
	);
});

test("/mcp reports a malformed config as an error", async () => {
	const cwd = projectWith("{ not json");
	const { command } = loadCommand();

	const result = await command.handler(commandInvocation(cwd));

	assert.equal(result.kind, "error");
	assert.match(result.text, /not valid JSON/);
});

test("/mcp rejects arguments", async () => {
	const cwd = projectWithServers({ fs: { command: "npx" } });
	const { command, ctx } = loadCommand({ toolNames: ["mcp__fs__read"] });

	const result = await command.handler(commandInvocation(cwd, " extra"));

	assert.deepEqual(result, { kind: "error", text: "Usage: /mcp (no arguments)" });
	assert.deepEqual(ctx.schemas, [], "a usage error must not touch the tool registry");
});

test("/mcp reports a session without a working directory", async () => {
	const { command, ctx } = loadCommand({ toolNames: ["mcp__fs__read"] });

	const result = await command.handler(commandInvocation(undefined));

	assert.deepEqual(result, {
		kind: "error",
		text: "No session working directory; no project MCP servers are mounted.",
	});
	assert.deepEqual(ctx.schemas, []);
});
