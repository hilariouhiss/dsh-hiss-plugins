import { existsSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";

/**
 * Locate the Git for Windows installation that owns `bash.exe`.
 *
 * A bare `bash` on PATH is not good enough on Windows: `C:\Windows\System32\bash.exe`
 * (the WSL launcher) and the `WindowsApps` alias sit on every PATH and would silently
 * hand the model a Linux VM instead of Git Bash, whose filesystem and `cwd` mapping
 * differ completely. So every discovery route below is validated against the Git for
 * Windows layout — `bin/bash.exe` next to `cmd/git.exe` — and an explicitly configured
 * path is the only route that skips the layout check.
 *
 * @module @hilariouhiss/dsh-gitbash/resolve
 */

/** Environment variable naming one exact `bash.exe`, for non-standard or portable installs. */
export const BASH_PATH_ENV = "DSH_GIT_BASH";

/** Environment variables naming a Git for Windows installation root. */
export const GIT_ROOT_ENVS = ["GIT_ROOT", "GIT_INSTALL_ROOT"];

/** The `bash.exe` a Git for Windows root owns. */
export function bashPathIn(root) {
	return join(root, "bin", "bash.exe");
}

/** Whether `root` carries the Git for Windows layout: `bin/bash.exe` plus `cmd/git.exe` or `usr/bin/bash.exe`. */
export function isGitRoot(root, exists = existsSync) {
	return (
		exists(bashPathIn(root)) &&
		(exists(join(root, "cmd", "git.exe")) || exists(join(root, "usr", "bin", "bash.exe")))
	);
}

/**
 * Installation roots implied by PATH, in PATH order. A directory holding `git.exe`
 * implies its parent (`<root>\cmd` in the standard install); a directory that is itself
 * a Git root is taken as is. Directories such as `System32` and `WindowsApps` hold a
 * `bash.exe` but no `git.exe`, so they never produce a candidate.
 * @param {string} pathValue - a raw PATH value.
 * @param {(path: string) => boolean} [exists] - file probe, injected for tests.
 * @returns {string[]} candidate roots, unresolved against the layout check.
 */
export function rootsFromPath(pathValue, exists = existsSync) {
	const roots = [];
	for (const entry of String(pathValue ?? "").split(delimiter)) {
		if (entry.length === 0) continue;
		if (exists(join(entry, "git.exe"))) roots.push(basename(entry).toLowerCase() === "cmd" ? dirname(entry) : entry);
	}
	return roots;
}

/** Roots a standard Windows install can use, in preference order. */
export function defaultRoots(env = process.env) {
	const roots = [];
	for (const name of ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"]) {
		const base = env[name];
		if (typeof base === "string" && base.length > 0) roots.push(join(base, "Git"));
	}
	if (typeof env.LOCALAPPDATA === "string" && env.LOCALAPPDATA.length > 0) {
		roots.push(join(env.LOCALAPPDATA, "Programs", "Git"));
	}
	return roots;
}

/**
 * Resolve the Git Bash executable to run.
 *
 * Precedence is explicit-before-discovered: a configured path that does not exist is an
 * error rather than a silent fallback, because falling back would run a different shell
 * than the one the operator pinned.
 * @param {object} [options] - resolution inputs.
 * @param {NodeJS.ProcessEnv} [options.env] - environment to read.
 * @param {(path: string) => boolean} [options.exists] - file probe, injected for tests.
 * @returns {string} absolute path of the `bash.exe` to execute.
 * @throws {Error} when no Git Bash is found, naming every route that was tried.
 */
export function resolveGitBash({ env = process.env, exists = existsSync } = {}) {
	const explicit = env[BASH_PATH_ENV];
	if (typeof explicit === "string" && explicit.length > 0) {
		if (!exists(explicit)) throw new Error(`dsh-gitbash: ${BASH_PATH_ENV} points at a missing file: ${explicit}`);
		return explicit;
	}
	for (const name of GIT_ROOT_ENVS) {
		const root = env[name];
		if (typeof root !== "string" || root.length === 0) continue;
		const candidate = bashPathIn(root);
		if (!exists(candidate)) throw new Error(`dsh-gitbash: ${name} does not hold bin/bash.exe: ${root}`);
		return candidate;
	}
	const roots = [...rootsFromPath(env.PATH, exists), ...defaultRoots(env)];
	for (const root of roots) if (isGitRoot(root, exists)) return bashPathIn(root);
	throw new Error(
		`dsh-gitbash: no Git for Windows installation found among ${roots.length} candidate root(s). ` +
			`Install Git for Windows, or set ${BASH_PATH_ENV} to the bash.exe to run.`,
	);
}
