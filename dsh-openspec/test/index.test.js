import { test } from "node:test";
import assert from "node:assert/strict";
import { name, inject, apply } from "../lib/index.js";

test("exports plugin identity and inject list", () => {
	assert.equal(name, "openspec");
	assert.deepEqual(inject, ["skills", "systemPrompt", "commands"]);
});

test("apply registers provider, adoption section, and 12 commands", () => {
	const calls = { provider: 0, section: 0, command: 0 };
	const ctx = {
		skills: { registerProvider() { calls.provider++; } },
		systemPrompt: { section() { calls.section++; } },
		commands: { register() { calls.command++; } },
	};
	apply(ctx);
	assert.equal(calls.provider, 1);
	assert.equal(calls.section, 1);
	assert.equal(calls.command, 12);
});
