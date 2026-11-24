import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState, isToolEnabled, isServerEnabled, withTool, withServer, readState, writeState, statePath } from "../../lib/project-mcp/state.js";

test("normalizeState drops unknown shapes", () => {
	assert.deepEqual(normalizeState(null), { workspaces: {} });
	assert.deepEqual(normalizeState({ workspaces: { proj: { disabledTools: "x", extra: 1 } } }), {
		workspaces: { proj: { disabledTools: [], disabledServers: [] } },
	});
});

test("toggling a tool off then on round-trips per workspace", () => {
	const off = withTool(emptyState(), "proj", "mcp__a__t", false);
	assert.equal(isToolEnabled(off, "proj", "mcp__a__t"), false);
	assert.equal(isToolEnabled(off, "other", "mcp__a__t"), true);
	const on = withTool(off, "proj", "mcp__a__t", true);
	assert.equal(isToolEnabled(on, "proj", "mcp__a__t"), true);
	assert.deepEqual(off.workspaces[resolve("proj")].disabledTools, ["mcp__a__t"], "the switch is recorded under the resolved directory");
});

test("servers toggle like tools", () => {
	const off = withServer(emptyState(), "proj", "matlab", false);
	assert.equal(isServerEnabled(off, "proj", "matlab"), false);
	assert.equal(isServerEnabled(off, "other", "matlab"), true);
	assert.deepEqual(off.workspaces[resolve("proj")].disabledServers, ["matlab"]);
});

test("readState falls back to empty on a corrupt or missing file", async () => {
	const dir = mkdtempSync(join(tmpdir(), "hiss-state-"));
	const path = join(dir, "state.json");
	assert.deepEqual(await readState(path), emptyState(), "missing file");
	writeFileSync(path, "{not json");
	assert.deepEqual(await readState(path), emptyState(), "corrupt file");
	rmSync(dir, { recursive: true, force: true });
});

test("writeState then readState round-trips atomically", async () => {
	const dir = mkdtempSync(join(tmpdir(), "hiss-state-"));
	const path = join(dir, "nested", "state.json");
	const state = withServer(emptyState(), "proj", "matlab", false);
	await writeState(path, state);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), state);
	assert.deepEqual(await readState(path), state);
	const home = join(tmpdir(), "home");
	assert.equal(statePath(home), join(home, ".dsh", "hiss-mcp.json"));
	rmSync(dir, { recursive: true, force: true });
});