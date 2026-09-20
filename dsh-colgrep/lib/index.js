import { resolve } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "colgrep";
export const inject = ["tools", "shell", "sandboxPolicy", "systemPrompt"];

const LONG_PATH_PREFIX = String.fromCharCode(92, 92, 63, 92); // "\\?\"

const TOOL_DESCRIPTION = `Semantic code search over the workspace using the local colgrep CLI (ColBERT multi-vector search). Finds code by meaning, not exact text. Use a natural-language \`query\` such as "error handling for database connections". Defaults to \`search\`; search auto-indexes, so the first run in a project builds the index and is slower. Use \`command:"status"\` to inspect the index, \`command:"init"\` to (re)build it explicitly, and \`no_update:true\` for a fast search over an existing index. Pass \`root\` to search a project other than the workspace, and \`path\` to narrow the search within it. Use \`pattern\` to pre-filter by regex, \`include\` to limit file types (e.g. "*.rs"), and \`code_only\` to skip text/config files.`;

const GUIDANCE = [
	"Semantic code search is available through the `colgrep` tool. ",
	"Reach for it when you want code by meaning and cannot name the exact identifier — grep is for text you can already spell out. ",
	"It auto-indexes on demand, so the first search in a project is slower; use `pattern` for a regex pre-filter that ranks semantically after. ",
	"Pass `root` to search a project other than the workspace. ",
].join("");

/**
 * Usage guidance carrying the current workspace, so the agent passes the right
 * default root.
 *
 * @param {string} cwd the session workspace path.
 * @returns {string} prompt text for the colgrep guidance section.
 */
export function guidanceFor(cwd) {
	return `${GUIDANCE} Current workspace: ${cwd}; the default root.`;
}

export function stripPathPrefix(path) {
	const value = String(path);
	return value.startsWith(LONG_PATH_PREFIX) ? value.slice(4) : value;
}

