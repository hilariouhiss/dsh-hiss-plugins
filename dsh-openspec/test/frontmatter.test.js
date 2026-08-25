import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, isValidSkillName } from "../lib/frontmatter.js";

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

function readSkill(name) {
	return readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
}

test("parses a real OpenSpec skill with extra frontmatter keys", () => {
	const raw = readSkill("openspec-propose");
	const result = parseFrontmatter(raw, "openspec-propose/SKILL.md");
	assert.equal(result.ok, true);
	assert.equal(result.value.name, "openspec-propose");
	assert.ok(result.value.description.length > 0);
	assert.ok(result.value.content.includes("openspec new change"));
	assert.equal(result.value.invocation.modelInvocable, true);
	assert.equal(result.value.invocation.userInvocable, true);
});

test("tolerates unknown frontmatter keys (allowed-tools, compatibility, metadata)", () => {
	// openspec-propose frontmatter carries `allowed-tools`, `license`,
	// `compatibility`, and a nested `metadata` block — none may break parsing.
	const raw = readSkill("openspec-propose");
	assert.match(raw, /^---\n/);
	assert.match(raw, /allowed-tools:/);
	assert.match(raw, /metadata:/);
	const result = parseFrontmatter(raw, "openspec-propose/SKILL.md");
	assert.equal(result.ok, true);
});

test("rejects a document without frontmatter", () => {
	const result = parseFrontmatter("no frontmatter here\n", "x/SKILL.md");
	assert.equal(result.ok, false);
	assert.match(result.reason, /missing YAML frontmatter/);
});

test("isValidSkillName accepts the 12 openspec skill names", () => {
	for (const name of ["openspec-propose", "openspec-apply-change", "openspec-sync-specs"]) {
		assert.equal(isValidSkillName(name), true);
	}
	assert.equal(isValidSkillName("not valid name"), false);
});
