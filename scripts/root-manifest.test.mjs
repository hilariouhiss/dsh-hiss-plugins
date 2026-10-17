import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const FEATURES = ["colgrep", "codegraph", "project-mcp", "gitbash", "superpowers", "ponytail"];

test("root manifest declares dsh.bundle pointing to cordis.patch.yml", () => {
	assert.ok(manifest.dsh?.bundle?.patch, "root package.json must declare dsh.bundle.patch");
	const patchPath = join(ROOT, manifest.dsh.bundle.patch);
	assert.ok(existsSync(patchPath), `patch file ${manifest.dsh.bundle.patch} must exist on disk`);
});

test("root manifest declares dsh.client for web platform", () => {
	assert.equal(manifest.dsh?.client?.platform, "web");
	assert.equal(manifest.exports?.["./client"], "./dsh-hiss-plugins/lib/client.js");
	assert.ok(existsSync(join(ROOT, manifest.exports["./client"])));
});

test("root manifest exports all feature subpaths", () => {
	assert.equal(manifest.exports?.["."], "./dsh-hiss-plugins/lib/index.js");
	assert.ok(existsSync(join(ROOT, manifest.exports["."])));

	for (const feature of FEATURES) {
		const subpath = `./${feature}`;
		const target = manifest.exports?.[subpath];
		assert.ok(target, `${subpath} must be exported in root manifest`);
		assert.ok(existsSync(join(ROOT, target)), `${subpath} target ${target} must exist on disk`);
	}
});
