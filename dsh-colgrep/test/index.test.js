import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { apply, buildArgs, guidanceFor, normalizeResults, quoteArg, renderOutput, stripPathPrefix } from "../lib/index.js";

function makeContext(captures) {
	const ctx = {
		systemPrompt: {
			section(section) {
				captures.sections.push(section);
				return () => {};
			},
		},
		tools: {
			register(definition) {
				captures.definition = definition;
				return () => {};
			},
		},
		shell: {
			resolve(request) {
				captures.request = request;
				return request;
			},
			async run() {
				return captures.runResult;
			},
		},
		sandboxPolicy: {
			resolve(request) {
				const session = request && request.session;
				const cwd = session && session.header && session.header.cwd;
				return { workspaceRoot: cwd || "C:/fallback" };
			},
		},
	};
	return ctx;
}

function mockExec(cwd = "C:/workspace") {
	return {
		signal: new AbortController().signal,
		agent: { session: { header: { cwd } } },
	};
}

test("buildArgs builds the default search argv", () => {
	assert.deepEqual(
		buildArgs({ query: "auth" }),
		["colgrep", "--json", "--color", "never", "-y", "-k", "15", "auth"],
	);
});

test("buildArgs maps search flags in order", () => {
	assert.deepEqual(
		buildArgs({ query: "auth", top_k: 5, pattern: "fn", include: "*.rs", code_only: true, no_update: true, path: "./src" }),
		["colgrep", "--json", "--color", "never", "-y", "--no-update", "-k", "5", "-e", "fn", "--include", "*.rs", "--code-only", "auth", "./src"],
	);
});

test("buildArgs builds init/status/clear", () => {
	assert.deepEqual(buildArgs({ command: "init" }), ["colgrep", "init", "-y"]);
	assert.deepEqual(buildArgs({ command: "status" }), ["colgrep", "status"]);
	assert.deepEqual(buildArgs({ command: "clear" }), ["colgrep", "clear"]);
});

test("buildArgs passes root as the CLI search path", () => {
	assert.deepEqual(
		buildArgs({ query: "auth", root: "C:/other" }),
		["colgrep", "--json", "--color", "never", "-y", "-k", "15", "auth", "C:/other"],
	);
});

test("buildArgs passes root to init", () => {
	assert.deepEqual(buildArgs({ command: "init", root: "C:/other" }), ["colgrep", "init", "-y", "C:/other"]);
});

test("buildArgs rejects an unknown command", () => {
	assert.throws(() => buildArgs({ command: "bogus" }), /command must be one of/);
});

test("buildArgs rejects an empty or blank query", () => {
	assert.throws(() => buildArgs({ query: "" }), /non-empty/);
	assert.throws(() => buildArgs({ query: "   " }), /non-empty/);
});

test("stripPathPrefix removes the Windows long-path prefix", () => {
	assert.equal(stripPathPrefix("\\\\?\\C:\\ws\\a.rs"), "C:\\ws\\a.rs");
	assert.equal(stripPathPrefix("C:\\ws\\a.rs"), "C:\\ws\\a.rs");
});

test("quoteArg single-quotes and escapes embedded quotes", () => {
	assert.equal(quoteArg("a b"), "'a b'");
	assert.equal(quoteArg("it's"), "'it''s'");
});

test("normalizeResults strips prefixes and trims to owned fields", () => {
	const [result] = normalizeResults([
		{ unit: { file: "\\\\?\\C:\\ws\\a.rs", name: "f", line: 1, end_line: 9, language: "rust", unit_type: "function", signature: "fn f()" }, score: 1.2 },
	]);
	assert.deepEqual(result, {
		file: "C:\\ws\\a.rs",
		name: "f",
		qualified_name: "",
		line: 1,
		end_line: 9,
		language: "rust",
		unit_type: "function",
		signature: "fn f()",
		score: 1.2,
	});
});

test("renderOutput formats search results", () => {
	const text = renderOutput({
		command: "search",
		query: "auth",
		count: 1,
		results: [{ file: "C:\\ws\\a.rs", name: "f", line: 1, end_line: 9, language: "rust", unit_type: "function", signature: "fn f()", score: 1.2 }],
	});
	assert.ok(text.includes('1 result(s) for "auth"'), "counts results");
	assert.ok(text.includes("C:\\ws\\a.rs:1-9"), "shows file and line range");
	assert.ok(text.includes("rust"), "shows language");
	assert.ok(text.includes("score 1.20"), "shows score");
	assert.ok(text.includes("fn f()"), "shows signature");
});

test("renderOutput formats a text command", () => {
	const text = renderOutput({ command: "status", exitCode: 0, stdout: "Project: ok", ok: true });
	assert.ok(text.includes("colgrep status (exit 0)"));
	assert.ok(text.includes("Project: ok"));
});

