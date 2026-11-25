/**
 * The lan-access row: one LAN listener that relays this Web Host, the
 * `/lan` command that hands a phone the tokenized URL, and the loopback page
 * that shows that URL as a QR code.
 *
 * The Desktop Host always binds the Host to loopback and reports
 * `http://127.0.0.1:<port>` to its window, so the LAN surface cannot be the
 * Host's own listener: it is a gateway beside it. See `./gateway.js` for why
 * the forwarded request claims the loopback authority.
 *
 * @module dsh-hiss-plugins/lan-access
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { lanAddresses, startGateway } from "./gateway.js";
import { qrMatrix, qrSvg } from "./qr.js";

export const name = "lan-access";
export const inject = ["webServer"];

/** The stable LAN port a phone bookmark can keep. */
const DEFAULT_PORT = 7505;
/** Every IPv4 interface, so a DHCP address change never invalidates the bind. */
const WILDCARD = "0.0.0.0";
/** Loopback page that renders the pairing URL as a QR code. */
const PAGE_PATH = "/lan-access";
/** Diagnostics log: only refusals and pairing events, capped. */
const LOG_PATH = join(homedir(), ".dsh", "lan-access.log");
const LOG_LIMIT_BYTES = 256 * 1024;

/**
 * Mount the gateway, the QR page, and the command.
 * @param {import("@deepseek-ai/cordis").Context} ctx - host context carrying `webServer`.
 * @param {{ host?: string, port?: number | string }} [config] - profile-patch overrides.
 */
export function apply(ctx, config = {}) {
	const port = portOf(config?.port);
	const host = typeof config?.host === "string" && config.host !== "" ? config.host : undefined;
	// Off by default: tests and ordinary users must not grow a log file; turning it
	// on in the profile patch is what makes a phone-side refusal diagnosable.
	const debug = config?.debug === true;
	const pair = randomBytes(18).toString("base64url");
	const state = { status: "starting", error: undefined, bindHost: undefined, port: undefined, pageUrl: undefined, pair };

	ctx.inject(["connection"], (connectionCtx) => {
		const connection = connectionCtx.connection;
		const webServer = connectionCtx.get("webServer");

		if (webServer !== undefined && typeof webServer.register === "function") {
			connectionCtx.effect(() => webServer.register({
				kind: "exact",
				path: PAGE_PATH,
				// Hosts from 0.2.2 on admit every route themselves and hand the handler the
				// admitted Peer; the page carries a pairing secret, so the requirement is
				// declared here instead of being re-derived inside the handler.
				auth: "required",
				handler: (request, response, peer) => servePage(request, response, { state, connection, addresses: lanAddresses(), peer }),
			}), "lan-access.page");
			try {
				state.pageUrl = new URL(PAGE_PATH, webServer.getOrigin()).href;
			} catch {
				state.pageUrl = undefined;
			}
		}

		connectionCtx.effect(async () => {
			const server = connectionCtx.get("webServer");
			if (server === undefined) return;
			if (!isLoopback(server.host)) {
				// Someone already ran `dsh web --host <address>`; a second listener
				// would only add a surface without adding reach.
				state.status = "direct";
				state.bindHost = server.host;
				state.port = server.port;
				return;
			}
			try {
				const gateway = await bindGateway(server, port, host, {
					pair,
					tokenUrl: () => connection.authenticatedUrl(`${server.getOrigin()}/`),
					log: debug ? writeLog : undefined,
				});
				if (debug) writeLog({ event: "listen", address: gateway.address, port: gateway.port });
				state.status = "listening";
				state.bindHost = gateway.address;
				state.port = gateway.port;
				connectionCtx.logger.warn(`lan-access: serving the browser surface on port ${String(gateway.port)} over plain HTTP; disable the row to stop it`);
				return async () => {
					await gateway.close();
					state.status = "closed";
				};
			} catch (error) {
				state.status = "failed";
				state.error = messageOf(error);
				connectionCtx.logger.warn(`lan-access: ${state.error}`);
			}
		}, "lan-access.listen");

		ctx.inject(["commands"], (commandCtx) => {
			commandCtx.commands.register({
				name: "lan",
				description: "Show the LAN URL (and QR page) a phone can use for this Web GUI",
				handler: (invocation) => (invocation.rawInput.trim() === ""
					? report(state, connection, lanAddresses())
					: { kind: "error", text: "Usage: /lan (no arguments)" }),
			});
		});
	});
}

