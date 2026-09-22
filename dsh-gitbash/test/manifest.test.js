import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
		assert.equal(
			manifest.peerDependencies[name],
			`^${manifest.devDependencies[name]}`,
			`${name} must declare the generation this package is built and tested against as its floor`,
		);
	}
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

/**
 * The executor seams are host API, and a prerelease harness renames them without notice:
 * 0.1.7 turned `run`/`start`/`runArgv`/`startArgv` into `execute`/`executeArgv` and made
 * `confine` asynchronous with a third `signal` argument. Overriding a name the host no
 * longer calls is silent at import time and surfaces only as the wrong shell at run time,
 * so this asserts the names against the generation installed here.
 */
test("the seams this plugin overrides still exist on the installed host executor", async () => {
	const { SandboxBashExecutor } = await import("@deepseek-ai/dsh-bash-sandbox");
	for (const seam of ["execute", "executeArgv", "confine"]) {
		assert.equal(typeof SandboxBashExecutor.prototype[seam], "function", `the host executor must still expose ${seam}()`);
	}
	assert.equal(SandboxBashExecutor.prototype.confine.length, 3, "confine() must still take (command, policy, signal)");
	const { default: GitBashExecutor } = await import("../lib/executor.js");
	for (const seam of ["execute", "executeArgv", "confine"]) {
		assert.ok(Object.hasOwn(GitBashExecutor.prototype, seam), `GitBashExecutor must override ${seam}()`);
	}
});

/** The `bash.exe` a Git for Windows install owns, as the resolver would return it. */
const GIT_BASH = join("C:", "Software", "Git", "bin", "bash.exe");

/**
 * Run one command through the *installed* executor with the subprocess seam faked.
 *
 * A seam can be lost without any rename: a host refactor that stops calling `executeArgv`,
 * or hands `confine` a different contract, leaves the override in place and the wrong shell
 * on the wire — which is exactly how 0.1.7 shipped a `bash` tool that ran WSL. Only the real
 * base class can show that, so everything below `ctx.subprocess` is faked and everything
 * above it is the host's own code.
 *
 * The instance is built from the prototype rather than the constructor because cordis's
 * `Service` base needs a live fiber; the executor seams under test do not.
 * @param {string} mode - the sandbox mode to run under.
 * @returns {Promise<{spawned: object[], result: object}>} the spawn the host built and the settled outcome.
 */
async function runThroughHost(mode) {
	const { SandboxBashExecutor } = await import("@deepseek-ai/dsh-bash-sandbox");
	const { createGitBashExecutor } = await import("../lib/gitbash-executor.js");
	const GitBashExecutor = createGitBashExecutor(SandboxBashExecutor, { resolveBash: () => GIT_BASH, platform: "win32" });

	const spawned = [];
	const reader = (text) => ({ readFrom: () => ({ text, lossy: false, nextOffset: text.length }) });
	const executor = Object.create(GitBashExecutor.prototype);
	Object.assign(executor, {
		bashPath: GIT_BASH,
		mode,
		processFacts: new Map(),
		ctx: {
			logger: { info() {}, warn() {} },
			subprocess: { spawn(spec) { spawned.push(spec); return { collected: { stdout: reader("ok\n"), stderr: reader("") }, done: Promise.resolve({ exitCode: 0, signal: null }), terminate() {} }; } },
			sandboxPolicy: { defaultMode: mode, resolve: () => ({ mode, workspaceRoot: "C:/tmp" }) },
			sandbox: { confine: async (argv, policy, signal) => ({ argv: ["runner", "--", ...argv], policy, signal, enforcement: "partial", denialSignatures: ["access is denied"], runnerFailureRules: [] }) },
		},
		config: {
			cwd: { get: () => "C:/tmp" },
			timeoutMs: { get: () => 5_000 },
			maxTimeoutMs: { get: () => 60_000 },
			maxOutputBytes: { get: () => 64 * 1024 },
			maxSpillBytes: { get: () => 1024 * 1024 },
			graceMs: { get: () => 3_000 },
		},
	});

	const handle = await executor.execute({
		command: "echo hi",
		workdir: "C:/tmp",
		timeoutMs: 5_000,
		onExpiry: "kill",
		stdoutMaxBytes: 64 * 1024,
		sandboxPolicy: { mode, workspaceRoot: "C:/tmp" },
	});
	return { spawned, result: await handle.result() };
}

test("full access runs Git Bash through the installed executor's own call flow", async () => {
	const { spawned, result } = await runThroughHost("danger-full-access");
	assert.equal(spawned.length, 1, "exactly one process is spawned");
	assert.deepEqual(spawned[0].argv, [GIT_BASH, "-c", "echo hi"], "PATH's bare `bash` must never reach the subprocess");
	assert.equal(result.exitCode, 0, "the settled outcome still comes back");
	assert.equal(result.sandbox.mode, "danger-full-access");
});

test("a confined run keeps the sandbox runner's argv around the resolved Git Bash", async () => {
	const { spawned, result } = await runThroughHost("workspace-write");
	assert.deepEqual(spawned[0].argv, ["runner", "--", GIT_BASH, "-c", "echo hi"]);
	assert.equal(result.sandbox.enforcement, "partial", "the provider's facts survive the override");
});
