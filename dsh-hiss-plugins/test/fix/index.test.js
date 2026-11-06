/**
 * The fix row's contract: one `/fix` command with an optional symptom, the
 * diagnosis prompt delivered through `agent.followup`, a non-user source so Chat
 * collapses it, and a loud failure when the followup seam is missing.
 *
 * @module dsh-hiss-plugins/test/fix
 */
import test from "node:test";
import assert from "node:assert/strict";
import { apply, inject, name } from "../../lib/fix/index.js";
import { buildFixPrompt } from "../../lib/fix/prompt.js";

/**
 * Register the row against a fake host.
 * @returns the recorded commands, the command, the sent messages, and `run`.
 */
function setup() {
	const calls = { commands: [] };
	const ctx = {
		commands: {
			register(definition) {
				calls.commands.push(definition);
			},
		},
	};
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
		 * @returns the command result.
		 */
		run(rawInput = "", invocationAgent = agent) {
			return definition.handler({ agent: invocationAgent, rawInput, signal: new AbortController().signal });
		},
	};
}

test("the row declares only the commands service", () => {
	assert.equal(name, "fix");
	assert.deepEqual(inject, ["commands"]);
});

test("apply registers exactly one command with an optional symptom", () => {
	const { calls, definition } = setup();
	assert.equal(calls.commands.length, 1);
	assert.equal(definition.name, "fix");
	assert.match(definition.description, /root cause/u);
	assert.deepEqual(definition.input, { hint: "[<symptom>]" });
	assert.equal(typeof definition.handler, "function");
});

test("a bare invocation sends the diagnosis prompt and succeeds", () => {
	const { run, sent } = setup();
	const result = run();
	assert.deepEqual(result, {
		kind: "success",
		text: "Investigating the root cause. I'll report before changing anything; confirm the fix after the report.",
	});
	assert.equal(sent.length, 1, "one durable message carries the instruction");
	const [message] = sent;
	assert.equal(message.role, "user");
	assert.deepEqual(message.source, { kind: "fix", form: "notice", summary: "Diagnose the root cause before fixing" });
	assert.notEqual(message.source.kind, "user", "the instruction must not render as the user's own bubble");
	assert.equal(message.content.length, 1);
	assert.equal(message.content[0].type, "text");
	assert.equal(message.content[0].text, buildFixPrompt(""));
});

test("a symptom is trimmed and passed into the prompt", () => {
	const { run, sent } = setup();
	run("  checkout fails after token refresh  ");
	assert.equal(sent.length, 1);
	assert.equal(sent[0].content[0].text, buildFixPrompt("checkout fails after token refresh"));
	assert.match(sent[0].content[0].text, /checkout fails after token refresh/u);
});

test("a missing followup seam fails loudly", () => {
	const { definition } = setup();
	assert.throws(() => definition.handler({ agent: {}, rawInput: "", signal: new AbortController().signal }), (error) => {
		assert.equal(error.constructor, TypeError, "a missing seam fails loudly");
		assert.match(error.message, /followup/u, "the seam is the method the row calls by name");
		return true;
	});
});
