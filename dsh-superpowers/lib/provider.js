import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./frontmatter.js";

export const PROVIDER_NAME = "superpowers";
const SOURCE = "superpowers-plugin";
/**
 * Precedence rank inside the global `skills` layer. Above the built-in
 * `skill-filesystem` custom dirs (300) and below the user roots (400), so a
 * user who drops their own `brainstorming` (etc.) into `~/.dsh/skills` still
 * wins over the bundled copy.
 */
const RANK = 350;

/** Absolute path to the bundled skills directory, derived from this module. */
const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

/**
 * Global-layer skill provider that exposes the bundled superpowers skills.
 *
 * Registered from an unscoped host context, so its candidates join the global
 * layer of `ctx.skills` and are visible to every agent preset. Discovery is a
 * plain directory read of the plugin's own `skills/` tree; bodies load on
 * demand. `resourceBase` points at each skill's directory so its relative
 * references (`implementer-prompt.md`, `references/*.md`, `scripts/*`,
 * `examples/*`) resolve through the read tool.
 */
export class SuperpowersSkillProvider {
	name = PROVIDER_NAME;
	#ctx;

	constructor(ctx, control) {
		this.#ctx = ctx;
		control.signal.addEventListener("abort", () => {}, { once: true });
	}

	async list(options) {
		options?.signal?.throwIfAborted?.();
		let entries;
		try {
			entries = await readdir(skillsDir, { withFileTypes: true });
		} catch (error) {
			if (isAbsent(error)) return { candidates: [], complete: true };
			this.#ctx.logger.warn(`superpowers: failed to list skills: ${String(error)}`);
			return { candidates: [], complete: false };
		}
		const candidates = [];
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (!entry.isDirectory()) continue;
			const directory = join(skillsDir, entry.name);
			const path = join(directory, "SKILL.md");
			const skill = await this.#readSkill(path);
			if (skill === undefined) continue;
			candidates.push({
				name: skill.name,
				description: skill.description,
				...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
				invocation: skill.invocation,
				source: SOURCE,
				rank: RANK,
				provider: PROVIDER_NAME,
				path,
				locator: { path, directory },
				resourceBase: { kind: "directory", path: directory },
			});
		}
		return { candidates, complete: true };
	}

	async get(candidate, options) {
		options?.signal?.throwIfAborted?.();
		const locator = candidate?.locator;
		if (locator?.path === undefined) return undefined;
		const skill = await this.#readSkill(locator.path);
		if (skill === undefined) return undefined;
		return {
			name: skill.name,
			description: skill.description,
			...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
			invocation: skill.invocation,
			source: SOURCE,
			provider: PROVIDER_NAME,
			path: locator.path,
			resourceBase: { kind: "directory", path: locator.directory },
			content: skill.content,
		};
	}

	async #readSkill(path) {
		let raw;
		try {
			raw = await readFile(path, "utf8");
		} catch (error) {
			if (isAbsent(error)) return undefined;
			this.#ctx.logger.warn(`superpowers: failed to read ${path}: ${String(error)}`);
			return undefined;
		}
		const result = parseFrontmatter(raw, path);
		if (!result.ok) {
			this.#ctx.logger.warn(result.reason);
			return undefined;
		}
		return result.value;
	}
}

function isAbsent(error) {
	return typeof error === "object" && error !== null
		&& (error.code === "ENOENT" || error.code === "ENOTDIR");
}
