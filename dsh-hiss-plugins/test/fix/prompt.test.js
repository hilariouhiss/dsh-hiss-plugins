/**
 * The `/fix` instruction's contract: the symptom, the diagnosis-only rule, the
 * evidence and report it demands, and the explicit confirmation gate.
 *
 * `prompt.js` imports no host package, so this file runs wherever `node --test` does.
 *
 * @module dsh-hiss-plugins/test/fix/prompt
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildFixPrompt } from "../../lib/fix/prompt.js";

/** The symptom named in the prompt, shared by the assertions below. */
const SYMPTOM = "checkout fails after token refresh";

/** The prompt for a known symptom, with surrounding whitespace on purpose. */
const PROMPT = buildFixPrompt(`  ${SYMPTOM}  `);

test("the symptom is embedded and trimmed", () => {
	assert.ok(PROMPT.includes(SYMPTOM));
	assert.ok(!PROMPT.includes(`  ${SYMPTOM}`), "surrounding whitespace is removed");
	assert.match(PROMPT, /Treat it as the bug report/u);
});

test("a bare invocation falls back to the conversation and asks when unclear", () => {
	for (const symptom of ["", "   ", undefined]) {
		const prompt = buildFixPrompt(symptom);
		assert.match(prompt, /No symptom was supplied with \/fix/u);
		assert.match(prompt, /Use the problem under discussion in this conversation/u);
		assert.match(prompt, /ask the user for the failing behavior/u);
		assert.match(prompt, /then stop and wait/u);
	}
});

test("the root cause and its evidence are required", () => {
	assert.match(PROMPT, /Find the root cause/u);
	assert.match(PROMPT, /mechanism that produces the symptom, not the place where it surfaces/u);
	assert.match(PROMPT, /Cite concrete evidence/u);
	assert.match(PROMPT, /hypotheses you ruled out/u);
	assert.match(PROMPT, /verified from what you suspect/u);
	assert.match(PROMPT, /do not guess/u);
});

test("the report covers the proposed fix, risks, and confidence", () => {
	assert.match(PROMPT, /Proposed fix/u);
	assert.match(PROMPT, /proposal, not as work already done/u);
	assert.match(PROMPT, /Risks/u);
	assert.match(PROMPT, /Confidence/u);
});

test("nothing is edited before the user confirms", () => {
	assert.match(PROMPT, /investigation and reporting only/u);
	assert.match(PROMPT, /Do not edit or write files/u);
	assert.match(PROMPT, /change git state/u);
	assert.match(PROMPT, /Read-only checks and failing tests/u);
	assert.match(PROMPT, /explicit confirmation/u);
	assert.match(PROMPT, /A question or a comment on the report is not confirmation/u);
	assert.match(PROMPT, /Only after the user confirms/u);
	assert.match(PROMPT, /ask whether to apply the proposed fix/u);
});
