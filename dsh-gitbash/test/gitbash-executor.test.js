import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
	CONFINED_STARTUP_NOTE,
	MSYS_STARTUP_SIGNATURE,
	createGitBashExecutor,
	explainConfinedStartupFailure,
	withResolvedBash,
} from "../lib/gitbash-executor.js";

const BASH = join("C:", "Software", "Git", "bin", "bash.exe");
const POLICY = { mode: "workspace-write", workspaceRoot: join("C:", "Mine", "repo") };
/** The exact line Git Bash prints when a write-restricted token denies its startup. */
const MSYS_STDERR =
	"      0 [main] bash (16432) C:\\Software\\Git\\bin\\..\\usr\\bin\\bash.exe: *** fatal error - couldn't create signal pipe, Win32 error 5\n";
/** Mirrors the classifier's rule: lowercase substring match on non-zero exits. */
const matchesSignature = (exitCode, stderr, signatures) =>
	exitCode !== null && exitCode !== 0 && signatures.some((s) => stderr.toLowerCase().includes(s.toLowerCase()));

/** A fake context exposing only what the executor touches. */
function fakeContext() {
	const logs = [];
	return {
		logs,
		logger: { info: (line) => logs.push(line) },
		sandboxPolicy: { defaultMode: "workspace-write" },
		sandbox: { confine: (argv, policy) => ({ argv: ["runner", "--", ...argv], policy, enforcement: "partial", denialSignatures: ["access is denied"], runnerFailureRules: [] }) },
	};
}

/**
 * A stand-in for the sandbox-consuming base class. It mirrors the shape that matters:
 * full access runs the local executor unconfined with the literal `bash` argv, every
 * other mode confines first and runs the provider's argv.
 */
function fakeBase(runResult) {
	const clean = { exitCode: 0, stdout: { text: "" }, stderr: { text: "" } };
	return class FakeBase {
		static inject = ["subprocess", "sandbox", "sandboxPolicy"];
		constructor(ctx, config) {
			this.ctx = ctx;
			this.config = config;
			this.seenSpec = undefined;
			this.argv = undefined;
			this.result = runResult ?? clean;
		}
		async runArgv(spec, argv) {
			this.seenSpec = spec;
			this.argv = argv;
			return this.result;
		}
		startArgv(spec, argv) {
			this.seenSpec = spec;
			this.argv = argv;
			return { status: "running" };
		}
		async run(spec) {
			const { mode } = spec.sandboxPolicy;
			if (mode === "danger-full-access") return { ...(await this.runArgv(spec, ["bash", "-c", spec.command])), sandbox: { mode, denied: false } };
			const confined = this.confine(spec.command, { ...spec.sandboxPolicy, mode });
			return this.runArgv(spec, confined.argv);
		}
		start(spec) {
			const { mode } = spec.sandboxPolicy;
			if (mode === "danger-full-access") return this.startArgv(spec, ["bash", "-c", spec.command]);
			return this.startArgv(spec, this.confine(spec.command, { ...spec.sandboxPolicy, mode }).argv);
		}
	};
}

function build(runResult = undefined, options = {}) {
	const ctx = fakeContext();
	const Base = fakeBase(runResult);
	const Executor = createGitBashExecutor(Base, { resolveBash: () => BASH, platform: "win32", ...options });
	return { Executor, executor: new Executor(ctx, { timeoutMs: 1000 }), ctx };
}

test("the row resolves Git Bash and reports it at boot", () => {
	const { ctx, executor } = build();
	assert.equal(executor.bashPath, BASH);
	assert.deepEqual(
		ctx.logs.map((line) => line.includes(BASH)),
		[true],
	);
});

test("the base class's injection contract is preserved", () => {
	const { Executor } = build();
	assert.deepEqual(Executor.inject, ["subprocess", "sandbox", "sandboxPolicy"]);
});

test("a non-Windows platform refuses to construct the row", () => {
	const ctx = fakeContext();
	const Executor = createGitBashExecutor(fakeBase(), { resolveBash: () => BASH, platform: "linux" });
	assert.throws(() => new Executor(ctx, {}), /Windows-only/u);
});

test("confine runs the resolved bash.exe through the sandbox and keeps its facts", () => {
	const { executor, ctx } = build();
	const confined = executor.confine("echo hi", POLICY);
	assert.deepEqual(confined.argv, ["runner", "--", BASH, "-c", "echo hi"]);
	assert.equal(confined.enforcement, "partial");
	assert.deepEqual(confined.runnerFailureRules, []);
});

test("confine teaches the classifier MSYS2's startup failure", () => {
	const { executor } = build();
	const confined = executor.confine("echo hi", POLICY);
	assert.ok(confined.denialSignatures.includes("access is denied"), "the provider's own dialect survives");
	assert.ok(confined.denialSignatures.includes(MSYS_STARTUP_SIGNATURE));
	assert.equal(matchesSignature(3221225794, MSYS_STDERR, confined.denialSignatures), true);
});

