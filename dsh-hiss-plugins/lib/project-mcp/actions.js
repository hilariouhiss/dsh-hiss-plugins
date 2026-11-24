/**
 * The `/mcp` dialog's action surface: one dispatcher over the dialog's five requests,
 * so the HTTP seam in `index.js` only reads a body and writes a JSON answer.
 *
 * Every dependency is injected: the dispatcher never imports a host package, which is
 * what lets the whole request matrix run offline against fakes.
 *
 * @module dsh-hiss-plugins/project-mcp/actions
 */

/** Read one thrown value as text. */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}

/** Refuse one request with a code the dialog can branch on. */
function refusal(code, message) {
	return { ok: false, error: { code, message } };
}

/**
 * Run one dialog request.
 * @param {object} body - the parsed request body.
 * @param {object} deps - the host operations the dispatcher may call (status, setTool,
 *   setServer, add, promote). Every method receives the session id first.
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, error: { code: string, message: string } }>}
 *   the answer the dialog reads.
 */
export async function dispatch(body, deps) {
	const action = body?.action;
	const sessionId = body?.sessionId;
	if (typeof sessionId !== "string" || sessionId === "") return refusal("invalid-request", "sessionId is required");
	if (typeof action !== "string") return refusal("unknown-action", "unknown action \"undefined\"");
	try {
		if (action === "status") return { ok: true, value: await deps.status(sessionId) };
		if (action === "set-tool" || action === "set-server") {
			if (typeof body.enabled !== "boolean") return refusal("invalid-request", "enabled must be a boolean");
			const field = action === "set-tool" ? "tool" : "server";
			const name = body[field];
			if (typeof name !== "string" || name === "") return refusal("invalid-request", `${field} is required`);
			const value = action === "set-tool"
				? await deps.setTool(sessionId, name, body.enabled)
				: await deps.setServer(sessionId, name, body.enabled);
			return { ok: true, value };
		}
		if (action === "add-server") {
			if (body.server === null || typeof body.server !== "object") return refusal("invalid-request", "server is required");
			return { ok: true, value: await deps.add(sessionId, body.server) };
		}
		if (action === "promote") {
			if (typeof body.server !== "string" || body.server === "") return refusal("invalid-request", "server is required");
			return { ok: true, value: await deps.promote(sessionId, body.server) };
		}
		return refusal("unknown-action", `unknown action "${action}"`);
	} catch (error) {
		return refusal("failed", messageOf(error));
	}
}
