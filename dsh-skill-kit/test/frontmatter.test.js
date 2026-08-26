import test from "node:test";
import assert from "node:assert/strict";
import { isValidSkillName, parseFrontmatter } from "../lib/frontmatter.js";

test("isValidSkillName accepts kebab-case names", () => {
	assert.equal(isValidSkillName("ponytail"), true);
	assert.equal(isValidSkillName("openspec-propose"), true);
	assert.equal(isValidSkillName("Ponytail"), false);
	assert.equal(isValidSkillName("ponytail review"), false);
	assert.equal(isValidSkillName(""), false);
	assert.equal(isValidSkillName(undefined), false);
});

test("parses name, description, whenToUse, invocation, and body", () => {
	const raw = [
		"---",
		"name: brainstorming",
		'description: "Use before creative work"',
		"whenToUse: before building anything",
		"---",
		"# Body",
		"",
	].join("\n");
	const result = parseFrontmatter(raw, "brainstorming");
	assert.equal(result.ok, true, result.reason);
	assert.equal(result.value.name, "brainstorming");
	assert.equal(result.value.whenToUse, "before building anything");
	assert.deepEqual(result.value.invocation, { modelInvocable: true, userInvocable: true });
	assert.equal(result.value.content, "# Body");
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
	const result = parseFrontmatter("---\nname: Bad Name\ndescription: x\n---\nbody\n");
	assert.equal(result.ok, false);
	assert.match(result.reason, /invalid skill name/);
});

test("name/description required", () => {
	assert.equal(parseFrontmatter("---\nname: x\n---\nbody\n").ok, false);
	assert.equal(parseFrontmatter("---\ndescription: x\n---\nbody\n").ok, false);
});

test("legacy invocation keys are rejected", () => {
	const result = parseFrontmatter("---\nname: x\ndescription: d\ndisableModelInvocation: true\n---\nbody\n", "x");
	assert.equal(result.ok, false);
	assert.match(result.reason, /disableModelInvocation.*disable-model-invocation/);
});

test("metadata frontmatter is surfaced", () => {
	const raw = ["---", "name: x", "description: d", "metadata:", "  author: me", "  version: \"1.0\"", "---", "body", ""].join("\n");
	const result = parseFrontmatter(raw);
	assert.equal(result.ok, true);
	assert.deepEqual(result.value.metadata, { author: "me", version: "1.0" });
});
