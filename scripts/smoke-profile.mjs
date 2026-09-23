#!/usr/bin/env node
/**
 * Opt-in smoke check: install these plugins into a throwaway profile the way a
 * user's `dsh plugin --profile <p> add <pkg>` does, then boot the real `dsh`
 * against it, then open one real session in a project that declares an MCP
 * server.
 *
 * This is the only check that catches the failure class the unit suites cannot
 * see: the profile's own `node_modules` shadowing the installation's harness
 * packages with a different generation. `dsh --dump-config` is not enough — it
 * composes the tree without importing a single module. The session step covers
 * the other blind spot: behaviour that lives in the harness rather than in this
 * repo, such as `dsh-project-mcp` mounting the MCP bridge into `agent.ctx` from
 * an `agent/created` listener, which a fake context could only assume.
 *
 * Not part of `pnpm test`: it needs the network, pnpm, and a `dsh` on PATH, and
 * it spawns subprocesses with piped stdio (blocked inside a confined DSH
 * sandbox). Run it from a normal shell:
 *
 *     node scripts/smoke-profile.mjs
 *
 * @module dsh-hiss-plugins/scripts/smoke-profile
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Installed as profile dependencies; everything else arrives transitively. */
const PLUGINS = ["dsh-ponytail", "dsh-colgrep", "dsh-codegraph", "dsh-project-mcp", "dsh-gitbash", "dsh-taste-skill", "dsh-superpowers"];
/** The library the skill plugins depend on, satisfied from a local tarball instead of the registry. */
const LIBRARY = "dsh-skill-kit";
/** Every packed package, library first. */
const PACKAGES = [LIBRARY, ...PLUGINS];
const PROFILE = "smoke";
const BOOT_TIMEOUT_MS = 120_000;
const SESSION_TIMEOUT_MS = 90_000;

const failures = [];
const step = (message) => process.stdout.write(`\n== ${message}\n`);
const ok = (condition, message) => {
	process.stdout.write(`   ${condition ? "ok" : "!! FAIL"}: ${message}\n`);
	if (!condition) failures.push(message);
};

/**
 * Quote one argument for the platform shell. `pnpm` and `dsh` are `.cmd` shims
 * on Windows and shell scripts elsewhere, so both need a shell; a temp path
 * containing a space must survive the round trip.
 * @param {string} value - raw argument.
 * @returns the argument quoted for `cmd.exe` or POSIX `sh`.
 */
