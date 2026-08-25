import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { renderSkillContent } from "@deepseek-ai/dsh-skill";

/**
 * Register one slash command per entry. Each `{ name, skill?, description }`
 * maps a command to a bundled skill (`skill` defaults to `name`) and injects the
 * skill's rendered content as a durable user message via `agent.followup` — the
 * same mechanism `/goal` uses — so the model reads it in its very next step.
 *
 * @param {Array<{ name: string, skill?: string, description: string }>} commands
 * @param {string} pluginLabel - npm package name, used only in the missing-skill error.
 */
export function registerSkillCommands(ctx, commands, pluginLabel) {
	for (const { name, skill = name, description } of commands) {
		ctx.commands.register({
			name,
			description,
			handler: (invocation) => skillCommand(ctx, invocation, skill, pluginLabel),
		});
	}
}

/** Resolve a skill by name against the invocation's agent scope. */
export async function loadSkill(ctx, invocation, name) {
	const agent = invocation.agent;
	const lookup = {
		cwd: agent?.session?.header?.cwd,
		signal: invocation.signal,
		scope: agent,
	};
	try {
		return await ctx.skills.get(name, lookup);
	} catch (error) {
		if (invocation.signal?.aborted === true) throw error;
		return undefined;
	}
}

async function skillCommand(ctx, invocation, name, pluginLabel) {
	const loaded = await loadSkill(ctx, invocation, name);
	if (loaded === undefined) {
		return {
			kind: "error",
			text: `The "${name}" skill is not available; check that the ${pluginLabel} plugin is installed and enabled.`,
		};
	}
	invocation.agent.followup(createUserMessage({
		content: [{ type: "text", text: renderSkillContent(loaded) }],
		source: { kind: "skill-invocation", name, form: "instructions" },
	}));
	return { kind: "success", text: `Loaded ${name}.` };
}
