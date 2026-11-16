/**
 * The LAN gateway: one listener on this machine's network address that forwards
 * the browser surface to the loopback Host.
 *
 * The Host's browser-trust fence accepts loopback, its own bind address, or a
 * configured authority, and its signed cookie is bound to the authority the
 * request names. Rewriting Host to the bare loopback authority therefore does
 * two things at once: the fence admits the request, and every device's cookie
 * stays valid across restarts even though the Host's port is assigned afresh
 * each launch.
 *
 * Pairing: the QR page never carries the Host's launch token. A phone opens
 * `/?pair=<secret>` once; the gateway performs the token exchange itself,
 * keeps the resulting Host cookie for that client address, and stamps it on
 * every later request from that address. The phone therefore needs neither the
 * Host token nor working cookies, and a stale QR page fails loudly instead of
 * silently signing in the wrong generation.
 *
 * @module dsh-hiss-plugins/lan-access/gateway
 */
import { createServer, request as httpRequest } from "node:http";
import { networkInterfaces } from "node:os";

/** Bare loopback authority every forwarded request claims. */
const AUTHORITY = "127.0.0.1";
/** The relay target when no address is named. */
const LOOPBACK = "127.0.0.1";
/** Headers a proxy must not pass on: they describe one hop, not the request. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade"]);
/** Interface names Windows and the usual VPN tools use for adapters no phone can reach. */
const VIRTUAL = /vEthernet|Hyper-V|VirtualBox|VMware|WSL|Tailscale|ZeroTier|Docker|Bluetooth/iu;
/** Paired clients kept at once; a LAN feature does not need more. */
const SESSION_LIMIT = 32;

/**
 * The machine's reachable IPv4 addresses, network adapters before virtual ones.
 * `virtual` marks adapters a phone cannot reach (Hyper-V, VPN); callers use it to
 * skip such an address when a scan target is needed.
 * @param interfaces - a `os.networkInterfaces()` shaped table.
 * @returns `{ name, address, virtual }` entries; empty when nothing is reachable.
 */
export function lanAddresses(interfaces = networkInterfaces()) {
	const found = [];
	for (const [name, entries] of Object.entries(interfaces)) {
		for (const entry of entries ?? []) {
			if ((entry.family !== "IPv4" && entry.family !== 4) || entry.internal || entry.address.startsWith("169.254.")) continue;
			found.push({ name, address: entry.address, virtual: VIRTUAL.test(name) });
		}
	}
	// A phone on the Wi-Fi belongs to the physical adapter, so the virtual ones
	// (Hyper-V, VPN) come after every candidate a phone can actually reach.
	found.sort((left, right) => Number(left.virtual) - Number(right.virtual) || left.name.localeCompare(right.name));
	return found.map(({ name, address, virtual }) => ({ name, address, virtual }));
}

/**
 * The headers one forwarded request carries.
 *
 * `Host` always names loopback. `Origin` is rewritten only when it already
 * matched the authority the request arrived on, so a cross-site Origin keeps its
 * mismatch and the Host's fence still refuses it.
 *
 * @param headers - the incoming request headers.
 * @param options - `inboundAuthority`: the Host header the browser sent.
 * @returns a fresh header object.
 */
export function rewriteHeaders(headers, { inboundAuthority }) {
	const rewritten = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue;
		rewritten[name] = value;
	}
	// shortcut: every forwarded request claims the loopback authority, so a future
	// unauthenticated loopback-only route would also be reachable through this
	// listener; revisit if the Connection fence stops requiring the browser cookie
	// on every /api route.
	rewritten.host = AUTHORITY;
	const origin = headers.origin;
	if (typeof origin === "string" && namesSameAuthority(origin, inboundAuthority)) rewritten.origin = `http://${AUTHORITY}`;
	return rewritten;
}

/**
 * Whether an Origin header names one authority.
 * @param origin - the Origin header value.
 * @param authority - a `host[:port]` authority.
 * @returns true when the origin's authority matches.
 */
function namesSameAuthority(origin, authority) {
	try {
		return new URL(origin).host === authority;
	} catch {
		return false;
	}
}

/**
 * The response headers one forwarded answer carries.
 * @param headers - the upstream response headers.
 * @returns a copy without the hop-by-hop names.
 */
function responseHeaders(headers) {
	const copied = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue;
		copied[name] = value;
	}
	return copied;
}

