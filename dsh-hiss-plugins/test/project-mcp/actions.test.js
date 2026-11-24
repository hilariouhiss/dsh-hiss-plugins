import test from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../../lib/project-mcp/actions.js";

/** Deps that record every call and answer nothing. */
function deps(calls) {
	return {
		status: async (sessionId) => { calls.push(["status", sessionId]); return { global: [], local: [] }; },
		setTool: async (sessionId, tool, enabled) => { calls.push(["setTool", sessionId, tool, enabled]); },
		setServer: async (sessionId, server, enabled) => { calls.push(["setServer", sessionId, server, enabled]); },
		add: async (sessionId, input) => { calls.push(["add", sessionId, input]); },
		promote: async (sessionId, server) => { calls.push(["promote", sessionId, server]); },
	};
}

test("status reaches the dep with the session id", async () => {
	const calls = [];
	assert.deepEqual(await dispatch({ action: "status", sessionId: "s1" }, deps(calls)), { ok: true, value: { global: [], local: [] } });
	assert.deepEqual(calls, [["status", "s1"]]);
});

test("set-tool, set-server and promote forward their arguments", async () => {
	const calls = [];
	await dispatch({ action: "set-tool", sessionId: "s1", tool: "mcp__a__t", enabled: false }, deps(calls));
	await dispatch({ action: "set-server", sessionId: "s1", server: "matlab", enabled: true }, deps(calls));
	await dispatch({ action: "promote", sessionId: "s1", server: "matlab" }, deps(calls));
	assert.deepEqual(calls, [
		["setTool", "s1", "mcp__a__t", false],
		["setServer", "s1", "matlab", true],
		["promote", "s1", "matlab"],
	]);
});

test("add-server forwards the whole server input", async () => {
	const calls = [];
	const server = { name: "web", scope: "workspace", type: "http", url: "https://example.com/mcp" };
	await dispatch({ action: "add-server", sessionId: "s1", server }, deps(calls));
	assert.deepEqual(calls, [["add", "s1", server]]);
});

test("a missing session id is refused without touching deps", async () => {
	const calls = [];
	assert.deepEqual(await dispatch({ action: "status" }, deps(calls)), {
		ok: false, error: { code: "invalid-request", message: "sessionId is required" },
	});
	assert.deepEqual(calls, []);
});

test("an unknown action names itself", async () => {
	assert.deepEqual(await dispatch({ action: "nope", sessionId: "s1" }, deps([])), {
		ok: false, error: { code: "unknown-action", message: 'unknown action "nope"' },
	});
});

test("a non-boolean switch is refused", async () => {
	assert.deepEqual(await dispatch({ action: "set-tool", sessionId: "s1", tool: "mcp__a__t", enabled: "off" }, deps([])), {
		ok: false, error: { code: "invalid-request", message: "enabled must be a boolean" },
	});
});

test("a dep failure becomes a failed answer, not a throw", async () => {
	const failing = { ...deps([]), setServer: async () => { throw new Error("no such server"); } };
	assert.deepEqual(await dispatch({ action: "set-server", sessionId: "s1", server: "x", enabled: true }, failing), {
		ok: false, error: { code: "failed", message: "no such server" },
	});
});