export function quoteArg(value) {
	return "'" + String(value).replace(/'/g, "''") + "'";
}

export function buildArgs(args) {
	const command = args.command || "search";
	const argv = ["colgrep"];
	if (command === "search") {
		if (typeof args.query !== "string" || args.query.trim() === "") {
			throw new Error("query must be a non-empty string");
		}
		argv.push("--json", "--color", "never", "-y");
		if (args.no_update) argv.push("--no-update");
		argv.push("-k", String(args.top_k ? Number(args.top_k) : 15));
		if (args.pattern) argv.push("-e", args.pattern);
		if (args.include) argv.push("--include", args.include);
		if (args.code_only) argv.push("--code-only");
		argv.push(String(args.query || ""));
		if (args.root) argv.push(String(args.root));
		if (args.path) argv.push(args.path);
	} else if (command === "init") {
		argv.push("init", "-y");
		if (args.root) argv.push(String(args.root));
		if (args.path) argv.push(args.path);
	} else if (command === "status") {
		argv.push("status");
	} else if (command === "clear") {
		argv.push("clear");
	} else {
		throw new Error("command must be one of: search, init, status, clear");
	}
	return argv;
}

export function normalizeResults(parsed) {
	return parsed.map((item) => {
		const unit = item && item.unit ? item.unit : {};
		return {
			file: stripPathPrefix(unit.file),
			name: unit.name || "",
			qualified_name: unit.qualified_name || "",
			line: unit.line,
			end_line: unit.end_line,
			language: unit.language || "",
			unit_type: unit.unit_type || "",
			signature: unit.signature || "",
			score: item ? item.score : null,
		};
	});
}

export function renderOutput(value) {
	if (!value || typeof value !== "object") return String(value);
	const lines = [];
	if (value.command === "search" && Array.isArray(value.results)) {
		lines.push(`colgrep: ${value.results.length} result(s) for ${JSON.stringify(value.query)}`);
		value.results.forEach((result, index) => {
			const file = result.file || result.qualified_name || "?";
			const location = typeof result.line === "number" && typeof result.end_line === "number"
				? `:${result.line}-${result.end_line}`
				: "";
			const meta = [result.language, result.unit_type, result.name].filter(Boolean).join(", ");
			const score = typeof result.score === "number" ? `score ${result.score.toFixed(2)}` : "";
			lines.push("");
			lines.push(`${index + 1}. ${file}${location}${meta ? `  [${meta}]` : ""}${score ? `  (${score})` : ""}`);
			if (result.signature) {
				lines.push(`   ${String(result.signature).split("\n")[0].slice(0, 200)}`);
			}
		});
	} else if (value.command === "search") {
		lines.push(value.ok ? "colgrep search returned unparseable output (ok=true)" : "colgrep search failed (ok=false)");
		if (value.stderr) lines.push(`[stderr]\n${value.stderr}`);
		else if (value.stdout) lines.push(`[stdout]\n${value.stdout}`);
	} else {
		lines.push(`colgrep ${value.command} (exit ${value.exitCode})`);
		if (value.stdout) lines.push(value.stdout);
		if (!value.ok && value.stderr) lines.push(`[stderr]\n${value.stderr}`);
	}
	if (value.timedOut) lines.push("[timed out]");
	if (value.aborted) lines.push("[aborted]");
	return lines.join("\n");
}

export function apply(ctx) {
	ctx.systemPrompt.section({
		name: "colgrep:guidance",
		order: 100,
		text: (context) => guidanceFor(context.scope?.session?.header?.cwd ?? process.cwd()),
	});

	ctx.tools.register(defineTool({
		name: "colgrep",
		description: TOOL_DESCRIPTION,
		parameters: {
			query: { type: "string", description: "Natural-language query (used by search).", required: true },
			command: { type: "string", enum: ["search", "init", "status", "clear"], description: "Operation. search (default) finds code; init builds/updates the index; status reports index state; clear removes the index." },
			root: { type: "string", description: "Project directory to search or index (default: the workspace root). Absolute or relative to the workspace." },
			path: { type: "string", description: "File or directory of `root` to search (default: the whole root). colgrep searches this target and falls back to the project index, so it is a focus, not a hard filter — narrow with `include` or `pattern` instead." },
			top_k: { type: "integer", description: "Number of results to return (-k). Default 15." },
			pattern: { type: "string", description: "Regex pre-filter (-e): grep first, then rank semantically (hybrid)." },
			include: { type: "string", description: "Only search files matching this glob (--include), e.g. \"*.rs\"." },
			code_only: { type: "boolean", description: "Only search code files; skip text/config files such as md/txt/yaml/json (--code-only)." },
			no_update: { type: "boolean", description: "Skip automatic index update and search the existing index as-is (--no-update)." },
		},
		output: {
			schema: { type: "json" },
			render(_args, value) {
				return [{ type: "text", text: renderOutput(value) }];
			},
		},
		async execute(args, exec) {
			const policy = ctx.sandboxPolicy.resolve({ session: exec.agent && exec.agent.session });
			const root = policy && typeof policy.workspaceRoot === "string" ? policy.workspaceRoot : "";
			const base = root.replace(/[\\/]+$/, "");
			const dataDir = base + "/.colgrep-data";
			// `root` moves the run, never the index: index data stays inside the
			// workspace so it remains under the sandbox policy and the same
			// registry serves every root.
			const workdir = args.root && base ? resolve(base, args.root) : base;
			const command = buildArgs(args).map((part, index) => (index === 0 ? part : quoteArg(part))).join(" ");
			const spec = ctx.shell.resolve({
				command,
				timeoutMs: 300000,
				stdoutMaxBytes: 2 * 1024 * 1024,
				signal: exec.signal,
				sandboxPolicy: policy,
				...(workdir ? { workdir, env: { COLGREP_DATA_DIR: dataDir } } : {}),
			});
			const run = await ctx.shell.run(spec);
			const stdout = run.stdout && run.stdout.text ? run.stdout.text : "";
			const stderr = run.stderr && run.stderr.text ? run.stderr.text : "";
			const commandName = args.command || "search";
			const common = {
				ok: run.exitCode === 0,
				command: commandName,
				exitCode: run.exitCode,
				...(run.timedOut ? { timedOut: true } : {}),
				...(run.aborted ? { aborted: true } : {}),
			};
			if (commandName !== "search") {
				return { ...common, stdout, stderr };
			}
			let parsed = null;
			try {
				parsed = JSON.parse(stdout);
			} catch {
				parsed = null;
			}
			let results = null;
			if (Array.isArray(parsed)) {
				results = normalizeResults(parsed);
			} else if (parsed && typeof parsed === "object" && Array.isArray(parsed.results)) {
				results = normalizeResults(parsed.results);
			}
			if (results === null) {
				return { ...common, query: args.query, results: null, stdout, stderr };
			}
			return { ...common, query: args.query, count: results.length, results };
		},
	}));
}
