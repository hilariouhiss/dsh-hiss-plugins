import { registerSkillCommands } from "@hilariouhiss/dsh-skill-kit";

/** `/opsx-*` slash command → bundled skill mapping (kebab "flat" form). */
export const COMMANDS = [
	{ name: "opsx-propose", skill: "openspec-propose", description: "create a change and generate all planning artifacts in one step" },
	{ name: "opsx-explore", skill: "openspec-explore", description: "explore ideas and clarify requirements before committing to a change" },
	{ name: "opsx-new", skill: "openspec-new-change", description: "start a new change scaffold, step by step" },
	{ name: "opsx-continue", skill: "openspec-continue-change", description: "create the next artifact for an existing change" },
	{ name: "opsx-ff", skill: "openspec-ff-change", description: "fast-forward: create all planning artifacts at once" },
	{ name: "opsx-apply", skill: "openspec-apply-change", description: "implement tasks from a change" },
	{ name: "opsx-update", skill: "openspec-update-change", description: "revise a change's planning artifacts and keep them coherent" },
	{ name: "opsx-verify", skill: "openspec-verify-change", description: "verify implementation matches the change's artifacts" },
	{ name: "opsx-sync", skill: "openspec-sync-specs", description: "merge delta specs into main specs" },
	{ name: "opsx-archive", skill: "openspec-archive-change", description: "archive a completed change" },
	{ name: "opsx-bulk-archive", skill: "openspec-bulk-archive-change", description: "archive multiple completed changes at once" },
	{ name: "opsx-onboard", skill: "openspec-onboard", description: "guided walkthrough of the full OpenSpec workflow" },
];

/**
 * Register the twelve `/opsx-*` commands on the host `commands` registry. Each
 * command injects the matching skill's rendered content as a durable user
 * message via `agent.followup`.
 */
export function registerCommands(ctx) {
	registerSkillCommands(ctx, COMMANDS, "@hilariouhiss/dsh-openspec");
}
