import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, inject, name } from "../lib/index.js";

test("exports plugin identity and inject list", () => {
	assert.equal(name, "superpowers");
	assert.deepEqual(inject, ["skills", "systemPrompt"]);
});

test("apply registers provider and bootstrap section", () => {
	const calls = { provider: 0, sections: [] };
	const ctx = {
		skills: { registerProvider() { calls.provider++; } },
		systemPrompt: { section(section) { calls.sections.push(section); } },
	};
	apply(ctx);
	assert.equal(calls.provider, 1);
	assert.equal(calls.sections.length, 1);
	assert.equal(calls.sections[0].name, "superpowers:adoption");
	assert.ok(calls.sections[0].text.includes("<EXTREMELY_IMPORTANT>"));
	assert.ok(calls.sections[0].text.includes("check whether a superpowers skill applies"));
	assert.ok(!calls.sections[0].text.includes("<SUBAGENT-STOP>"), "no longer embeds the full using-superpowers body");
});