test("apply registers colgrep and execute shells out with a workspace-local index", async () => {
	const unitFile = "\\\\?\\C:\\workspace\\src\\main.rs";
	const captures = {
		sections: [],
		runResult: {
			exitCode: 0,
			timedOut: false,
			aborted: false,
			stdout: { text: JSON.stringify([{ unit: { file: unitFile, name: "main", line: 1, end_line: 5, language: "rust", unit_type: "function", signature: "fn main()" }, score: 2.1 }]) },
			stderr: { text: "" },
		},
	};
	apply(makeContext(captures));

	assert.ok(captures.definition, "registers a tool");
	assert.equal(captures.definition.name, "colgrep");

	const value = await captures.definition.execute({ query: "error handling" }, mockExec());

	assert.equal(captures.request.sandboxPolicy.workspaceRoot, "C:/workspace");
	assert.equal(captures.request.workdir, "C:/workspace");
	assert.equal(captures.request.env.COLGREP_DATA_DIR, "C:/workspace/.colgrep-data");
	assert.ok(captures.request.command.startsWith("colgrep"), "invokes colgrep");
	assert.equal(value.ok, true);
	assert.equal(value.count, 1);
	assert.equal(value.results[0].file, "C:\\workspace\\src\\main.rs");
	assert.equal(value.results[0].score, 2.1);
});

test("execute roots the run at the requested project but keeps the index in the workspace", async () => {
	const captures = { sections: [], runResult: { exitCode: 0, timedOut: false, aborted: false, stdout: { text: "[]" }, stderr: { text: "" } } };
	apply(makeContext(captures));

	await captures.definition.execute({ query: "auth", root: "C:/other-project" }, mockExec("C:/workspace"));

	assert.equal(captures.request.workdir, resolve("C:/other-project"));
	assert.equal(captures.request.env.COLGREP_DATA_DIR, "C:/workspace/.colgrep-data");
	assert.ok(captures.request.command.includes("'C:/other-project'"), "roots the CLI argv at the project");
});

test("execute resolves a relative root against the workspace", async () => {
	const captures = { sections: [], runResult: { exitCode: 0, timedOut: false, aborted: false, stdout: { text: "[]" }, stderr: { text: "" } } };
	apply(makeContext(captures));

	await captures.definition.execute({ query: "auth", root: "../other" }, mockExec("C:/workspace"));

	assert.equal(captures.request.workdir, resolve("C:/workspace", "../other"));
});

test("apply registers usage guidance carrying the current workspace", () => {
	const captures = { sections: [] };
	apply(makeContext(captures));

	assert.equal(captures.sections.length, 1);
	const [section] = captures.sections;
	assert.equal(section.name, "colgrep:guidance");
	assert.equal(typeof section.text, "function");
	const text = section.text({ scope: { session: { header: { cwd: "C:/project" } } } });
	assert.ok(text.includes("`colgrep` tool"), "names the colgrep tool");
	assert.ok(text.includes("meaning"), "tells the agent to search by meaning");
	assert.ok(text.includes("auto-indexes"), "says the index builds on demand");
	assert.ok(text.includes("root"), "documents the explicit root parameter");
	assert.ok(text.includes("C:/project"), "injects the current workspace path");
	assert.ok(guidanceFor("C:/project").includes("C:/project"), "guidanceFor carries the workspace");
});

test("execute still passes path through when rooted at another project", async () => {
	const captures = { sections: [], runResult: { exitCode: 0, timedOut: false, aborted: false, stdout: { text: "[]" }, stderr: { text: "" } } };
	apply(makeContext(captures));

	await captures.definition.execute({ query: "auth", root: "C:/other-project", path: "./src" }, mockExec("C:/workspace"));

	assert.equal(captures.request.workdir, resolve("C:/other-project"), "path resolves against the root, which is the run workdir");
	assert.ok(captures.request.command.includes(quoteArg("./src")), "passes path through to the CLI");
});

test("execute accepts object-shaped JSON results", async () => {
	const unitFile = "\\\\?\\C:\\workspace\\src\\lib.rs";
	const captures = {
		sections: [],
		runResult: {
			exitCode: 0,
			timedOut: false,
			aborted: false,
			stdout: { text: JSON.stringify({ results: [{ unit: { file: unitFile, name: "lib", line: 2, end_line: 3, language: "rust", unit_type: "function", signature: "fn lib()" }, score: 0.5 }] }) },
			stderr: { text: "" },
		},
	};
	apply(makeContext(captures));

	const value = await captures.definition.execute({ query: "thing" }, mockExec());

	assert.equal(value.ok, true);
	assert.equal(value.count, 1);
	assert.equal(value.results[0].file, "C:\\workspace\\src\\lib.rs");
});
