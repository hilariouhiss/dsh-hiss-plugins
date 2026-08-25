import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, registerCommands } from "../lib/commands.js";

test("maps 12 opsx commands to their bundled skills", () => {
	assert.equal(COMMANDS.length, 12);
	const byName = new Map(COMMANDS.map((c) => [c.name, c.skill]));
	assert.equal(byName.get("opsx-propose"), "openspec-propose");
	assert.equal(byName.get("opsx-apply"), "openspec-apply-change");
	assert.equal(byName.get("opsx-sync"), "openspec-sync-specs");
	assert.equal(byName.get("opsx-archive"), "openspec-archive-change");
	for (const { name } of COMMANDS) {
		assert.match(name, /^opsx-[a-z-]+$/);
	}
});

test("registerCommands registers one command per entry", () => {
	const registered = [];
	const ctx = { commands: { register(cmd) { registered.push(cmd); } } };
	registerCommands(ctx);
	assert.equal(registered.length, 12);
	assert.deepEqual(
		registered.map((c) => c.name).sort(),
		COMMANDS.map((c) => c.name).sort(),
	);
});
