import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * Build a global-layer skill provider class that reads one `skills/` directory
 * of SKILL.md files. `skillsDir` must be an absolute path supplied by the
 * caller (derived from the plugin's own module URL, since `import.meta.url`
 * here points at the kit, not the plugin). `name` doubles as the provider id
 * and the log prefix; `source` tags each candidate.
 *
 * @param {{ name: string, source: string, skillsDir: string, rank?: number }} options
 */
export function makeSkillProvider({ name, source, skillsDir, rank = 350 }) {
	return class SkillProvider {
		name = name;
		#ctx;
		#skillsDir = skillsDir;

		constructor(ctx, control) {
			this.#ctx = ctx;
			// Nothing persistent to dispose: reads are stateless. Wire the signal
			// for symmetry with the provider contract and future caching.
			control.signal.addEventListener("abort", () => {}, { once: true });
		}

		/** @returns {Promise<{ candidates: object[], complete: boolean }>} */
		async list(options) {
			options?.signal?.throwIfAborted?.();
			let entries;
			try {
				entries = await readdir(this.#skillsDir, { withFileTypes: true });
			} catch (error) {
				if (isAbsent(error)) return { candidates: [], complete: true };
				this.#ctx.logger.warn(`${name}: failed to list skills: ${String(error)}`);
				return { candidates: [], complete: false };
			}
			const candidates = [];
			for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
				if (!entry.isDirectory()) continue;
				const directory = join(this.#skillsDir, entry.name);
				const path = join(directory, "SKILL.md");
				const skill = await this.#readSkill(path);
				if (skill === undefined) continue;
				candidates.push({
					name: skill.name,
					description: skill.description,
					...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
					invocation: skill.invocation,
					source,
					rank,
					provider: name,
					path,
					locator: { path, directory },
					resourceBase: { kind: "directory", path: directory },
				});
			}
			return { candidates, complete: true };
		}

		/** @returns {Promise<object | undefined>} */
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
				source,
				provider: name,
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
				this.#ctx.logger.warn(`${name}: failed to read ${path}: ${String(error)}`);
				return undefined;
			}
			const result = parseFrontmatter(raw, path);
			if (!result.ok) {
				this.#ctx.logger.warn(result.reason);
				return undefined;
			}
			return result.value;
		}
	};
}

function isAbsent(error) {
	return typeof error === "object" && error !== null
		&& (error.code === "ENOENT" || error.code === "ENOTDIR");
}
