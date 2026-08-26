import test from "node:test";
import assert from "node:assert/strict";
import { apply, buildArgs, normalizeResults, quoteArg, renderOutput, stripPathPrefix } from "../lib/index.js";

function makeContext(captures) {
	const ctx = {
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

test("buildArgs rejects an unknown command", () => {
	assert.throws(() => buildArgs({ command: "bogus" }), /command must be one of/);
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
