import test from "node:test";
import assert from "node:assert/strict";
import { delimiter, join } from "node:path";
import {
	BASH_PATH_ENV,
	bashPathIn,
	defaultRoots,
	isGitRoot,
	resolveGitBash,
	rootsFromPath,
} from "../lib/resolve.js";

const GIT = join("C:", "Software", "Git");
const PROGRAM_FILES = join("C:", "Program Files");
const WSL_DIR = join("C:", "Windows", "System32");
const APPS_DIR = join("C:", "Users", "u", "AppData", "Local", "Microsoft", "WindowsApps");

/** File probe over an explicit path set: the resolver's only filesystem input. */
function probe(...paths) {
	const known = new Set(paths);
	return (path) => known.has(path);
}

/** The two files a standard Git for Windows install carries. */
function installOf(root) {
	return [bashPathIn(root), join(root, "cmd", "git.exe")];
}

/** A PATH value built with this platform's separator. */
function onPath(...dirs) {
	return dirs.join(delimiter);
}

test("an explicit DSH_GIT_BASH path wins over every discovery route", () => {
	const pinned = join("D:", "Portable", "bash.exe");
	const resolved = resolveGitBash({
		env: { [BASH_PATH_ENV]: pinned, GIT_ROOT: GIT, PATH: onPath(join(GIT, "cmd")), ProgramFiles: PROGRAM_FILES },
		exists: probe(pinned, ...installOf(GIT), ...installOf(join(PROGRAM_FILES, "Git"))),
	});
	assert.equal(resolved, pinned);
});

test("an explicit path that does not exist fails loud instead of falling back", () => {
	const missing = join("D:", "Nope", "bash.exe");
	assert.throws(
		() =>
			resolveGitBash({
				env: { [BASH_PATH_ENV]: missing, PATH: onPath(join(GIT, "cmd")) },
				exists: probe(...installOf(GIT)),
			}),
		(error) => {
			assert.match(error.message, /DSH_GIT_BASH/u);
			assert.ok(error.message.includes(missing));
			return true;
		},
	);
});

test("GIT_ROOT names the installation root, not bash.exe", () => {
	assert.equal(
		resolveGitBash({ env: { GIT_ROOT: GIT, PATH: "" }, exists: probe(...installOf(GIT)) }),
		bashPathIn(GIT),
	);
});

test("a GIT_ROOT without bin/bash.exe fails loud", () => {
	assert.throws(
		() => resolveGitBash({ env: { GIT_ROOT: join("D:", "Broken"), PATH: "" }, exists: probe() }),
		/GIT_ROOT does not hold bin\/bash\.exe/u,
	);
});

test("a Git cmd directory on PATH resolves the installation it belongs to", () => {
	assert.equal(
		resolveGitBash({ env: { PATH: onPath(join("C:", "Windows"), join(GIT, "cmd")) }, exists: probe(...installOf(GIT)) }),
		bashPathIn(GIT),
	);
});

test("WSL's System32 bash.exe is never accepted as Git Bash", () => {
	const env = { PATH: onPath(WSL_DIR, APPS_DIR) };
	const exists = probe(join(WSL_DIR, "bash.exe"), join(APPS_DIR, "bash.exe"));
	assert.throws(() => resolveGitBash({ env, exists }), /no Git for Windows installation found/u);
	assert.equal(rootsFromPath(env.PATH, exists).length, 0, "a bash.exe without git.exe yields no install root");
});

test("the standard install locations are probed when PATH carries no Git", () => {
	const root = join(PROGRAM_FILES, "Git");
	const env = { PATH: onPath(join("C:", "Windows")), ProgramFiles: PROGRAM_FILES };
	assert.equal(resolveGitBash({ env, exists: probe(...installOf(root)) }), bashPathIn(root));
});

test("a root carrying only usr/bin/bash.exe is still a Git installation", () => {
	const root = join(PROGRAM_FILES, "Git");
	assert.equal(
		resolveGitBash({
			env: { PATH: "", ProgramFiles: PROGRAM_FILES },
			exists: probe(bashPathIn(root), join(root, "usr", "bin", "bash.exe")),
		}),
		bashPathIn(root),
	);
});

test("no Git Bash anywhere names the fix in the error", () => {
	assert.throws(() => resolveGitBash({ env: { PATH: "" }, exists: probe() }), (error) => {
		assert.match(error.message, /no Git for Windows installation found/u);
		assert.match(error.message, /DSH_GIT_BASH/u);
		return true;
	});
});

test("isGitRoot requires bash.exe plus one Git marker", () => {
	const root = join("C:", "Git");
	assert.equal(isGitRoot(root, probe(bashPathIn(root), join(root, "cmd", "git.exe"))), true);
	assert.equal(isGitRoot(root, probe(bashPathIn(root), join(root, "usr", "bin", "bash.exe"))), true);
	assert.equal(isGitRoot(root, probe(bashPathIn(root))), false, "a bare bin/bash.exe proves nothing");
	assert.equal(isGitRoot(root, probe(join(root, "cmd", "git.exe"))), false, "git.exe alone proves nothing");
});

test("rootsFromPath keeps PATH order and only derives roots from git.exe", () => {
	const first = join("C:", "Tools", "Git");
	const second = join("C:", "Software", "Git");
	const dirs = [join(first, "cmd"), join("C:", "Windows"), second];
	assert.deepEqual(rootsFromPath(onPath(...dirs), probe(join(first, "cmd", "git.exe"), join(second, "git.exe"))), [
		first,
		second,
	]);
});

test("defaultRoots reads the install locations from the environment, in order", () => {
	assert.deepEqual(
		defaultRoots({ ProgramFiles: PROGRAM_FILES, "ProgramFiles(x86)": join("C:", "PF86"), LOCALAPPDATA: join("C:", "LA") }),
		[
			join(PROGRAM_FILES, "Git"),
			join("C:", "PF86", "Git"),
			join("C:", "LA", "Programs", "Git"),
		],
	);
	assert.deepEqual(defaultRoots({}), []);
});
