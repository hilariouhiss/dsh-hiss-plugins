import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter } from "../lib/frontmatter.js";
import { SuperpowersSkillProvider } from "../lib/provider.js";

const mockCtx = { logger: { warn: () => {} } };
const mockControl = { signal: { addEventListener: () => {} } };

test("parses name and description from frontmatter", () => {
	const result = parseFrontmatter(
		"---\nname: brainstorming\ndescription: Use before creative work\n---\n\n# Body\n",
		"brainstorming",
	);
	assert.equal(result.ok, true);
	assert.equal(result.value.name, "brainstorming");
	assert.equal(result.value.description, "Use before creative work");
	assert.equal(result.value.content, "# Body");
});

test("rejects a file with no frontmatter", () => {
	assert.equal(parseFrontmatter("# no frontmatter", "x").ok, false);
});

test("provider lists every bundled skill (all 14 parse cleanly)", async () => {
	const provider = new SuperpowersSkillProvider(mockCtx, mockControl);
	const result = await provider.list({});
	assert.equal(result.complete, true);
	const names = result.candidates.map((candidate) => candidate.name);
	assert.equal(names.length, 14);
	assert.ok(names.includes("using-superpowers"));
	assert.ok(names.includes("brainstorming"));
	assert.ok(names.includes("test-driven-development"));
	assert.ok(names.includes("subagent-driven-development"));
});

test("provider loads a body with a directory resource base", async () => {
	const provider = new SuperpowersSkillProvider(mockCtx, mockControl);
	const { candidates } = await provider.list({});
	const using = candidates.find((candidate) => candidate.name === "using-superpowers");
	assert.ok(using);
	const definition = await provider.get(using, {});
	assert.ok(definition.content.includes("The Rule"));
	assert.equal(definition.resourceBase.kind, "directory");
});
