import test from "node:test";
import assert from "node:assert/strict";
import { apply, codegraphConfig } from "../lib/index.js";

function makeContext(captures) {
	const ctx = {
		plugin(plugin, config) {
			captures.plugin = plugin;
			captures.config = config;
			return { dispose() {} };
		},
		systemPrompt: {
			section(section) {
				captures.sections.push(section);
				return () => {};
			},
		},
	};
	return ctx;
}

test("codegraphConfig builds a stdio config for `codegraph serve --mcp`", () => {
	const config = codegraphConfig("C:/ws");
	assert.equal(config.transport, "stdio");
	assert.equal(config.serverName, "codegraph");
	assert.equal(config.command, "codegraph");
	assert.deepEqual(config.args, ["serve", "--mcp"]);
	assert.deepEqual(config.env, {});
	assert.equal(config.cwd, "C:/ws");
	assert.equal(config.toolCallTimeoutMs, 120000);
	assert.equal(config.failOnStartupError, false);
});

test("apply loads the mcp-client bridge with the codegraph config", () => {
	const captures = { sections: [] };
	apply(makeContext(captures));

	assert.equal(typeof captures.plugin.apply, "function");
	assert.deepEqual(captures.plugin.inject, ["tools"]);
	assert.equal(captures.config.transport, "stdio");
	assert.equal(captures.config.serverName, "codegraph");
	assert.deepEqual(captures.config.args, ["serve", "--mcp"]);
});

test("apply registers the usage guidance section", () => {
	const captures = { sections: [] };
	apply(makeContext(captures));

	assert.equal(captures.sections.length, 1);
	const section = captures.sections[0];
	assert.equal(section.name, "codegraph:guidance");
	assert.equal(typeof section.text, "function");
	const text = section.text({ scope: { session: { header: { cwd: "C:/project" } } } });
	assert.ok(text.includes("mcp__codegraph__codegraph_explore"), "names the explore tool");
	assert.ok(text.includes("projectPath"), "tells the agent to pass projectPath");
	assert.ok(text.includes("codegraph init"), "points at the init prerequisite");
	assert.ok(text.includes("C:/project"), "injects the current workspace path");
});
