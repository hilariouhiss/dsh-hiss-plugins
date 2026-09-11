import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
const shipped = (relative) => new URL(`../${relative}`, import.meta.url);

/**
 * Harness packages the running installation supplies at runtime. Carrying our own copy
 * into a profile shadows the installation's collection with a different generation: the
 * plugin tree fails to link and the whole boot aborts (see AGENTS.md §3.4).
 */
const HOST_PROVIDED = ["@deepseek-ai/dsh-bash-sandbox", "@deepseek-ai/dsh-tool-bash"];

test("harness packages are host-provided peers, never bundled dependencies", () => {
	const dependencies = Object.keys(manifest.dependencies ?? {});
	for (const name of HOST_PROVIDED) {
		assert.ok(
			!dependencies.includes(name),
			`${name} must not be a dependency: a profile-local copy shadows the installation's`,
		);
		assert.ok(manifest.peerDependencies?.[name], `${name} must be declared as a peerDependency`);
	}
	assert.ok(
		manifest.devDependencies?.["@deepseek-ai/dsh-bash-sandbox"],
		"the peer this package imports must be a devDependency so this repo's own install resolves it",
	);
});

test("peer ranges declare the compatible floor and devDependencies pin exact versions", () => {
	for (const name of HOST_PROVIDED) {
		assert.match(manifest.peerDependencies[name], /^\^\d+\.\d+\.\d+-rc\.\d+$/u, `${name} peer range`);
	}
	assert.match(manifest.devDependencies["@deepseek-ai/dsh-bash-sandbox"], /^\d+\.\d+\.\d+-rc\.\d+$/u);
});

test("the bundle patch is declared and shipped", () => {
	assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
	assert.ok(existsSync(shipped("cordis.patch.yml")), "the declared patch must exist");
	assert.ok(manifest.files.includes("cordis.patch.yml"), "files must ship the patch");
	assert.ok(manifest.files.includes("lib/"), "files must ship lib/");
	assert.ok(manifest.files.includes("README.md"), "files must ship README.md");
	assert.ok(manifest.files.includes("LICENSE"), "files must ship LICENSE");
});

test("the executor subpath the patch mounts is exported and shipped", () => {
	assert.equal(manifest.exports?.["./executor"], "./lib/executor.js");
	assert.ok(existsSync(shipped("lib/executor.js")), "the exported subpath must exist");
	assert.ok(
		patch.includes(`'${manifest.name}/executor'`),
		"the patch must mount the executor through the exported subpath, not a file path",
	);
});

test("every row the patch mounts is a declared peer or this package", () => {
	const names = [...patch.matchAll(/^\s*name:\s*'?([^'\s]+)'?\s*$/gmu)].map((match) => match[1]);
	assert.equal(names.length, 3, `expected the group and its two rows, found ${names.join(", ")}`);
	for (const name of names) {
		if (name === "cordis:group" || name.startsWith(`${manifest.name}/`)) continue;
		assert.ok(manifest.peerDependencies?.[name], `patch row ${name} must be a declared peerDependency`);
	}
});

test("the group is Windows-only and keeps the host's shell and settings services intact", () => {
	assert.match(patch, /group:\s*true/u, "the container must be a group entry");
	assert.match(patch, /process\.platform !== 'win32'/u, "the group must gate itself to Windows");
	const isolate = patch.slice(patch.indexOf("isolate:"), patch.indexOf("config:"));
	assert.match(isolate, /shell:\s*true/u, "the group must own a private shell instance");
	assert.match(isolate, /settings:\s*true/u, "the group must not register the shared shell settings namespace");
});

test("the exported subpath wires the host's sandbox-consuming bash executor", async () => {
	const { SandboxBashExecutor } = await import("@deepseek-ai/dsh-bash-sandbox");
	const { default: GitBashExecutor } = await import("../lib/executor.js");
	assert.equal(typeof GitBashExecutor, "function", "the row entry must be a plugin class");
	assert.ok(GitBashExecutor.prototype instanceof SandboxBashExecutor, "it must extend the host's executor");
	assert.deepEqual(GitBashExecutor.inject, SandboxBashExecutor.inject, "the host executor's injection contract carries over");
	assert.ok(
		Object.hasOwn(GitBashExecutor.prototype, "confine"),
		"the resolved bash.exe must be substituted at the confinement boundary",
	);
});
