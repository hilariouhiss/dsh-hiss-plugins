import test from "node:test";
import assert from "node:assert/strict";
import { buildView, denyFor } from "../../lib/project-mcp/view.js";

test("longest server prefix owns the tool", () => {
	const view = buildView({
		cwd: "proj",
		toolNames: ["mcp__foo__a", "mcp__foo__bar__b", "mcp__zzz__c", "read"],
		globalServers: ["foo", "foo__bar"],
	});
	assert.deepEqual(view.global.find((server) => server.name === "foo").tools.map((tool) => tool.name), ["mcp__foo__a"]);
	assert.deepEqual(view.global.find((server) => server.name === "foo__bar").tools.map((tool) => tool.name), ["mcp__foo__bar__b"]);
	assert.deepEqual(view.global.find((server) => server.name === "zzz").tools.map((tool) => tool.name), ["mcp__zzz__c"]);
	assert.deepEqual(view.global.map((server) => server.name), ["foo", "foo__bar", "zzz"]);
});

test("workspace tools are attributed locally and stay visible", () => {
	const view = buildView({ cwd: "proj", toolNames: ["mcp__matlab__run"], globalServers: [], workspaceServers: ["matlab"] });
	assert.deepEqual(view.local, [{ name: "matlab", enabled: true, tools: [{ name: "mcp__matlab__run", enabled: true }] }]);
	assert.deepEqual(view.global, []);
});

test("a disabled workspace server and a disabled global tool keep their rows", () => {
	const view = buildView({
		cwd: "proj",
		toolNames: ["mcp__matlab__run"],
		globalServers: ["cg"],
		workspaceServers: ["matlab"],
		disabledTools: ["mcp__cg__explore"],
		disabledServers: ["matlab"],
	});
	assert.equal(view.local[0].enabled, false);
	assert.deepEqual(view.global.find((server) => server.name === "cg").tools, [{ name: "mcp__cg__explore", enabled: false }]);
});

test("an unknown server is derived from the tool name", () => {
	const view = buildView({ cwd: "proj", toolNames: ["mcp__mystery__t"] });
	assert.deepEqual(view.global, [{ name: "mystery", enabled: true, tools: [{ name: "mcp__mystery__t", enabled: true }] }]);
});

test("the view carries the workspace it describes", () => {
	assert.equal(buildView({ cwd: "proj", toolNames: [] }).cwd, "proj");
});
test("denyFor keeps only names that still exist globally, without duplicates", () => {
	assert.deepEqual(denyFor(["mcp__a__t", "read", "mcp__a__t"], ["mcp__a__t", "mcp__b__u"]), ["mcp__a__t"]);
	assert.deepEqual(denyFor([], ["mcp__a__t"]), []);
});