test("confine tolerates a provider that reports no denial dialect", () => {
	const ctx = fakeContext();
	ctx.sandbox.confine = (argv) => ({ argv, enforcement: "full" });
	const Base = fakeBase();
	const Executor = createGitBashExecutor(Base, { resolveBash: () => BASH, platform: "win32" });
	assert.deepEqual(new Executor(ctx, {}).confine("x", POLICY).denialSignatures, [MSYS_STARTUP_SIGNATURE]);
});

test("a denied MSYS2 startup failure explains itself", () => {
	const result = {
		exitCode: 3221225794,
		signal: null,
		timedOut: false,
		aborted: false,
		timeoutMs: 1000,
		stdout: { text: "", truncated: false },
		stderr: { text: MSYS_STDERR, truncated: true, spillPath: "C:\\spill\\err.txt" },
		sandbox: { mode: "workspace-write", denied: true, enforcement: "partial" },
	};
	const explained = explainConfinedStartupFailure(result);
	assert.equal(explained.stderr.text, `${MSYS_STDERR}${CONFINED_STARTUP_NOTE}\n`);
	assert.equal(explained.stderr.truncated, true, "the subprocess facts survive");
	assert.equal(explained.stderr.spillPath, "C:\\spill\\err.txt");
	assert.equal(explained.stdout, result.stdout, "stdout is untouched");
	assert.equal(explained.sandbox, result.sandbox);
});

test("stderr without a trailing newline is not glued to the note", () => {
	const trimmed = MSYS_STDERR.trimEnd();
	assert.equal(
		explainConfinedStartupFailure({ sandbox: { denied: true }, stderr: { text: trimmed } }).stderr.text,
		`${trimmed}\n${CONFINED_STARTUP_NOTE}\n`,
	);
});

test("only a denied MSYS2 startup failure is annotated", () => {
	const cases = {
		"full access keeps its raw stderr": { sandbox: { mode: "danger-full-access", denied: false }, stderr: { text: MSYS_STDERR } },
		"an ordinary policy denial is left alone": { sandbox: { mode: "workspace-write", denied: true }, stderr: { text: "bash: /etc/x: Permission denied\n" } },
		"an unrelated failure is left alone": { sandbox: { mode: "workspace-write", denied: true }, stderr: { text: "ls: cannot access 'nope'\n" } },
		"a run with no sandbox facts is left alone": { exitCode: 2, stderr: { text: MSYS_STDERR } },
	};
	for (const [name, result] of Object.entries(cases)) {
		assert.equal(explainConfinedStartupFailure(result), result, name);
	}
});

test("run() annotates a denied startup failure exactly once", async () => {
	const result = { exitCode: 3221225794, stdout: { text: "" }, stderr: { text: MSYS_STDERR }, sandbox: { mode: "workspace-write", denied: true } };
	const { executor } = build(result);
	const settled = await executor.run({ command: "echo hi", sandboxPolicy: POLICY });
	assert.equal(settled.stderr.text, `${MSYS_STDERR}${CONFINED_STARTUP_NOTE}\n`);
	assert.equal(settled.stderr.text.split(CONFINED_STARTUP_NOTE).length - 1, 1);
});

test("run() passes a working result straight through", async () => {
	const result = { exitCode: 0, stdout: { text: "hi\n" }, stderr: { text: "" }, sandbox: { mode: "workspace-write", denied: false } };
	const { executor } = build(result);
	assert.equal(await executor.run({ command: "echo hi", sandboxPolicy: POLICY }), result);
});

test("full access runs the resolved bash.exe, never PATH's bash", async () => {
	const { executor } = build();
	await executor.run({ command: "echo hi", sandboxPolicy: { mode: "danger-full-access", workspaceRoot: POLICY.workspaceRoot } });
	assert.deepEqual(executor.argv, [BASH, "-c", "echo hi"]);
});

test("full access starts the resolved bash.exe too", () => {
	const { executor } = build();
	executor.start({ command: "echo hi", sandboxPolicy: { mode: "danger-full-access", workspaceRoot: POLICY.workspaceRoot } });
	assert.deepEqual(executor.argv, [BASH, "-c", "echo hi"]);
});

test("a confined run keeps the sandbox runner's own argv untouched", async () => {
	const { executor } = build();
	await executor.run({ command: "echo hi", sandboxPolicy: POLICY });
	assert.deepEqual(executor.argv, ["runner", "--", BASH, "-c", "echo hi"]);
});

test("withResolvedBash rewrites only the base's bare bash argv", () => {
	assert.deepEqual(withResolvedBash(["bash", "-c", "echo hi"], BASH), [BASH, "-c", "echo hi"]);
	const wrapped = ["runner", "--", "bash", "-c", "echo hi"];
	assert.equal(withResolvedBash(wrapped, BASH), wrapped, "a runner-wrapped argv is not ours to rewrite");
	const other = ["node", "-e", "1"];
	assert.equal(withResolvedBash(other, BASH), other);
	assert.equal(withResolvedBash(["bash", "-lc", "echo hi"], BASH).length, 3, "an unknown bash flag still runs PATH's bash");
});
