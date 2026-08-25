import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSkillName, parseFrontmatter } from "../lib/frontmatter.js";

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const NAMES = ["ponytail", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help", "ponytail-review"];

test("isValidSkillName accepts the bundled names", () => {
	for (const name of NAMES) assert.equal(isValidSkillName(name), true);
	assert.equal(isValidSkillName("Ponytail"), false);
	assert.equal(isValidSkillName("ponytail review"), false);
	assert.equal(isValidSkillName(""), false);
	assert.equal(isValidSkillName(undefined), false);
});

test("every bundled SKILL.md parses with the expected name", () => {
	for (const name of NAMES) {
		const raw = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
		const result = parseFrontmatter(raw, name);
		assert.equal(result.ok, true, result.reason);
		assert.equal(result.value.name, name);
		assert.ok(result.value.description.length > 0, `${name} has a description`);
		assert.ok(result.value.content.length > 0, `${name} has a body`);
		assert.deepEqual(result.value.invocation, { modelInvocable: true, userInvocable: true });
	}
});

test("unknown frontmatter keys are tolerated", () => {
	const raw = [
		"---",
		"name: ponytail",
		'description: "test"',
		'argument-hint: "[lite|full|ultra]"',
		"license: MIT",
		"---",
		"body",
		"",
	].join("\n");
	const result = parseFrontmatter(raw);
	assert.equal(result.ok, true);
	assert.equal(result.value.name, "ponytail");
	assert.equal(result.value.content, "body");
});

test("missing frontmatter fails", () => {
	assert.equal(parseFrontmatter("no frontmatter here").ok, false);
	assert.equal(parseFrontmatter("---\nname: x\ndescription: y\nbody").ok, false, "unterminated");
});

test("invalid skill name fails", () => {
	const raw = "---\nname: Bad Name\ndescription: x\n---\nbody\n";
	const result = parseFrontmatter(raw);
	assert.equal(result.ok, false);
	assert.match(result.reason, /invalid skill name/);
});

test("name/description required", () => {
	assert.equal(parseFrontmatter("---\nname: x\n---\nbody\n").ok, false);
	assert.equal(parseFrontmatter("---\ndescription: x\n---\nbody\n").ok, false);
});
