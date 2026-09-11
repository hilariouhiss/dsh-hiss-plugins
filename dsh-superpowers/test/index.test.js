import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { apply, inject, name } from "../lib/index.js";

/** Frontmatter `name` of every vendored upstream skill, sorted. */
const EXPECTED_SKILLS = [
	"brainstorming",
	"dispatching-parallel-agents",
	"executing-plans",
	"finishing-a-development-branch",
	"receiving-code-review",
	"requesting-code-review",
	"subagent-driven-development",
	"systematic-debugging",
	"test-driven-development",
	"using-git-worktrees",
	"using-superpowers",
	"verification-before-completion",
	"writing-plans",
	"writing-skills",
].sort();

/**
 * The fake ctx carries only the two services the plugin declares: reaching for
 * any other one throws here, which is the failure a missing `inject` entry
 * produces at boot. The provider is instantiated the way the registry does it,
 * so the suite lists and reads the real vendored skills.
 */
function makeContext(captures) {
	return {
		skills: {
			registerProvider(create) {
				captures.providers.push(create({ signal: new AbortController().signal, invalidate() {} }));
				return () => {};
			},
		},
		systemPrompt: {
			section(section) {
				captures.sections.push(section);
				return () => {};
			},
		},
		logger: {
			warn(message) {
				captures.warnings.push(message);
			},
		},
	};
}

function makePlugin() {
	const captures = { providers: [], sections: [], warnings: [] };
	apply(makeContext(captures));
	return captures;
}

test("exports plugin identity and inject list", () => {
	assert.equal(name, "superpowers");
	assert.deepEqual(inject, ["skills", "systemPrompt"]);
});

test("apply registers provider and bootstrap section", () => {
	const captures = makePlugin();
	assert.equal(captures.providers.length, 1);
	assert.equal(captures.sections.length, 1);
	assert.equal(captures.sections[0].name, "superpowers:adoption");
	assert.ok(captures.sections[0].text.includes("<EXTREMELY_IMPORTANT>"));
	assert.ok(captures.sections[0].text.includes("check whether a superpowers skill applies"));
	assert.ok(!captures.sections[0].text.includes("<SUBAGENT-STOP>"), "no longer embeds the full using-superpowers body");
});

test("the provider lists all 14 vendored skills, parsed without a warning", async () => {
	const captures = makePlugin();
	const { candidates, complete } = await captures.providers[0].list({});
	assert.equal(complete, true);
	assert.deepEqual(candidates.map((candidate) => candidate.name).sort(), EXPECTED_SKILLS);
	for (const candidate of candidates) {
		assert.ok(candidate.description.trim().length > 0, `${candidate.name} must keep its upstream description`);
		assert.equal(candidate.source, "superpowers-plugin");
		assert.equal(candidate.provider, "superpowers");
	}
	// A skill whose frontmatter stops parsing is logged and skipped rather than
	// failing the boot, so silence here is what proves the whole set still parses.
	assert.deepEqual(captures.warnings, []);
});

test("every candidate resolves to its own vendored SKILL.md body", async () => {
	const captures = makePlugin();
	const provider = captures.providers[0];
	const { candidates } = await provider.list({});
	for (const candidate of candidates) {
		assert.ok(existsSync(join(candidate.resourceBase.path, "SKILL.md")), `${candidate.name} must resolve inside skills/`);
		const skill = await provider.get(candidate, {});
		assert.equal(skill.name, candidate.name);
		assert.ok(skill.content.trim().length > 0, `${candidate.name} must carry a body`);
	}
});

test("the relative resources the skills point at ship next to them", () => {
	// `resourceBase` is the skill directory, so these paths are resolved relative
	// to SKILL.md at runtime; a missing one is a dead reference inside a workflow.
	for (const relative of [
		"skills/using-superpowers/references/dsh-tools.md",
		"skills/subagent-driven-development/implementer-prompt.md",
		"skills/subagent-driven-development/scripts/task-brief",
		"skills/brainstorming/visual-companion.md",
		"skills/writing-skills/testing-skills-with-subagents.md",
	]) {
		assert.ok(existsSync(new URL(`../${relative}`, import.meta.url)), `${relative} must ship`);
	}
});