/**
 * Bind the LAN gateway, falling back to one concrete address when the wildcard
 * port is already taken by this Host's own loopback listener on the same port.
 * @param {{ host: string, port: number }} server - the Host's web server facts.
 * @param {number} port - the configured LAN port.
 * @param {string | undefined} pinned - an explicitly configured bind address.
 * @returns the started gateway.
 */
async function bindGateway(server, port, pinned, pairing) {
	const listenHost = pinned ?? WILDCARD;
	const options = { targetHost: server.host, targetPort: server.port, listenPort: port, ...pairing };
	try {
		return await startGateway({ ...options, listenHost });
	} catch (error) {
		const fallback = pinned === undefined && error?.code === "EADDRINUSE"
			? lanAddresses().find((entry) => entry.virtual !== true)?.address
			: undefined;
		if (fallback === undefined) throw error;
		return startGateway({ ...options, listenHost: fallback });
	}
}

/**
 * Build the `/lan` answer from the listener's current state; LAN addresses are
 * read at call time, not at boot, so a DHCP change shows up instead of going stale.
 * @param {{ status: string, error?: string, bindHost?: string, port?: number, pageUrl?: string }} state - the listener state.
 * @param {{ authenticatedUrl: (base: string) => string }} connection - the browser-auth carrier.
 * @param {{ name: string, address: string }[]} addresses - the current LAN addresses.
 * @returns {{ kind: "success" | "error", text: string }} the command result.
 */
export function report(state, connection, addresses) {
	if (state.status === "listening") {
		const physical = addresses.filter((entry) => entry.virtual !== true);
		const ignored = addresses.filter((entry) => entry.virtual === true);
		if (physical.length === 0) return { kind: "error", text: "LAN access is listening but this machine has no physical LAN IPv4 address right now." };
		const url = `http://${physical[0].address}:${String(state.port)}/?pair=${String(state.pair)}`;
		const lines = [
			`LAN access: ${url}`,
			state.pageUrl === undefined ? "Open this URL once on a phone on the same network; the signed browser cookie then lasts 30 days." : `QR code: open ${state.pageUrl} on this computer and scan it with the phone.`,
			`Plain HTTP on the LAN: only use it on a network you trust (Windows firewall must allow TCP ${String(state.port)} for this app).`,
		];
		if (physical.length > 1) lines.push(`Other addresses: ${physical.slice(1).map((entry) => `${entry.address} (${entry.name})`).join(", ")}.`);
		if (ignored.length > 0) lines.push(`Ignored virtual adapters (a phone cannot reach them): ${ignored.map((entry) => `${entry.address} (${entry.name})`).join(", ")}.`);
		return { kind: "success", text: lines.join("\n") };
	}
	if (state.status === "direct") {
		const url = connection.authenticatedUrl(`http://${state.bindHost}:${String(state.port)}/`);
		return { kind: "success", text: `The Host already listens on a network address: ${url}` };
	}
	if (state.status === "failed") return { kind: "error", text: `LAN access is not running: ${state.error}. Set \`host\` or \`port\` in the profile patch and reload the row.` };
	if (state.status === "closed") return { kind: "error", text: "LAN access is disabled; enable the lan-access row in the Plugins page." };
	return { kind: "error", text: "LAN access is still starting; run /lan again in a moment." };
}

/**
 * Serve the QR page to an authenticated owner only: it carries the pairing secret.
 * @param {import("node:http").IncomingMessage} request - the page request.
 * @param {import("node:http").ServerResponse} response - the answer.
 * @param {{ state: object, connection: object, addresses: { name: string, address: string }[], peer?: object }} deps - listener state, browser auth, the LAN addresses to show, and the Peer the Host already admitted.
 */
