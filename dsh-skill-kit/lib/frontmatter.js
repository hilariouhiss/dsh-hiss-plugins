import { parse as parseYaml } from "yaml";

/** Public skill-name grammar, identical to `@deepseek-ai/dsh-skill`. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Return whether a string is a valid kebab-case skill name. */
export function isValidSkillName(name) {
	return typeof name === "string" && SKILL_NAME.test(name);
}

/**
 * Parse one SKILL.md document.
 *
 * Rules mirror `@deepseek-ai/dsh-skill-filesystem`: the first line must be
 * `---`, the YAML block ends at the next `---` line, `name` and `description`
 * are required non-empty strings, `whenToUse` is optional, and the invocation
 * policy defaults to fully invocable. Unknown frontmatter keys are tolerated.
 *
 * @param {string} raw - full text of a SKILL.md file.
 * @param {string} [sourcePath] - path used only in diagnostics.
 * @returns {{ ok: true, value: { name: string, description: string, whenToUse?: string, invocation: { modelInvocable: boolean, userInvocable: boolean }, content: string } } | { ok: false, reason: string }}
 */
export function parseFrontmatter(raw, sourcePath) {
	const firstLineEnd = raw.indexOf("\n");
	if (firstLineEnd < 0 || raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") {
		return { ok: false, reason: describe(sourcePath, "missing YAML frontmatter") };
	}
	const start = firstLineEnd + 1;
	const closing = findClosingFrontmatter(raw, start);
	if (closing === undefined) {
		return { ok: false, reason: describe(sourcePath, "unterminated YAML frontmatter") };
	}

	let data;
	try {
		data = parseYaml(raw.slice(start, closing.start));
	} catch {
		return { ok: false, reason: describe(sourcePath, "invalid YAML frontmatter") };
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return { ok: false, reason: describe(sourcePath, "invalid YAML frontmatter") };
	}

	const name = stringField(data, "name");
	const description = stringField(data, "description");
	if (name === undefined || description === undefined) {
		return { ok: false, reason: describe(sourcePath, "frontmatter requires name and description") };
	}
	if (!isValidSkillName(name)) {
		return { ok: false, reason: describe(sourcePath, `invalid skill name "${name}"`) };
	}

	let invocation;
	try {
		invocation = parseInvocation(data);
	} catch (error) {
		return { ok: false, reason: describe(sourcePath, String(error)) };
	}

	return {
		ok: true,
		value: {
			name,
			description,
			...optionalString(data, "whenToUse"),
			invocation,
			content: raw.slice(closing.bodyStart).trim(),
		},
	};
}

function describe(sourcePath, message) {
	return `${sourcePath ?? "<skill>"} ignored: ${message}`;
}

function findClosingFrontmatter(raw, start) {
	let lineStart = start;
	while (lineStart <= raw.length) {
		const nextNewline = raw.indexOf("\n", lineStart);
		const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
		if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
			return {
				start: lineStart,
				bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1,
			};
		}
		if (nextNewline < 0) return undefined;
		lineStart = nextNewline + 1;
	}
	return undefined;
}

function stringField(data, key) {
	const value = data[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalString(data, key) {
	const value = data[key];
	return typeof value === "string" && value.length > 0 ? { [key]: value } : {};
}

function parseInvocation(data) {
	return {
		modelInvocable: frontmatterBoolean(data, "disable-model-invocation") !== true,
		userInvocable: frontmatterBoolean(data, "user-invocable") !== false,
	};
}

function frontmatterBoolean(data, key) {
	if (!Object.hasOwn(data, key)) return undefined;
	const value = data[key];
	if (typeof value === "boolean") return value;
	if (value === 1 || value === "1") return true;
	if (value === 0 || value === "0") return false;
	if (typeof value === "string") {
		switch (value.toLowerCase()) {
			case "true":
			case "yes":
			case "on":
				return true;
			case "false":
			case "no":
			case "off":
				return false;
		}
	}
	throw new TypeError(`frontmatter field "${key}" must be a boolean`);
}
