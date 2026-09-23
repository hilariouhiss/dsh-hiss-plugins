import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");

/**
 * Harness packages the running installation supplies at runtime. Carrying our
 * own copy into a profile shadows the installation's collection with a
 * different generation: the plugin tree fails to link and the whole boot
 * aborts (see AGENTS.md §3.4).
 */
const HOST_PROVIDED = ["@deepseek-ai/dsh-mcp-client"];

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

test("the bundle patch selects this package under its published name", () => {
	// A mismatch here is silent: the profile loads a layer that names a package
	// nothing resolves, and the plugin simply never activates.
	assert.match(patch, new RegExp(`^\\s*name:\\s*'${manifest.name.replace("/", "\\/")}'\\s*$`, "m"));
	assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
	assert.ok(manifest.files.includes("cordis.patch.yml"), "the patch must ship in the tarball");
	assert.ok(manifest.files.includes("lib/"), "the runtime must ship in the tarball");
});
