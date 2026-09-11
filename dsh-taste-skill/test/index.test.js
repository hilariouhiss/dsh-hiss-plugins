import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { apply, inject } from "../lib/index.js";

/** Frontmatter `name` of every upstream skill, sorted. */
const EXPECTED_SKILLS = [
	"brandkit",
	"design-taste-frontend",
	"design-taste-frontend-v1",
	"full-output-enforcement",
	"gpt-taste",
	"high-end-visual-design",
	"image-to-code",
	"imagegen-frontend-mobile",
	"imagegen-frontend-web",
	"industrial-brutalist-ui",
	"minimalist-ui",
	"redesign-existing-projects",
	"stitch-design-taste",
].sort();

/**
 * The fake ctx carries only what the plugin may touch: reaching for any other
 * service throws here, which is the same failure a missing `inject` entry
 * produces at boot.
 */
function makeContext(captures) {
	return {
		skills: {
			registerProvider(create) {
				captures.providers.push(create({ signal: new AbortController().signal, invalidate() {} }));
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

function makeProvider() {
	const captures = { providers: [], warnings: [] };
	apply(makeContext(captures));
	assert.equal(captures.providers.length, 1, "apply must register exactly one provider");
	return { provider: captures.providers[0], captures };
}

test("apply registers one skill provider and injects only skills", () => {
	assert.deepEqual(inject, ["skills"]);
	const { provider, captures } = makeProvider();
	assert.equal(typeof provider.list, "function");
	assert.equal(typeof provider.get, "function");
	assert.deepEqual(captures.warnings, []);
});

test("the provider lists all 13 vendored skills, parsed without a warning", async () => {
	const { provider, captures } = makeProvider();
	const { candidates, complete } = await provider.list({});
	assert.equal(complete, true);
	assert.deepEqual(candidates.map((candidate) => candidate.name).sort(), EXPECTED_SKILLS);
	for (const candidate of candidates) {
		assert.ok(candidate.description.trim().length > 0, `${candidate.name} must keep its upstream description`);
		assert.equal(candidate.source, "taste-skill-plugin");
		assert.equal(candidate.provider, "taste-skill");
	}
	// A skipped or unparsable SKILL.md logs instead of failing, so silence is the
	// only proof that the whole vendored set still satisfies the frontmatter rules.
	assert.deepEqual(captures.warnings, []);
});

test("every candidate resolves to its own vendored SKILL.md body", async () => {
	const { provider } = makeProvider();
	const { candidates } = await provider.list({});
	for (const candidate of candidates) {
		const directory = candidate.resourceBase.path;
		assert.ok(existsSync(join(directory, "SKILL.md")), `${candidate.name} must resolve inside skills/`);
		const skill = await provider.get(candidate, {});
		assert.equal(skill.name, candidate.name);
		assert.ok(skill.content.trim().length > 0, `${candidate.name} must carry a body`);
	}
});
