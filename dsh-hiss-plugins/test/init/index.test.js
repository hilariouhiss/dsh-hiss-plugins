/**
 * The init row's contract: one argument-free `/init` command that injects the
 * prompt through `agent.followup` as non-user context, resolves the session
 * directory best-effort, and fails loudly when the followup seam is missing.
 *
 * @module dsh-hiss-plugins/test/init
 */
import test from "node:test";
import assert from "node:assert/strict";
import { apply, inject, name } from "../../lib/init/index.js";
import { buildInitPrompt } from "../../lib/init/prompt.js";

/**
 * A fake host context holding only the services the row declares.
 * @param options - `cwd` for the lookup answer and `ensureError` to make it fail.
 * @returns the fake context and its call record.
 */
function makeContext(options = {}) {
	const calls = { commands: [], ensured: [] };
	return {
		calls,
		ctx: {
			commands: {
				register(definition) {
					calls.commands.push(definition);
				},
			},
			workingDirectory: {
				async ensure(agent, signal) {
					calls.ensured.push({ agent, signal });
					if (options.ensureError !== undefined) throw options.ensureError;
					return options.cwd ?? "C:/ws";
				},
			},
		},
	};
}

/**
 * Register the row against a fake host.
 * @param options - the lookup script.
 * @returns the recorded calls, the command, the sent messages, and `run`.
 */
function setup(options = {}) {
	const { calls, ctx } = makeContext(options);
	apply(ctx);
	const definition = calls.commands[0];
	const sent = [];
	const agent = { followup(message) { sent.push(message); } };
	return {
		calls,
		definition,
		sent,
		agent,
		/**
		 * Run one command invocation.
		 * @param rawInput - the text following the command name.
		 * @param invocationAgent - the agent to invoke for; the shared fake by default.
		 * @returns the command result plus the invocation it saw.
		 */
		async run(rawInput = "", invocationAgent = agent) {
			const invocation = { agent: invocationAgent, rawInput, signal: new AbortController().signal };
			return { result: await definition.handler(invocation), invocation };
		},
	};
}

test("the row declares the two services it consumes", () => {
	assert.equal(name, "init");
	assert.deepEqual(inject, ["commands", "workingDirectory"]);
});

test("apply registers exactly one argument-free command", () => {
	const { calls, definition } = setup();
	assert.equal(calls.commands.length, 1);
	assert.equal(definition.name, "init");
	assert.match(definition.description, /AGENTS\.md/u);
	assert.equal(typeof definition.handler, "function");
	assert.deepEqual(Object.keys(definition).sort(), ["description", "handler", "name"], "no input hint or attachment flag is declared");
});

test("a bare invocation sends the prompt as collapsed context and succeeds", async () => {
	const { run, sent, agent, calls, definition } = setup();
	const { result, invocation } = await run("");
	assert.deepEqual(result, { kind: "success", text: "Reading this project and writing AGENTS.md." });
	assert.equal(typeof definition.handler, "function");
	assert.equal(calls.ensured.length, 1, "the workspace is resolved exactly once");
	assert.equal(calls.ensured[0].agent, agent);
	assert.equal(calls.ensured[0].signal, invocation.signal, "the invocation signal reaches the lookup");
	assert.equal(sent.length, 1, "one durable context message carries the instruction");
	const [message] = sent;
	assert.equal(message.role, "user");
	assert.deepEqual(message.source, { kind: "init", form: "notice", summary: "Generate or update AGENTS.md" });
	assert.notEqual(message.source.kind, "user", "the instruction must not render as the user's own bubble");
	assert.equal(typeof message.id, "string", "the message is constructed by the host helper");
	assert.equal(message.content.length, 1);
	assert.equal(message.content[0].type, "text");
	assert.equal(message.content[0].text, buildInitPrompt("C:/ws"));
});

test("extra input is refused with usage and injects nothing", async () => {
	const { run, sent, calls } = setup();
	const { result } = await run("  only-the-root ");
	assert.deepEqual(result, { kind: "error", text: "Usage: /init (no arguments)" });
	assert.equal(calls.ensured.length, 0, "the grammar rejects before any host call");
	assert.equal(sent.length, 0, "a refused invocation injects nothing");
});

test("a failed working-directory lookup still starts the run without a path", async () => {
	const { run, sent } = setup({ ensureError: new Error("workspace unavailable") });
	const { result } = await run("");
	assert.equal(result.kind, "success");
	assert.equal(sent.length, 1, "the command is not refused over a bookkeeping lookup");
	assert.equal(sent[0].content[0].text, buildInitPrompt(undefined));
});

test("a cancellation during the lookup is not swallowed", async () => {
	const { definition, sent, agent } = setup({ ensureError: new Error("command aborted") });
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		() => definition.handler({ agent, rawInput: "", signal: controller.signal }),
		/command aborted/u,
	);
	assert.equal(sent.length, 0, "a withdrawn command enqueues nothing");
});

test("the injection uses the agent's followup seam and nothing else", async () => {
	// §4's seam guard: the message must travel through `agent.followup` — the method
	// first-party `/goal` uses — so a renamed seam fails loudly instead of silently
	// dropping the prompt the command promises.
	const { run } = setup();
	await assert.rejects(() => run("", {}), (error) => {
		assert.equal(error.constructor, TypeError, "a missing seam fails loudly");
		assert.match(error.message, /followup/u, "the seam is the method the row calls by name");
		return true;
	});
});