function quoteArg(value) {
	const text = String(value);
	if (process.platform === "win32") return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
	return `'${text.replace(/'/g, `'\\''`)}'`;
}

function run(command, args, options = {}) {
	// The command itself stays unquoted: `cmd /s` strips the OUTER quotes of the
	// whole line, so a quoted leading command would corrupt the line.
	const line = [command, ...args.map(quoteArg)].join(" ");
	const result = spawnSync(line, {
		encoding: "utf8",
		shell: true,
		maxBuffer: 64 * 1024 * 1024,
		...options,
	});
	return { ...result, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * A stand-in stdio MCP server, written into the scratch directory and spawned
 * by the real harness through the project's `.mcp.json`. It records every
 * request method it serves, so the check can tell "the host spawned it" apart
 * from "the host negotiated, discovered tools, and would show them to the
 * model". Env, not argv, carries the record path — that also proves the config
 * file's `env` block survives scrubbing.
 */
const FAKE_MCP_SERVER = `import { appendFileSync } from "node:fs";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\\n")) >= 0) {
		const line = buffer.slice(0, index).trim();
		buffer = buffer.slice(index + 1);
		if (line === "") continue;
		const message = JSON.parse(line);
		if (message.id === undefined) continue;
		appendFileSync(process.env.PROJECT_MCP_MARKER, JSON.stringify({ method: message.method }) + "\\n");
		if (message.method === "initialize") {
			send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "smoke", version: "1.0.0" } } });
		} else if (message.method === "tools/list") {
			send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "ping", description: "ping", inputSchema: { type: "object" } }] } });
		} else {
			send({ jsonrpc: "2.0", id: message.id, result: {} });
		}
	}
});
`;

/**
 * Every request method the fake server has recorded so far. The file grows as
 * the harness negotiates, so callers poll it rather than reading it once.
 * @param {string} marker - the record path.
 * @returns {string[]} method names, oldest first.
 */
function recordedMethods(marker) {
	if (!existsSync(marker)) return [];
	return readFileSync(marker, "utf8")
		.split(/\r?\n/)
		.filter((line) => line.trim() !== "")
		.flatMap((line) => {
			try {
				return [JSON.parse(line).method];
			} catch {
				// A partially flushed line is not evidence of anything yet.
				return [];
			}
		});
}

/**
 * Terminate the session's whole process tree. `shell: true` means the child we
 * spawned is the shell rather than `dsh`, so killing it alone would leave the
 * harness and its MCP servers holding the scratch directory.
 * @param {import("node:child_process").ChildProcess} child - the spawned session.
 */
async function stopSession(child) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise((resolve) => child.once("exit", resolve));
	if (process.platform === "win32") run("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
	else child.kill("SIGKILL");
	await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
}

/**
 * Boot the throwaway profile once more and open one ACP session in `project`,
 * waiting until the fake MCP server has both handshaken and been asked for its
 * tools — the point at which the session's agent really has them.
 * @param {{ home: string, project: string, marker: string }} options - scratch home, session cwd, and the server's record path.
 * @returns {Promise<{ output: string }>} everything the child printed, for diagnostics.
 */
async function openSession({ home, project, marker }) {
	const child = spawn("dsh", ["--profile", PROFILE], {
		cwd: project,
		env: { ...process.env, DSH_HOME: home },
		stdio: ["pipe", "pipe", "pipe"],
		shell: true,
	});
	let output = "";
	const frame = (id, method, params) => JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
	child.stdout.on("data", (chunk) => {
		output += chunk;
		for (const line of String(chunk).split(/\r?\n/)) {
			if (line.trim() === "") continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			// The session only opens after initialize settles; the server must
			// not be started before the agent exists.
			if (message.id === 1) child.stdin.write(frame(2, "session/new", { cwd: project, mcpServers: [] }));
		}
	});
	child.stderr.on("data", (chunk) => {
		output += chunk;
	});
	child.stdin.write(frame(1, "initialize", { protocolVersion: 1, clientCapabilities: {} }));
	const deadline = Date.now() + SESSION_TIMEOUT_MS;
	while (Date.now() < deadline && !recordedMethods(marker).includes("tools/list")) {
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	await stopSession(child);
	return { output };
}

const work = mkdtempSync(join(tmpdir(), "dsh-smoke-"));
const tarballs = join(work, "tarballs");
const home = join(work, "home");
const profileDir = join(home, "profiles", PROFILE);
mkdirSync(tarballs, { recursive: true });
mkdirSync(profileDir, { recursive: true });

try {
	step(`packing ${PACKAGES.length} packages`);
	/** @type {Map<string, string>} package name -> packed tarball path. */
	const tarballOf = new Map();
	for (const pkg of PACKAGES) {
		const dir = join(ROOT, pkg);
		const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		const packed = run("pnpm", ["pack", "--pack-destination", tarballs], { cwd: dir });
		if (packed.status !== 0) {
			ok(false, `pnpm pack ${pkg} failed:\n${packed.output}`);
			throw new Error("pack failed");
		}
		// pnpm names a scoped tarball `<scope>-<name>-<version>.tgz` with the scope's `@` dropped.
		const file = join(tarballs, `${manifest.name.slice(1).replace("/", "-")}-${manifest.version}.tgz`);
		ok(existsSync(file), `packed ${manifest.name}@${manifest.version}`);
		tarballOf.set(manifest.name, file);
	}
	const libraryTarball = tarballOf.get(`@hilariouhiss/${LIBRARY}`);

	step(`installing into a throwaway profile ${profileDir}`);
	writeFileSync(
		join(profileDir, "pnpm-workspace.yaml"),
		[
			"packages:",
			"  - .",
			"",
			"nodeLinker: hoisted",
			"autoInstallPeers: false",
			"",
			"overrides:",
			`  '@hilariouhiss/${LIBRARY}': ${JSON.stringify(`file:${libraryTarball}`)}`,
			"",
		].join("\n"),
	);
	const bundled = PLUGINS.map((pkg) => `@hilariouhiss/${pkg}`);
	writeFileSync(
		join(profileDir, "package.json"),
		JSON.stringify(
			{
				name: `dsh-profile-${PROFILE}`,
				private: true,
				dependencies: Object.fromEntries(bundled.map((name) => [name, `file:${tarballOf.get(name)}`])),
				dsh: {
					profile: {
						bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-acp-app", ...bundled],
						patchReload: "startup",
					},
				},
			},
			undefined,
			2,
		) + "\n",
	);
	const installed = run("pnpm", ["install", "--ignore-scripts"], { cwd: profileDir });
	ok(installed.status === 0, "pnpm install succeeded");
	if (installed.status !== 0) process.stdout.write(installed.output);

	// The whole point: the profile must not carry its own harness packages.
	const shadowed = join(profileDir, "node_modules", "@deepseek-ai");
	ok(!existsSync(shadowed), "the profile carries no @deepseek-ai packages of its own");
	if (existsSync(shadowed)) {
		process.stdout.write(
			`   shadowing copies: ${readdirSync(shadowed).join(", ")}\n` +
				"   a profile-local harness package shadows the installation's and breaks the plugin tree\n",
		);
	}

	step("booting the real dsh against it");
	const boot = run("dsh", ["--profile", PROFILE], {
		cwd: profileDir,
		env: { ...process.env, DSH_HOME: home },
		timeout: BOOT_TIMEOUT_MS,
		input: "",
	});
	const loaderFailures = boot.output
		.split(/\r?\n/)
		.filter((line) => /failed to import loader entry|plugin tree failed to load/.test(line));
	ok(boot.status === 0, `dsh boot exited 0 (got ${boot.status})`);
	ok(loaderFailures.length === 0, "no loader entry failed to import");
	for (const line of loaderFailures) process.stdout.write(`     ${line.trim()}\n`);
	if (boot.status !== 0 && loaderFailures.length === 0) {
		process.stdout.write(boot.output.split(/\r?\n/).slice(0, 25).map((l) => `     ${l}`).join("\n") + "\n");
	}

	step("opening a real session in a project that declares an MCP server");
	// The real-seam check for `dsh-project-mcp`, and the reason a boot alone is
	// not enough: its whole job is mounting the host MCP bridge into `agent.ctx`
	// from an `agent/created` listener, and a fake context in a unit test would
	// only encode this script's assumption about the harness. So drive the real
	// thing — an ACP `session/new` in a project whose `.mcp.json` points at a
	// stand-in stdio server that records the methods it is asked for. No model
	// call is involved: creating the agent is the seam under test.
	// Drop this step together with the plugin.
	const project = join(work, "project");
	const marker = join(work, "mcp-server-methods.txt");
	const serverScript = join(work, "fake-mcp-server.mjs");
	mkdirSync(project, { recursive: true });
	writeFileSync(join(project, ".git"), "");
	writeFileSync(serverScript, FAKE_MCP_SERVER);
	writeFileSync(
		join(project, ".mcp.json"),
		JSON.stringify(
			{ mcpServers: { smoke: { command: process.execPath, args: [serverScript], env: { PROJECT_MCP_MARKER: marker } } } },
			undefined,
			2,
		) + "\n",
	);
	const session = await openSession({ home, project, marker });
	const methods = recordedMethods(marker);
	ok(methods.includes("initialize"), "the session started the project's .mcp.json server");
	ok(methods.includes("tools/list"), "the session's agent discovered that server's tools");
	if (!methods.includes("tools/list")) {
		process.stdout.write(`     methods seen: ${methods.join(", ") || "none"}\n`);
		process.stdout.write(session.output.split(/\r?\n/).slice(-20).map((l) => `     ${l}\n`).join(""));
	}

	step("SUMMARY");
	process.stdout.write(
		failures.length === 0 ? "   all checks passed\n" : `   ${failures.length} FAILURE(S)\n${failures.map((f) => `   - ${f}`).join("\n")}\n`,
	);
	process.exitCode = failures.length === 0 ? 0 : 1;
} catch (error) {
	process.stdout.write(`\n   aborted: ${String(error)}\n`);
	process.exitCode = 1;
} finally {
	if (failures.length === 0 && process.env.DSH_SMOKE_KEEP !== "1") {
		try {
			rmSync(work, { recursive: true, force: true });
		} catch (error) {
			// A lingering handle is not a check result: say where the scratch is
			// and keep the verdict the checks already produced.
			process.stdout.write(`   could not remove ${work}: ${String(error)}\n`);
		}
	} else process.stdout.write(`   scratch profile kept at ${profileDir}\n`);
}
