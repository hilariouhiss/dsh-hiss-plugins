import { resolveGitBash } from "./resolve.js";

/**
 * Build the Git Bash shell executor.
 *
 * The Windows runner chain (`dsh-sandbox-local`'s `windows-acl` rung) confines commands
 * with a write-restricted token. MSYS2 — the runtime inside Git Bash — creates a named
 * object while starting up and asks for write access with the *user's* SID, which a
 * write-restricted token never grants: `bash.exe` dies at DLL init with
 * `couldn't create signal pipe, Win32 error 5`. No plugin can repair that, so this
 * executor does not pretend otherwise. It reuses DSH's own sandbox-consuming executor
 * and adds two things:
 *
 * 1. the exact `bash.exe` to run, instead of PATH's `bash` (which on Windows is the WSL
 *    launcher), and
 * 2. the MSYS2 startup failure as a sandbox-denial signature, so the framework's own
 *    denial marker and one-shot escalation path report it instead of a mystery crash.
 *
 * The result is that all three permission modes keep their exact meaning: full access
 * runs Git Bash directly, and read-only/workspace-write refuse it the way they refuse any
 * other write the policy does not allow — with the approval-gated escalation as the
 * exit.
 *
 * @module @hilariouhiss/dsh-gitbash/gitbash-executor
 */

/**
 * MSYS2's fatal startup line. The exit code alone is not a signature: `0xC0000142`
 * (`STATUS_DLL_INIT_FAILED`) is what every console-isolated or token-denied child
 * reports, so matching the text keeps unrelated crashes out of the denial surface.
 */
export const MSYS_STARTUP_SIGNATURE = "couldn't create signal pipe";

/**
 * Appended to a confined startup failure so the model and the operator read the cause
 * instead of a bare `[sandbox: file access denied]` next to an MSYS2 DLL-init line.
 */
export const CONFINED_STARTUP_NOTE =
	"dsh-gitbash: Git Bash cannot start inside the Windows file sandbox — MSYS2 needs a named object " +
	"that the sandbox's restricted token denies. This is expected in read-only/workspace-write: retry " +
	"with sandbox_permissions: danger-full-access, or run the session in danger-full-access.";

/**
 * Add the explanatory note to a settled run the sandbox denied for MSYS2's start-up
 * failure. Every other result — including full-access runs and ordinary policy denials —
 * passes through untouched, and the note is appended to stderr text only, leaving
 * `truncated` and spill paths as the subprocess service reported them.
 * @param {object} result - a settled {@link ShellRunResult}.
 * @returns {object} the same result, annotated when it is a confined MSYS2 startup failure.
 */
export function explainConfinedStartupFailure(result) {
	if (result.sandbox?.denied !== true) return result;
	if (!String(result.stderr?.text ?? "").includes(MSYS_STARTUP_SIGNATURE)) return result;
	const text = String(result.stderr.text);
	return {
		...result,
		stderr: { ...result.stderr, text: `${text.endsWith("\n") ? text : `${text}\n`}${CONFINED_STARTUP_NOTE}\n` },
	};
}

/**
 * Substitute the resolved Git Bash for the bare `bash` the base's unconfined path asks
 * for.
 *
 * `danger-full-access` is the one mode where MSYS2 can start at all, and the inherited
 * local executor builds that argv from the literal `bash` — which on Windows resolves to
 * the WSL launcher on PATH, a Linux VM with a different filesystem. The confined path
 * already carries the resolved path inside the sandbox runner's argv, so only the bare
 * three-entry `bash -c <command>` shape is rewritten and every other argv passes through.
 * @param {string[]} argv - the executable and arguments the base is about to spawn.
 * @param {string} bashPath - the resolved Git Bash executable.
 * @returns {string[]} the argv to spawn.
 */
export function withResolvedBash(argv, bashPath) {
	return argv.length === 3 && argv[0] === "bash" && argv[1] === "-c" ? [bashPath, ...argv.slice(1)] : argv;
}

/**
 * Create the executor class from a sandbox-consuming base class.
 *
 * The base is a parameter rather than a static import so this module stays free of host
 * dependencies: `executor.js` wires the real `SandboxBashExecutor`, and tests drive the
 * same behavior through a fake base.
 * @param {typeof import("@deepseek-ai/dsh-bash-sandbox").SandboxBashExecutor} Base - the sandbox-consuming bash executor to extend.
 * @param {object} [options] - construction inputs.
 * @param {() => string} [options.resolveBash] - Git Bash resolver, injected for tests.
 * @param {NodeJS.Platform} [options.platform] - platform the row runs on, injected for tests.
 * @returns {typeof Base} a Service plugin registering as `ctx.shell`.
 */
export function createGitBashExecutor(Base, { resolveBash = resolveGitBash, platform = process.platform } = {}) {
	return class GitBashExecutor extends Base {
		static inject = [...(Base.inject ?? [])];
		/** Absolute `bash.exe` every command runs as. */
		bashPath;
		constructor(ctx, config) {
			super(ctx, config);
			if (platform !== "win32") throw new Error("dsh-gitbash: this row is Windows-only; the git-bash group disables itself elsewhere");
			this.bashPath = resolveBash();
			ctx.logger.info(`dsh-gitbash: confined shell git bash = ${this.bashPath}`);
		}
		/**
		 * Wrap one command for the sandbox, replacing the inherited `bash` lookup with the
		 * resolved Git Bash path and teaching the shared classifier MSYS2's startup failure.
		 * Both {@link run} and {@link start} classify through this returned object, so the
		 * denial is reported identically for foreground and background calls.
		 * @param {string} command - shell source for the inner `bash -c`.
		 * @param {object} policy - resolved confined execution policy.
		 * @returns {object} the provider's exact argv and settlement-classification facts.
		 */
		confine(command, policy) {
			const confined = this.ctx.sandbox.confine([this.bashPath, "-c", command], policy);
			return {
				...confined,
				denialSignatures: [...(confined.denialSignatures ?? []), MSYS_STARTUP_SIGNATURE],
			};
		}
		async run(spec) {
			return explainConfinedStartupFailure(await super.run(spec));
		}
		/**
		 * Keep the spawned program the resolved Git Bash on both of the base's paths:
		 * {@link confine} supplies it for confined runs, and this argv seam covers the
		 * unconfined `danger-full-access` run, whose argv the base builds itself.
		 * @param {object} spec - the resolved spec being spawned.
		 * @param {string[]} argv - the argv the base chose.
		 * @returns {object|Promise<object>} the settled run.
		 */
		runArgv(spec, argv) {
			return super.runArgv(spec, withResolvedBash(argv, this.bashPath));
		}
		/**
		 * The background twin of {@link runArgv}.
		 * @param {object} spec - the resolved spec being spawned.
		 * @param {string[]} argv - the argv the base chose.
		 * @returns {object} the live process handle.
		 */
		startArgv(spec, argv) {
			return super.startArgv(spec, withResolvedBash(argv, this.bashPath));
		}
	};
}