export function servePage(request, response, { state, connection, addresses, peer }) {
	// Hosts from 0.2.2 on move browser auth into the route and hand the handler the
	// admitted Peer; asking `connection.admit` again for that same request fails there.
	// An older Host admits no route, so the handler stays the only gate and checks.
	if (peer === undefined) {
		let admission;
		try {
			admission = connection.admit(request);
		} catch {
			admission = { rejection: 401 };
		}
		if (admission.rejection !== undefined) {
			response.writeHead(admission.rejection, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
			response.end(admission.rejection === 401 ? "Open this page from the DSH window on this computer.\n" : "forbidden\n");
			return;
		}
	}
	let embed = false;
	try {
		embed = new URL(request.url ?? "/", "http://lan.invalid").searchParams.get("embed") === "1";
	} catch {
		embed = false;
	}
	response.writeHead(200, {
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
		"referrer-policy": "no-referrer",
	});
	response.end(renderPage(state, connection, addresses, { embed }));
}

/**
 * Render the QR page.
 * @param {{ status: string, error?: string, bindHost?: string, port?: number }} state - the listener state.
 * @param {{ authenticatedUrl: (base: string) => string }} connection - the browser-auth carrier.
 * @param {{ name: string, address: string }[]} addresses - the current LAN addresses.
 * @param {{ embed?: boolean }} [options] - `embed` drops the page chrome for the in-app popup.
 * @returns the HTML document.
 */
export function renderPage(state, connection, addresses, { embed = false } = {}) {
	const parts = [
		"<!doctype html><html lang=\"zh\"><head><meta charset=\"utf-8\">",
		"<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
		"<title>DSH 手机访问</title><style>body{font:15px/1.6 system-ui,sans-serif;margin:24px;color:#111;background:#fafafa}",
		"section{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:16px;margin:16px 0;max-width:420px}",
		"h1{font-size:20px}h2{font-size:14px;color:#52525b;margin:0 0 12px}",
		// The URL is read, not copied by sight: keep the body face at a readable size.
		"code{font:inherit;font-size:14px;line-height:1.5;color:#3f3f46;word-break:break-all}svg{max-width:100%;height:auto}",
		embed ? "body{margin:0;padding:8px;background:#fff;overflow:hidden}section{margin:0;border:none;padding:0;max-width:none}svg{display:block;margin:0 auto}" : "",
		"</style></head><body>",
	];
	if (!embed) parts.push("<h1>手机访问本机 DSH</h1>");
	if (state.status === "listening") {
		const physical = addresses.filter((entry) => entry.virtual !== true);
		if (physical.length === 0) parts.push("<p>本机当前只有虚拟网卡（Hyper-V / VPN），手机无法连接。</p>");
		for (const entry of physical) {
			const url = `http://${entry.address}:${String(state.port)}/?pair=${String(state.pair)}`;
			parts.push(
				`<section><h2>${escapeHtml(entry.name)} · ${escapeHtml(entry.address)}</h2>`,
				qrSvg(qrMatrix(url), { scale: embed ? 6 : 8, border: 4 }),
				`<p><code>${escapeHtml(url)}</code></p></section>`,
			);
		}
		// No instructions here: the popup below the frame and /lan already say it,
		// and a virtual adapter with no phone-reachable route is simply not listed.
	} else if (state.status === "direct") {
		parts.push(`<p>Host 已监听网络地址 <code>http://${escapeHtml(String(state.bindHost))}:${String(state.port)}/</code>，无需网关。</p>`);
	} else if (state.status === "failed") {
		parts.push(`<p role=\"alert\"><strong>局域网监听失败：</strong>${escapeHtml(String(state.error))}</p>`, "<p>在 profile 的 <code>cordis.patch.yml</code> 里给 <code>dsh-hiss-plugins-lan-access</code> 行设置 <code>config.host</code> / <code>config.port</code> 后重启。</p>");
	} else {
		parts.push("<p>正在启动局域网监听，稍后刷新本页。</p>");
	}
	parts.push("</body></html>");
	return parts.join("");
}

/**
 * Escape text for HTML text and attribute contexts.
 * @param value - the text.
 * @returns the escaped text.
 */
function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * Append one diagnostic line, dropping the file instead of growing without
 * bound. Every write failure is ignored: diagnostics never break the listener.
 * @param entry - the event record.
 */
function writeLog(entry) {
	try {
		mkdirSync(join(homedir(), ".dsh"), { recursive: true });
		let size = 0;
		try {
			size = statSync(LOG_PATH).size;
		} catch {
			size = 0;
		}
		const stamp = new Date().toISOString();
		appendFileSync(LOG_PATH, `${stamp} ${JSON.stringify(entry)}\n`, { flag: size > LOG_LIMIT_BYTES ? "w" : "a" });
	} catch {
		// Diagnostics are optional.
	}
}

/**
 * Read the configured LAN port.
 * @param value - the profile patch value, or undefined.
 * @returns the listening port; 0 asks the OS to pick one.
 */
function portOf(value) {
	if (value === undefined) return DEFAULT_PORT;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`lan-access: port must be an integer 0-65535, got ${JSON.stringify(value)}`);
	return port;
}

/**
 * Whether an address is the loopback authority.
 * @param host - a bind address literal.
 * @returns true for `localhost`, `::1`, and 127/8.
 */
function isLoopback(host) {
	return host === "localhost" || host === "::1" || /^127\./u.test(host);
}

/**
 * Readable text for anything thrown.
 * @param error - the thrown value.
 * @returns its message.
 */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
