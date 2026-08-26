import test from "node:test";
import assert from "node:assert/strict";
import { currentMode, parseLevel, registerCommands } from "../lib/commands.js";

function makeContext(followups, skills) {
	const definitions = [];
	const ctx = {
		skills: skills?.get ? skills : {
			async get(name) {
				return {
					name,
					description: "test skill",
					invocation: { modelInvocable: true, userInvocable: true },
					source: "test",
					provider: "test",
					content: "SKILL BODY",
				};
			},
		},
		commands: {
			register(definition) {
				definitions.push(definition);
				return () => {};
			},
		},
	};
	return { ctx, definitions, followups };
}

const agent = (followups) => ({
	session: { header: { cwd: "C:/project" } },
	followup(message) {
		followups.push(message);
	},
});

test("parseLevel parses the intensity grammar", () => {
	assert.equal(parseLevel(undefined), "full");
	assert.equal(parseLevel(""), "full");
	assert.equal(parseLevel("   "), "full");
	assert.equal(parseLevel("lite"), "lite");
	assert.equal(parseLevel(" FULL "), "full");
	assert.equal(parseLevel("ultra"), "ultra");
	assert.equal(parseLevel("off"), "off");
	assert.equal(parseLevel("bogus"), undefined);
});

test("registerCommands registers all six commands", () => {
	const { ctx, definitions } = makeContext([], {});
	registerCommands(ctx);
	assert.deepEqual(
		definitions.map((definition) => definition.name).sort(),
		["ponytail", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help", "ponytail-review"].sort(),
	);
	const main = definitions.find((definition) => definition.name === "ponytail");
	assert.equal(main.input.hint, "[lite|full|ultra|off]");
	for (const definition of definitions) assert.equal(typeof definition.handler, "function");
});

test("/ponytail <level> injects rendered skill content", async () => {
	const followups = [];
	const { ctx, definitions } = makeContext(followups, {});
	registerCommands(ctx);
	const handler = definitions.find((definition) => definition.name === "ponytail").handler;
	const result = await handler({ rawInput: "ultra", agent: agent(followups), signal: undefined });
	assert.equal(result.kind, "success");
	assert.equal(result.text, "Ponytail mode set to ultra.");
	assert.equal(followups.length, 1);
	const text = followups[0].content[0].text;
	assert.ok(text.includes("<skill_content"), "renders skill content");
	assert.ok(text.includes("Ponytail level: ultra"), "carries the level directive");
	assert.equal(followups[0].source.kind, "skill-invocation");
});

test("/ponytail off injects a revert notice and skips skill load", async () => {
	const followups = [];
	let loaded = false;
	const skills = {
		async get() {
			loaded = true;
			throw new Error("should not be called");
		},
	};
	const { ctx, definitions } = makeContext(followups, skills);
	registerCommands(ctx);
	const handler = definitions.find((definition) => definition.name === "ponytail").handler;
	const result = await handler({ rawInput: "off", agent: agent(followups), signal: undefined });
	assert.equal(result.kind, "success");
	assert.equal(loaded, false);
	assert.ok(followups[0].content[0].text.includes("revert to normal mode"));
});

test("/ponytail off records the session mode", async () => {
	const followups = [];
	const { ctx, definitions } = makeContext(followups, {});
	registerCommands(ctx);
	const handler = definitions.find((definition) => definition.name === "ponytail").handler;
	const ag = agent(followups);
	await handler({ rawInput: "off", agent: ag, signal: undefined });
	assert.equal(currentMode(ag, "full"), "off");
});

test("/ponytail rejects an invalid level", async () => {
	const { ctx, definitions } = makeContext([], {});
	registerCommands(ctx);
	const handler = definitions.find((definition) => definition.name === "ponytail").handler;
	const result = await handler({ rawInput: "extreme", agent: agent([]), signal: undefined });
	assert.equal(result.kind, "error");
	assert.match(result.text, /Usage/);
});

test("review-style commands inject the matching skill", async () => {
	const followups = [];
	const { ctx, definitions } = makeContext(followups, {});
	registerCommands(ctx);
	const handler = definitions.find((definition) => definition.name === "ponytail-review").handler;
	const result = await handler({ rawInput: "", agent: agent(followups), signal: undefined });
	assert.equal(result.kind, "success");
	assert.ok(followups[0].content[0].text.includes("<skill_content name=\"ponytail-review\">"));
});