/**
 * Render raw header pairs as a header block without its terminating blank line.
 * @param raw - the `rawHeaders` array of name/value pairs.
 * @returns CRLF-joined header lines.
 */
function rawHeaders(raw) {
	const lines = [];
	for (let index = 0; index + 1 < raw.length; index += 2) lines.push(`${raw[index]}: ${raw[index + 1]}`);
	return lines.join("\r\n");
}

/**
 * The first cookie pair of a Set-Cookie header value.
 * @param setCookie - the header value, or the array Node keeps for repeats.
 * @returns `name=value`, or undefined when the response set no cookie.
 */
function sessionCookieOf(setCookie) {
	if (setCookie === undefined) return undefined;
	const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
	if (typeof value !== "string" || value === "") return undefined;
	return value.split(";")[0];
}

/**
 * Forward one buffered HTTP request and stream the answer back.
 * @param request - the incoming request.
 * @param response - the answer to write.
 * @param relay - the upstream address and the session roster.
 * @param session - the Host cookie this client is entitled to, when paired.
 */
function forward(request, response, relay, session) {
	const headers = rewriteHeaders(request.headers, { inboundAuthority: request.headers.host });
	if (session !== undefined) headers.cookie = session;
	const upstream = httpRequest({
		host: relay.targetHost,
		port: relay.targetPort,
		method: request.method,
		path: request.url,
		headers,
	});
	upstream.on("response", (answer) => {
		if (answer.statusCode === 401 && session !== undefined) relay.sessions.delete(relay.client);
		// Only refusals are worth a line: they are what "the phone shows 401" means.
		if (answer.statusCode !== undefined && answer.statusCode >= 400) {
			relay.log?.({ event: "forward", client: relay.client, path: String(request.url ?? "").split("?")[0], session: session !== undefined, status: answer.statusCode });
		}
		response.writeHead(answer.statusCode ?? 502, responseHeaders(answer.headers));
		// An error on either stream must not surface as an unhandled 'error' event:
		// that would take the whole Host process down with one dropped connection.
		answer.on("error", () => response.destroy());
		response.on("error", () => upstream.destroy());
		answer.pipe(response);
	});
	upstream.on("error", () => {
		if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
		response.end("lan-access: the DSH Host is not reachable\n");
	});
	request.on("aborted", () => upstream.destroy());
	request.on("error", () => upstream.destroy());
	request.pipe(upstream);
}

/**
 * Tunnel one WebSocket upgrade in both directions, relaying a refusal as-is.
 * @param request - the upgrade request.
 * @param socket - the browser socket.
 * @param head - bytes read past the request head.
 * @param relay - the upstream address, the session roster, and the diagnostics sink.
 * @param session - the Host cookie this client is entitled to, when paired.
 */
function tunnel(request, socket, head, relay, session) {
	const headers = {
		...rewriteHeaders(request.headers, { inboundAuthority: request.headers.host }),
		connection: "Upgrade",
		upgrade: request.headers.upgrade,
	};
	if (session !== undefined) headers.cookie = session;
	const upstream = httpRequest({
		host: relay.targetHost,
		port: relay.targetPort,
		method: request.method,
		path: request.url,
		headers,
	});
	const destroy = () => {
		socket.destroy();
		upstream.destroy();
	};
	socket.on("error", destroy);
	upstream.on("error", destroy);
	upstream.on("response", (answer) => {
		// The Host answered the handshake instead of upgrading (403/401): relay
		// the status line and headers so the browser reports the real refusal.
		socket.write(`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage ?? "Error"}\r\n${rawHeaders(answer.rawHeaders)}\r\n\r\n`);
		answer.resume();
		socket.end();
	});
	upstream.on("upgrade", (answer, upstreamSocket, upstreamHead) => {
		relay.upgrades.add(upstreamSocket);
		upstreamSocket.once("close", () => relay.upgrades.delete(upstreamSocket));
		upstreamSocket.on("error", destroy);
		socket.write(`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage ?? "Switching Protocols"}\r\n${rawHeaders(answer.rawHeaders)}\r\n\r\n`);
		if (upstreamHead.length > 0) socket.write(upstreamHead);
		upstreamSocket.pipe(socket).pipe(upstreamSocket);
		socket.on("close", () => upstreamSocket.destroy());
	});
	if (head.length > 0) upstream.write(head);
	upstream.end();
}

