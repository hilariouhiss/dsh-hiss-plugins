import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply, resolveDefaultMode } from "../lib/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function makeContext(captures) {
	const ctx = {
		skills: {
			registerProvider(create) {
				captures.providers.push(create({ signal: new AbortController().signal, invalidate() {} }));
				return () => {};
			},
		},
		systemPrompt: {
			section(section) {
				captures.sections.push(section);
				return () => {};
			},
		},
		commands: {
			register(definition) {
				captures.commands.push(definition);
				return () => {};
			},
		},
	};
	return ctx;
}

function withEnv(mode, fn) {
	const previous = process.env.PONYTAIL_DEFAULT_MODE;
	if (mode === undefined) delete process.env.PONYTAIL_DEFAULT_MODE;
	else process.env.PONYTAIL_DEFAULT_MODE = mode;
	try {
		return fn();
	} finally {
		if (previous === undefined) delete process.env.PONYTAIL_DEFAULT_MODE;
		else process.env.PONYTAIL_DEFAULT_MODE = previous;
	}
}

test("resolveDefaultMode honors env over a config file", () => {
	const dir = mkdtempSync(join(tmpdir(), "dsh-ponytail-"));
	const config = join(dir, "config.json");
	try {
		writeFileSync(config, JSON.stringify({ defaultMode: "ultra" }));
		assert.equal(resolveDefaultMode({ PONYTAIL_DEFAULT_MODE: "off" }, config), "off");
		assert.equal(resolveDefaultMode({ PONYTAIL_DEFAULT_MODE: " LITE " }, config), "lite");
		// No env → config file wins.
		assert.equal(resolveDefaultMode({}, config), "ultra");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveDefaultMode falls back to full", () => {
	assert.equal(resolveDefaultMode({}, join(repoRoot, "does-not-exist.json")), "full");
	assert.equal(resolveDefaultMode({ PONYTAIL_DEFAULT_MODE: "bogus" }, join(repoRoot, "does-not-exist.json")), "full");
});

test("apply registers provider, adoption hint, and six commands", () => {
	withEnv("full", () => {
		const captures = { providers: [], sections: [], commands: [] };
		apply(makeContext(captures));
		assert.equal(captures.providers.length, 1);
		assert.equal(captures.sections.length, 1);
		assert.equal(captures.sections[0].name, "ponytail:adoption");
		assert.equal(captures.commands.length, 6);
	});
});

test("apply skips the adoption hint when the default mode is off", () => {
	withEnv("off", () => {
		const captures = { providers: [], sections: [], commands: [] };
		apply(makeContext(captures));
		assert.equal(captures.providers.length, 1);
		assert.equal(captures.sections.length, 0);
		assert.equal(captures.commands.length, 6);
	});
});
