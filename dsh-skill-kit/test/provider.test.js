import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED_SKILL_RANK } from "@deepseek-ai/dsh-skill";
import { makeSkillProvider } from "../lib/provider.js";

const ctx = { logger: { warn() {} } };
const control = () => ({ signal: new AbortController().signal, invalidate() {} });

function fixtureSkills() {
	const dir = mkdtempSync(join(tmpdir(), "dsh-skill-kit-"));
	for (const [name, description] of [["alpha-skill", "first"], ["beta-skill", "second"]]) {
		const skillDir = join(dir, name);
		mkdirSync(skillDir);
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${description}\n---\nbody of ${name}\n`,
		);
	}
	return dir;
}

test("list returns candidates sorted by name", async () => {
	const dir = fixtureSkills();
	try {
		const Provider = makeSkillProvider({ name: "test", source: "test-plugin", skillsDir: dir });
		const provider = new Provider(ctx, control());
		const result = await provider.list({});
		assert.equal(result.complete, true);
		assert.deepEqual(result.candidates.map((c) => c.name), ["alpha-skill", "beta-skill"]);
		for (const candidate of result.candidates) {
			assert.equal(candidate.provider, "test");
			assert.equal(candidate.source, "test-plugin");
			assert.equal(candidate.rank, BUNDLED_SKILL_RANK);
			assert.ok(candidate.locator.path.endsWith("SKILL.md"));
			assert.equal(candidate.resourceBase.kind, "directory");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("get returns the full definition with content", async () => {
	const dir = fixtureSkills();
	try {
		const Provider = makeSkillProvider({ name: "test", source: "test-plugin", skillsDir: dir });
		const provider = new Provider(ctx, control());
		const { candidates } = await provider.list({});
		const candidate = candidates.find((c) => c.name === "alpha-skill");
		const skill = await provider.get(candidate, {});
		assert.equal(skill.name, "alpha-skill");
		assert.equal(skill.provider, "test");
		assert.equal(skill.source, "test-plugin");
		assert.equal(skill.content, "body of alpha-skill");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("get returns undefined for a vanished file", async () => {
	const Provider = makeSkillProvider({ name: "test", source: "test-plugin", skillsDir: "C:/definitely/missing" });
	const provider = new Provider(ctx, control());
	assert.equal(await provider.get({ locator: { path: "C:/definitely/missing/SKILL.md", directory: "C:/definitely/missing" } }, {}), undefined);
	assert.equal(await provider.get(undefined, {}), undefined);
});
