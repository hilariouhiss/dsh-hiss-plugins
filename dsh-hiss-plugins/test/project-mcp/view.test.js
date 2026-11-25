import test from "node:test";
import assert from "node:assert/strict";
import { buildView, denyFor } from "../../lib/project-mcp/view.js";

test("longest server prefix owns the tool", () => {
	const view = buildView({
		cwd: "proj",
		toolNames: ["mcp__foo__a", "mcp__foo__bar__b", "mcp__zzz__c", "read"],
		globalServers: [{ name: "foo" }, { name: "foo__bar" }],
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

test("a disabled workspace server keeps its row but loses its tools", () => {
	const view = buildView({
		cwd: "proj",
		toolNames: [],
		globalServers: [{ name: "cg", managed: true, enabled: true }],
		workspaceServers: ["matlab"],
		disabledTools: ["mcp__cg__explore"],
		disabledServers: ["matlab"],
	});
	assert.deepEqual(view.local, [{ name: "matlab", enabled: false, tools: [] }]);
	assert.deepEqual(view.global.find((server) => server.name === "cg").tools, [{ name: "mcp__cg__explore", enabled: false }]);
});

test("a promoted server is shown globally even while still declared locally", () => {
	const view = buildView({
		cwd: "proj",
		toolNames: ["mcp__matlab__run"],
		globalServers: [{ name: "matlab", managed: true, enabled: true }],
		workspaceServers: ["matlab"],
		disabledServers: ["matlab"],
	});
	assert.deepEqual(view.local, [{ name: "matlab", enabled: false, tools: [] }], "the local copy stays visible as off");
	assert.deepEqual(view.global, [{ name: "matlab", managed: true, enabled: true, tools: [{ name: "mcp__matlab__run", enabled: true }] }], "its tools belong to the global copy");
});

test("an unknown server is derived from the tool name", () => {
	const view = buildView({ cwd: "proj", toolNames: ["mcp__mystery__t"] });
	assert.deepEqual(view.global, [{ name: "mystery", managed: false, enabled: true, tools: [{ name: "mcp__mystery__t", enabled: true }] }]);
});

test("a manager-disabled server keeps its row and its remembered tools", () => {
	const view = buildView({
		cwd: "proj",
		toolNames: [],
		globalServers: [{ name: "matlab", managed: true, enabled: false }],
		disabledTools: [],
	});
	assert.deepEqual(view.global, [{ name: "matlab", managed: true, enabled: false, tools: [] }]);
});

test("the view carries the workspace it describes", () => {
	assert.equal(buildView({ cwd: "proj", toolNames: [] }).cwd, "proj");
});

test("denyFor keeps only names that still exist globally, without duplicates", () => {
	assert.deepEqual(denyFor(["mcp__a__t", "read", "mcp__a__t"], ["mcp__a__t", "mcp__b__u"]), ["mcp__a__t"]);
	assert.deepEqual(denyFor([], ["mcp__a__t"]), []);
});
