import test from "node:test";
import assert from "node:assert/strict";
import { PonytailSkillProvider } from "../lib/provider.js";

const ctx = { logger: { warn() {} } };
const control = () => ({ signal: new AbortController().signal, invalidate() {} });

test("list returns all six skills sorted by name", async () => {
	const provider = new PonytailSkillProvider(ctx, control());
	const result = await provider.list({});
	assert.equal(result.complete, true);
	const names = result.candidates.map((candidate) => candidate.name);
	assert.equal(names.length, 6);
	assert.deepEqual(names, [...names].sort());
	for (const candidate of result.candidates) {
		assert.equal(candidate.provider, "ponytail");
		assert.equal(candidate.source, "ponytail-plugin");
		assert.ok(Number.isFinite(candidate.rank));
		assert.ok(candidate.locator.path.endsWith("SKILL.md"));
		assert.equal(candidate.resourceBase.kind, "directory");
	}
});

test("get returns the full definition with content", async () => {
	const provider = new PonytailSkillProvider(ctx, control());
	const result = await provider.list({});
	const candidate = result.candidates.find((entry) => entry.name === "ponytail");
	const skill = await provider.get(candidate, {});
	assert.equal(skill.name, "ponytail");
	assert.equal(skill.provider, "ponytail");
	assert.equal(skill.source, "ponytail-plugin");
	assert.ok(skill.content.includes("lazy senior developer"));
	assert.ok(skill.content.includes("never written"));
});

test("get returns undefined for a vanished file", async () => {
	const provider = new PonytailSkillProvider(ctx, control());
	assert.equal(await provider.get({ locator: { path: "C:/definitely/missing/SKILL.md", directory: "C:/definitely/missing" } }, {}), undefined);
	assert.equal(await provider.get(undefined, {}), undefined);
});
