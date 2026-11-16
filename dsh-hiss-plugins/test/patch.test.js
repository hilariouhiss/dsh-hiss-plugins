import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");

/** Comment and blank lines carry the rationale for the shape, never the shape itself. */
const structural = patch
	.split("\n")
	.map((text, index) => ({ text, number: index + 1 }))
	.filter(({ text }) => text.trim() !== "" && !text.trimStart().startsWith("#"));

/** One `- id:` entry; its indentation says whether it is a row or a nested child. */
const ROW = /^(?<indent> *)- id: *(?<id>\S+)\s*$/u;

/** Parse the patch into rows: each entry plus every structural line that follows it. */
function parseRows() {
	const rows = [];
	for (const { text, number } of structural) {
		const match = ROW.exec(text);
		if (match) rows.push({ id: match.groups.id, indent: match.groups.indent.length, line: number, body: [text] });
		else if (rows.length > 0) rows.at(-1).body.push(text);
	}
	return rows;
}

const rows = parseRows();
const gitbash = rows.find((row) => row.id === "dsh-hiss-plugins-gitbash");

/** The lines nested under a row's `isolate:` key. */
function isolateOf(row) {
	const start = row.body.findIndex((line) => /^\s*isolate:\s*$/u.test(line));
	if (start === -1) return [];
	const indent = row.body[start].search(/\S/u);
	return row.body.slice(start + 1).filter((line) => line.search(/\S/u) > indent);
}

test("the patch inserts exactly ten top-level rows", () => {
	assert.equal((patch.match(/^- insert:\s*$/gmu) ?? []).length, 1, "the patch is a single insert layer");
	assert.equal(rows.length, 10, `expected ten rows, found: ${rows.map((row) => row.id).join(", ")}`);
	assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, "row ids must be unique");
	for (const row of rows) {
		assert.equal(row.indent, 4, `row ${row.id} (line ${row.line}) must be a top-level row, not a child of another row`);
	}
});

test("no row is a cordis:group", () => {
	// The guard against nesting the features again: the plugin manager cannot address the
	// children of a group, so a nested row can never be switched from the Plugins page.
	assert.ok(
		!/cordis:group/u.test(structural.map(({ text }) => text).join("\n")),
		"the bundle must mount the features as rows, never as children of a group",
	);
	for (const row of rows) {
		assert.ok(!row.body.some((line) => /name:\s*['"]?cordis:group/u.test(line)), `row ${row.id} must not be a group`);
	}
});

test("the carrier row and the nine feature rows name this package", () => {
	const names = new Map(
		rows.map((row) => [row.id, /name:\s*['"]?([^'"\s]+)['"]?\s*$/mu.exec(row.body.join("\n"))?.[1]]),
	);
	assert.equal(names.get("dsh-hiss-plugins"), manifest.name, "the carrier row bears the package's own name");
	for (const feature of ["colgrep", "codegraph", "project-mcp", "gitbash", "superpowers", "ponytail", "init", "fix", "lan-access"]) {
		assert.equal(
			names.get(`dsh-hiss-plugins-${feature}`),
			`${manifest.name}/${feature}`,
			`the ${feature} row must mount the package's exported subpath`,
		);
	}
});

test("the lan-access row stays off until the user enables it", () => {
	const lan = rows.find((row) => row.id === "dsh-hiss-plugins-lan-access");
	assert.ok(lan, "the patch must insert the lan-access row");
	assert.ok(
		lan.body.some((line) => /^\s*disabled:\s*true\s*$/u.test(line)),
		"putting a listener on the user's network is the user's decision, never a default",
	);
});

test("the git-bash row carries its own realm isolation", () => {
	assert.ok(gitbash, "the patch must insert the git-bash row");
	assert.match(
		gitbash.body.join("\n"),
		/disabled:\s*!!js\s+process\.platform\s*!==\s*'win32'/u,
		"the row must gate itself to Windows",
	);
	const isolate = isolateOf(gitbash);
	assert.ok(isolate.some((line) => /^\s*shell:\s*true\s*$/u.test(line)), "the row must own a private shell instance");
	assert.ok(
		isolate.some((line) => /^\s*settings:\s*true\s*$/u.test(line)),
		"the row must not register the shared shell settings namespace",
	);
});
