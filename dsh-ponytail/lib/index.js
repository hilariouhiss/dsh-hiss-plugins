import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSkillProvider } from "@hilariouhiss/dsh-skill-kit";
import { registerCommands, currentMode } from "./commands.js";

export const name = "ponytail";
export const inject = ["skills", "systemPrompt", "commands"];

const HINT_TEXT = [
	"Ponytail lazy-mode is available for coding work. Before any coding task — writing, editing, refactoring, fixing, reviewing, or choosing libraries/dependencies — load the `ponytail` skill with the `skill` tool (unless already loaded) and follow it: the simplest solution that works, reuse what already exists, standard library and platform features before new dependencies, fewest files, shortest working diff. Switch intensity with /ponytail lite|full|ultra; turn off with /ponytail off or by saying \"stop ponytail\".",
].join("");

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const PonytailSkillProvider = makeSkillProvider({
	name: "ponytail",
	source: "ponytail-plugin",
	skillsDir,
});

/**
 * DSH plugin entry point.
 *
 * Registered in the host plane (see cordis.patch.yml), so the skill provider
 * lands in the global `skills` layer — visible to every agent preset — while
 * the adoption hint and `/ponytail*` commands register globally.
 */
export function apply(ctx) {
	ctx.skills.registerProvider((control) => new PonytailSkillProvider(ctx, control));

	const defaultMode = resolveDefaultMode();
	ctx.systemPrompt.section({
		name: "ponytail:adoption",
		order: 5,
		text: (context) => currentMode(context.scope, defaultMode) === "off" ? "" : HINT_TEXT,
	});

	registerCommands(ctx);
}

/**
 * Resolve the upstream-compatible default mode: `PONYTAIL_DEFAULT_MODE`
 * environment variable first, then the config file
 * (`%APPDATA%\ponytail\config.json` on Windows, `~/.config/ponytail/config.json`
 * elsewhere), then `full`. `off` disables the system-prompt adoption hint.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [configPath]
 * @returns {"off" | "lite" | "full" | "ultra"}
 */
export function resolveDefaultMode(env = process.env, configPath = defaultConfigPath(env)) {
	const fromEnv = env.PONYTAIL_DEFAULT_MODE;
	if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
		const mode = normalizeMode(fromEnv);
		if (mode !== undefined) return mode;
	}
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8"));
		if (parsed !== null && typeof parsed === "object" && typeof parsed.defaultMode === "string") {
			const mode = normalizeMode(parsed.defaultMode);
			if (mode !== undefined) return mode;
		}
	} catch {
		// Missing or unreadable config: fall through to the default.
	}
	return "full";
}

function normalizeMode(value) {
	const mode = value.trim().toLowerCase();
	return mode === "off" || mode === "lite" || mode === "full" || mode === "ultra" ? mode : undefined;
}

function defaultConfigPath(env = process.env) {
	if (process.platform === "win32" && typeof env.APPDATA === "string" && env.APPDATA !== "") {
		return join(env.APPDATA, "ponytail", "config.json");
	}
	const xdg = typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME !== ""
		? env.XDG_CONFIG_HOME
		: join(homedir(), ".config");
	return join(xdg, "ponytail", "config.json");
}
