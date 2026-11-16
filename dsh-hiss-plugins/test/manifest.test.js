import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const shipped = (relative) => new URL(`../${relative}`, import.meta.url);

/**
 * Harness packages the running installation supplies at runtime. Carrying our own copy
 * into a profile shadows the installation's collection with a different generation: the
 * plugin tree fails to link and the whole boot aborts (see AGENTS.md §3.4). Every feature
 * that imports a host package imports one of these, so all six are the bundle's peers;
 * `lan-access` uses ctx services and the Node standard library only, so it adds none.
 */
const HOST_PROVIDED = [
	"@deepseek-ai/dsh-bash-sandbox",
	"@deepseek-ai/dsh-llm",
	"@deepseek-ai/dsh-mcp-client",
	"@deepseek-ai/dsh-skill",
	"@deepseek-ai/dsh-tool-bash",
	"@deepseek-ai/dsh-tools",
];

/** The runtime generation this bundle is built and tested against. */
const RUNTIME_GENERATION = "0.2.1-alpha.4";

/** The nine features, each exported as a subpath and mounted by the bundle patch. */
const FEATURES = ["colgrep", "codegraph", "project-mcp", "gitbash", "superpowers", "ponytail", "init", "fix", "lan-access"];

test("harness packages are host-provided peers, never bundled dependencies", () => {
	const dependencies = Object.keys(manifest.dependencies ?? {});
	assert.deepEqual(
		dependencies.filter((name) => name.startsWith("@deepseek-ai/")),
		[],
		"a bundled harness package shadows the installation's copy and aborts the whole boot",
	);
	for (const name of HOST_PROVIDED) {
		assert.ok(manifest.peerDependencies?.[name], `${name} must be declared as a peerDependency`);
		assert.ok(manifest.devDependencies?.[name], `${name} must be a devDependency so this repo's own install resolves it`);
	}
});

test("peer ranges declare the compatible floor and devDependencies pin the exact generation", () => {
	for (const name of HOST_PROVIDED) {
		assert.equal(
			manifest.peerDependencies[name],
			`^${RUNTIME_GENERATION}`,
			`${name} must declare the generation this bundle is built against as its floor`,
		);
		assert.equal(
			manifest.devDependencies[name],
			RUNTIME_GENERATION,
			`${name} must pin the exact version this repo installs and tests against`,
		);
	}
});

test("the bundle patch is declared and shipped", () => {
	// A mismatch here is silent: the profile loads a layer that names a package nothing
	// resolves, and the plugin simply never activates.
	assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
	assert.ok(existsSync(shipped("cordis.patch.yml")), "the declared patch must exist");
	for (const entry of ["lib/", "locale/", "cordis.patch.yml", "README.md", "LICENSE"]) {
		assert.ok(manifest.files.includes(entry), `files must ship ${entry}`);
	}
});

test("the browser half is declared for the web platform", () => {
	assert.equal(manifest.dsh?.client?.platform, "web");
	assert.equal(manifest.exports?.["./client"], "./lib/client.js", "the client module system serves the exported browser half");
});

test("every feature subpath is exported and resolves to an existing file", () => {
	assert.equal(manifest.exports?.["."], "./lib/index.js", "the carrier row must stay the package's main entry");
	assert.ok(existsSync(shipped("lib/index.js")), "the carrier row's module must exist");
	for (const feature of FEATURES) {
		const subpath = `./${feature}`;
		const target = manifest.exports?.[subpath];
		assert.equal(target, `./lib/${feature}/index.js`, `${subpath} must be exported`);
		assert.ok(existsSync(shipped(target)), `${subpath} must resolve to an existing file`);
	}
});
