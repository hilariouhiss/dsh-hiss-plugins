import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenspecSkillProvider } from "../lib/provider.js";

const EXPECTED = [
	"openspec-apply-change",
	"openspec-archive-change",
	"openspec-bulk-archive-change",
	"openspec-continue-change",
	"openspec-explore",
	"openspec-ff-change",
	"openspec-new-change",
	"openspec-onboard",
	"openspec-propose",
	"openspec-sync-specs",
	"openspec-update-change",
	"openspec-verify-change",
];

function makeCtx() {
	return { logger: { warn() {} } };
}

function makeControl() {
	return { signal: { addEventListener() {} } };
}

test("lists all 12 openspec skills", async () => {
	const provider = new OpenspecSkillProvider(makeCtx(), makeControl());
	const { candidates, complete } = await provider.list();
	assert.equal(complete, true);
	assert.deepEqual(candidates.map((c) => c.name).sort(), EXPECTED.slice().sort());
});

test("get returns skill content for a candidate", async () => {
	const provider = new OpenspecSkillProvider(makeCtx(), makeControl());
	const { candidates } = await provider.list();
	const propose = candidates.find((c) => c.name === "openspec-propose");
	assert.ok(propose);
	const skill = await provider.get(propose);
	assert.equal(skill.name, "openspec-propose");
	assert.ok(skill.content.includes("openspec new change"));
});

test("get returns undefined for an unknown locator", async () => {
	const provider = new OpenspecSkillProvider(makeCtx(), makeControl());
	assert.equal(await provider.get({ locator: {} }), undefined);
});
