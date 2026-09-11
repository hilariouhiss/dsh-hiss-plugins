import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
const shipped = (relative) => new URL(`../${relative}`, import.meta.url);

/**
 * Harness packages the running installation supplies at runtime. Carrying our
 * own copy into a profile shadows the installation's collection with a
 * different generation: the plugin tree fails to link and the whole boot
 * aborts (see AGENTS.md §3.4).
 */
const HOST_PROVIDED = ["@deepseek-ai/dsh-skill", "@deepseek-ai/dsh-llm"];

test("harness packages are host-provided peers, never bundled dependencies", () => {
	const dependencies = Object.keys(manifest.dependencies ?? {});
	for (const name of HOST_PROVIDED) {
		assert.ok(
			!dependencies.includes(name),
			`${name} must not be a dependency: a profile-local copy shadows the installation's`,
		);
		assert.ok(manifest.peerDependencies?.[name], `${name} must be declared as a peerDependency`);
		assert.ok(manifest.devDependencies?.[name], `${name} must be a devDependency so this repo's own install resolves it`);
	}
});

test("peer ranges declare the compatible floor and devDependencies pin exact versions", () => {
	for (const name of HOST_PROVIDED) {
		assert.match(manifest.peerDependencies[name], /^\^\d+\.\d+\.\d+-rc\.\d+$/u, `${name} peer range`);
		assert.match(manifest.devDependencies[name], /^\d+\.\d+\.\d+-rc\.\d+$/u, `${name} pinned devDependency`);
	}
});

test("the bundle patch is declared, shipped, and names this package verbatim", () => {
	assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
	assert.ok(existsSync(shipped("cordis.patch.yml")), "the declared patch must exist");
	assert.ok(manifest.files.includes("cordis.patch.yml"), "files must ship the patch");
	const names = [...patch.matchAll(/^\s*name:\s*'?([^'\s]+)'?\s*$/gmu)].map((match) => match[1]);
	assert.deepEqual(names, [manifest.name], "the row name must equal package.json's name verbatim");
});

test("files ships the skills directory the provider reads", () => {
	for (const entry of ["lib/", "skills/", "README.md", "LICENSE"]) {
		assert.ok(manifest.files.includes(entry), `files must ship ${entry}`);
	}
	const vendored = readdirSync(shipped("skills"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.filter((entry) => existsSync(shipped(`skills/${entry.name}/SKILL.md`)));
	assert.equal(vendored.length, 14, `expected 14 vendored skills, found ${vendored.length}`);
});
