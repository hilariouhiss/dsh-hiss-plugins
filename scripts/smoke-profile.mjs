#!/usr/bin/env node
/**
 * Opt-in smoke check: install these plugins into a throwaway profile the way a
 * user's `dsh plugin --profile <p> add <pkg>` does, then boot the real `dsh`
 * against it.
 *
 * This is the only check that catches the failure class the unit suites cannot
 * see: the profile's own `node_modules` shadowing the installation's harness
 * packages with a different generation. `dsh --dump-config` is not enough — it
 * composes the tree without importing a single module.
 *
 * Not part of `pnpm test`: it needs the network, pnpm, and a `dsh` on PATH, and
 * it spawns subprocesses with piped stdio (blocked inside a confined DSH
 * sandbox). Run it from a normal shell:
 *
 *     node scripts/smoke-profile.mjs
 *
 * @module dsh-hiss-plugins/scripts/smoke-profile
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Installed as profile dependencies; everything else arrives transitively. */
const PLUGINS = ["dsh-ponytail", "dsh-colgrep", "dsh-codegraph", "dsh-gitbash"];
/** The library ponytail depends on, satisfied from a local tarball instead of the registry. */
const LIBRARY = "dsh-skill-kit";
/** Every packed package, library first. */
const PACKAGES = [LIBRARY, ...PLUGINS];
const PROFILE = "smoke";
const BOOT_TIMEOUT_MS = 120_000;

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

	step("SUMMARY");
	process.stdout.write(
		failures.length === 0 ? "   all checks passed\n" : `   ${failures.length} FAILURE(S)\n${failures.map((f) => `   - ${f}`).join("\n")}\n`,
	);
	process.exitCode = failures.length === 0 ? 0 : 1;
} catch (error) {
	process.stdout.write(`\n   aborted: ${String(error)}\n`);
	process.exitCode = 1;
} finally {
	if (failures.length === 0 && process.env.DSH_SMOKE_KEEP !== "1") rmSync(work, { recursive: true, force: true });
	else process.stdout.write(`   scratch profile kept at ${profileDir}\n`);
}
