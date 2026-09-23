import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Whether a path exists, without caring why it does not.
 * @param {string} path - absolute path to test.
 * @returns {Promise<boolean>} true when the path is readable.
 */
async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Locate the `.mcp.json` governing a session directory: the file in `cwd`
 * itself, else the nearest ancestor's. The walk stops at the first directory
 * holding `.git` — the project root — so a session inside a repository never
 * inherits a parent repository's servers. A path with no `.git` anywhere walks
 * to the filesystem root.
 *
 * @param {string} cwd - the session's absolute working directory.
 * @returns {Promise<string | undefined>} absolute config path, or undefined.
 */
export async function findConfigPath(cwd) {
	let current = resolve(cwd);
	for (;;) {
		const candidate = join(current, ".mcp.json");
		if (await exists(candidate)) return candidate;
		if (await exists(join(current, ".git"))) return undefined;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/** `${VAR}` with an optional `:-default`, as Claude Code writes them. */
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Interpolate `${VAR}` / `${VAR:-default}` in a string. An unset variable with
 * no default becomes the empty string, matching shell defaults closely enough
 * that a missing token fails visibly at the server rather than silently
 * launching with a literal `${TOKEN}`.
 *
 * @param {string} value - raw string from the config file.
 * @returns {string} the interpolated string.
 */
export function expand(value) {
	return value.replace(VARIABLE, (_match, name, fallback) => process.env[name] ?? fallback ?? "");
}

/** Expand every string in a nested value; non-strings pass through. */
function expandDeep(value) {
	if (typeof value === "string") return expand(value);
	if (Array.isArray(value)) return value.map(expandDeep);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, expandDeep(entry)]));
	}
	return value;
}

/** True for a plain object, so arrays and null are rejected as records. */
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Every value a string, or undefined when the record is absent. */
function stringRecord(value, field, serverName) {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new Error(`"${serverName}": ${field} must be an object`);
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== "string") throw new Error(`"${serverName}": ${field}.${key} must be a string`);
	}
	return value;
}

/**
 * Turn one `mcpServers` entry into the config the host MCP client accepts.
 * Throws for anything the client could not use, so the caller can report the
 * server by name and carry on with its siblings.
 *
 * @param {string} serverName - the entry's key, which becomes the tool namespace.
 * @param {unknown} entry - the raw entry value.
 * @param {string} projectDir - directory holding `.mcp.json`, the stdio default cwd.
 * @returns {Record<string, unknown>} an unvalidated `dsh-mcp-client` config.
 */
function toSpec(serverName, entry, projectDir) {
	if (!isRecord(entry)) throw new Error(`"${serverName}": entry must be an object`);
	const type = entry.type ?? "stdio";
	if (type === "http") {
		if (typeof entry.url !== "string" || entry.url === "") throw new Error(`"${serverName}": url must be a non-empty string`);
		const headers = stringRecord(entry.headers, "headers", serverName);
		return {
			transport: "streamable-http",
			serverName,
			url: entry.url,
			...(headers === undefined ? {} : { headers }),
		};
	}
	if (type !== "stdio") throw new Error(`"${serverName}": unsupported transport "${String(type)}"`);
	if (typeof entry.command !== "string" || entry.command === "") {
		throw new Error(`"${serverName}": command must be a non-empty string`);
	}
	const args = entry.args ?? [];
	if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
		throw new Error(`"${serverName}": args must be an array of strings`);
	}
	const env = stringRecord(entry.env, "env", serverName);
	if (entry.cwd !== undefined && typeof entry.cwd !== "string") throw new Error(`"${serverName}": cwd must be a string`);
	return {
		transport: "stdio",
		serverName,
		command: entry.command,
		args,
		...(env === undefined ? {} : { env }),
		cwd: resolve(projectDir, entry.cwd ?? "."),
	};
}

/**
 * Read one `.mcp.json` and describe every server in it. The file is untrusted
 * project content, so a malformed entry is reported by name rather than
 * dropped: a silently missing tool is indistinguishable from a broken one.
 *
 * @param {string} configPath - absolute path to the `.mcp.json`.
 * @param {string} cwd - the session directory the config was found for.
 * @returns {Promise<{ servers: { serverName: string, spec: Record<string, unknown> }[], skipped: { serverName: string, reason: string }[] }>}
 *   the servers to mount, and the entries that could not be used.
 * @throws when the file is unreadable, is not JSON, or has a malformed `mcpServers`.
 */
export async function loadServers(configPath, cwd) {
	const raw = await readFile(configPath, "utf8");
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed)) throw new Error(`${configPath} must contain a JSON object`);
	const declared = parsed.mcpServers;
	if (declared === undefined) return { servers: [], skipped: [] };
	if (!isRecord(declared)) throw new Error(`${configPath}: mcpServers must be an object`);
	const projectDir = dirname(resolve(configPath));
	const servers = [];
	const skipped = [];
	for (const [serverName, entry] of Object.entries(declared)) {
		try {
			servers.push({ serverName, spec: toSpec(serverName, expandDeep(entry), projectDir) });
		} catch (error) {
			skipped.push({ serverName, reason: error instanceof Error ? error.message : String(error) });
		}
	}
	return { servers, skipped };
}