/**
 * Bind the LAN listener.
 * @param options - `targetPort` (required), `targetHost`, `listenHost`, `listenPort`,
 *   `pair` (the pairing secret), `tokenUrl` (a function returning a tokenized loopback
 *   URL), and `log` (an optional diagnostics sink).
 * @returns the bound port and address plus a close that frees them.
 */
export async function startGateway({ targetHost = LOOPBACK, targetPort, listenHost, listenPort = 0, pair, tokenUrl, log }) {
	if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
		throw new Error(`lan-access: targetPort must be the Host's listening port, got ${JSON.stringify(targetPort)}`);
	}
	const upgrades = new Set();
	const sockets = new Set();
	/** client address -> the Host cookie minted for its pairing. */
	const sessions = new Map();
	const relay = { targetHost, targetPort, upgrades, sessions, log };

	/**
	 * Exchange the gateway's own token URL for a Host cookie.
	 * @returns the cookie pair, or undefined when the Host refused.
	 */
	const exchangeToken = () => new Promise((resolve) => {
		let url;
		try {
			url = new URL(tokenUrl());
		} catch {
			resolve(undefined);
			return;
		}
		const upstream = httpRequest({
			host: targetHost,
			port: targetPort,
			method: "GET",
			path: `${url.pathname}${url.search}`,
			headers: { host: AUTHORITY },
		}, (answer) => {
			answer.resume();
			const cookie = sessionCookieOf(answer.headers["set-cookie"]);
			resolve(answer.statusCode === 303 && cookie !== undefined ? cookie : undefined);
		});
		upstream.on("error", () => resolve(undefined));
		upstream.setTimeout(5000, () => {
			upstream.destroy();
			resolve(undefined);
		});
		upstream.end();
	});

	/**
	 * Handle one pairing attempt; the answer is owned either way.
	 * @param request - the incoming request.
	 * @param response - the answer to write.
	 * @param supplied - the `pair` query value.
	 */
	const pairClient = async (request, response, supplied) => {
		const client = request.socket?.remoteAddress ?? "";
		const cookie = supplied === pair ? await exchangeToken() : undefined;
		if (cookie === undefined) {
			log?.({ event: "pair", client, ok: false });
			response.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
			response.end("lan-access: pairing expired; reopen the QR page on the computer that runs DSH\n");
			return;
		}
		sessions.delete(client);
		sessions.set(client, cookie);
		while (sessions.size > SESSION_LIMIT) sessions.delete(sessions.keys().next().value);
		log?.({ event: "pair", client, ok: true });
		response.writeHead(303, { location: "./", "cache-control": "no-store", "referrer-policy": "no-referrer" });
		response.end();
	};

	const server = createServer((request, response) => {
		const client = request.socket?.remoteAddress ?? "";
		let target;
		try {
			target = new URL(request.url ?? "/", "http://gateway.invalid");
		} catch {
			response.writeHead(400);
			response.end();
			return;
		}
		if (pair !== undefined && target.searchParams.has("pair")) {
			pairClient(request, response, target.searchParams.get("pair")).catch(() => {
				response.destroy();
			});
			return;
		}
		const session = sessions.get(client);
		if (session !== undefined) {
			// Touch the entry so the roster keeps the clients still talking.
			sessions.delete(client);
			sessions.set(client, session);
		}
		forward(request, response, { ...relay, client }, session);
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	server.on("upgrade", (request, socket, head) => {
		const client = request.socket?.remoteAddress ?? "";
		tunnel(request, socket, head, { ...relay, client }, sessions.get(client));
	});
	await new Promise((resolve, reject) => {
		const onError = (error) => reject(error);
		server.once("error", onError);
		server.listen(listenPort, listenHost, () => {
			server.off("error", onError);
			// A socket error must not take the Host down; the failing connection is
			// already destroyed by the handlers above.
			server.on("error", () => {});
			resolve();
		});
	});
	const address = server.address();
	return {
		port: address.port,
		address: listenHost,
		/** Stop accepting, then drop what is still open so the port really frees. */
		close: async () => {
			// An upgraded socket is not an HTTP connection any more: `server.close()`
			// waits for it forever, so every accepted socket is destroyed explicitly.
			for (const socket of sockets) socket.destroy();
			for (const socket of upgrades) socket.destroy();
			await new Promise((resolve) => server.close(() => resolve()));
		},
	};
}
