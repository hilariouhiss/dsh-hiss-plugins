/**
 * The LAN gateway's contract: which addresses it offers, how it rewrites the
 * authorities the Host's browser-trust fence reads, and that HTTP, upgrades,
 * failures, and teardown all survive a real round trip.
 *
 * @module dsh-hiss-plugins/test/lan-access/gateway
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { lanAddresses, rewriteHeaders, startGateway } from "../../lib/lan-access/gateway.js";

/**
 * Start an HTTP upstream on a loopback port.
 * @param handler - the request handler.
 * @returns the base URL, port, and a close function.
 */
async function upstreamOf(handler) {
	const server = createServer(handler);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	return {
		port,
		close: () => new Promise((resolve) => {
			server.closeAllConnections?.();
			server.close(resolve);
		}),
	};
}

/**
 * Wait for a socket to receive text containing a marker.
 * @param socket - the socket to read.
 * @param marker - the text to wait for.
 * @returns every chunk received, as one string.
 */
function readUntil(socket, marker) {
	return new Promise((resolve, reject) => {
		let text = "";
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`timed out waiting for ${JSON.stringify(marker)}; received ${JSON.stringify(text)}`));
		}, 2000);
		const onData = (chunk) => {
			text += chunk.toString("utf8");
			if (text.includes(marker)) {
				cleanup();
				resolve(text);
			}
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			clearTimeout(timer);
			socket.off("data", onData);
			socket.off("error", onError);
		};
		socket.on("data", onData);
		socket.on("error", onError);
	});
}

test("lanAddresses offers private IPv4 addresses with virtual adapters last", () => {
	const interfaces = {
		"vEthernet (Default Switch)": [{ family: "IPv4", address: "172.19.112.1", internal: false }],
		WLAN: [
			{ family: "IPv6", address: "fe80::1", internal: false },
			{ family: "IPv4", address: "192.168.7.14", internal: false },
		],
		"Loopback Pseudo-Interface 1": [{ family: "IPv4", address: "127.0.0.1", internal: true }],
		"Ethernet 2": [{ family: "IPv4", address: "169.254.10.2", internal: false }],
	};
	assert.deepEqual(lanAddresses(interfaces), [
		{ name: "WLAN", address: "192.168.7.14", virtual: false },
		{ name: "vEthernet (Default Switch)", address: "172.19.112.1", virtual: true },
	]);
});

test("rewriteHeaders points Host at loopback and drops the hop-by-hop headers", () => {
	const headers = {
		host: "192.168.7.14:7505",
		connection: "keep-alive",
		"keep-alive": "timeout=5",
		"proxy-connection": "keep-alive",
		"transfer-encoding": "chunked",
		te: "trailers",
		trailer: "x-checksum",
		cookie: "dsh-auth-abc=def",
		"content-length": "3",
		"sec-fetch-site": "same-origin",
	};
	const rewritten = rewriteHeaders(headers, { inboundAuthority: "192.168.7.14:7505" });
	assert.equal(rewritten.host, "127.0.0.1");
	for (const gone of ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer"]) {
		assert.equal(rewritten[gone], undefined, `${gone} must not reach the Host`);
	}
	assert.equal(rewritten.cookie, "dsh-auth-abc=def");
	assert.equal(rewritten["content-length"], "3");
	assert.equal(rewritten["sec-fetch-site"], "same-origin");
});

test("rewriteHeaders rewrites a same-origin Origin and leaves a foreign one alone", () => {
	const same = rewriteHeaders({ host: "192.168.7.14:7505", origin: "http://192.168.7.14:7505" }, { inboundAuthority: "192.168.7.14:7505" });
	assert.equal(same.origin, "http://127.0.0.1");

	const foreign = rewriteHeaders({ host: "192.168.7.14:7505", origin: "http://evil.example" }, { inboundAuthority: "192.168.7.14:7505" });
	assert.equal(foreign.origin, "http://evil.example", "a cross-site Origin must stay unmatched so the Host fence refuses it");
});

test("startGateway forwards the request body, the rewritten headers, and the response", async () => {
	const seen = [];
	const upstream = await upstreamOf((request, response) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			seen.push({ headers: request.headers, body });
			response.writeHead(200, { "content-type": "text/plain", "set-cookie": ["a=1", "b=2"], "x-test": "yes" });
			response.end("forwarded");
		});
	});
	const gateway = await startGateway({ targetPort: upstream.port, listenHost: "127.0.0.1", listenPort: 0 });
	try {
		const answer = await new Promise((resolve, reject) => {
			const request = httpRequest({
				host: "127.0.0.1",
				port: gateway.port,
				path: "/api/remote",
				method: "POST",
				headers: { host: "192.168.7.14:7505", origin: "http://192.168.7.14:7505", "content-length": "3" },
			}, (response) => {
				let text = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => {
					text += chunk;
				});
				response.on("end", () => {
					resolve({ status: response.statusCode, headers: response.headers, text });
				});
			});
			request.on("error", reject);
			request.end("abc");
		});
		assert.equal(answer.status, 200);
		assert.equal(answer.text, "forwarded");
		assert.equal(answer.headers["x-test"], "yes");
		assert.deepEqual(answer.headers["set-cookie"], ["a=1", "b=2"]);
		assert.equal(seen.length, 1);
		assert.equal(seen[0].headers.host, "127.0.0.1");
		assert.equal(seen[0].headers.origin, "http://127.0.0.1");
		assert.equal(seen[0].body, "abc");
	} finally {
		await gateway.close();
		await upstream.close();
	}
});

test("startGateway answers 502 when the upstream is unreachable", async () => {
	const upstream = await upstreamOf((_request, response) => response.end("never"));
	const { port } = upstream;
	await upstream.close();
	const gateway = await startGateway({ targetPort: port, listenHost: "127.0.0.1", listenPort: 0 });
	try {
		const answer = await new Promise((resolve, reject) => {
			const request = httpRequest({ host: "127.0.0.1", port: gateway.port, path: "/" }, (response) => {
				response.resume();
				response.on("end", () => resolve({ status: response.statusCode }));
			});
			request.on("error", reject);
			request.end();
		});
		assert.equal(answer.status, 502);
	} finally {
		await gateway.close();
	}
});

test("startGateway tunnels a WebSocket upgrade in both directions", async () => {
	const upstreamSockets = new Set();
	const upstream = createServer((_request, response) => response.end("plain"));
	upstream.on("connection", (socket) => {
		upstreamSockets.add(socket);
		socket.once("close", () => upstreamSockets.delete(socket));
	});
	upstream.on("upgrade", (request, socket) => {
		socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Upstream: yes\r\n\r\n");
		socket.on("data", (chunk) => socket.write(`echo:${chunk.toString("utf8")}`));
	});
	await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
	const gateway = await startGateway({ targetPort: upstream.address().port, listenHost: "127.0.0.1", listenPort: 0 });
	const socket = connect(gateway.port, "127.0.0.1");
	try {
		await new Promise((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		socket.write("GET /api/remote.mux HTTP/1.1\r\nHost: 192.168.7.14:7505\r\nOrigin: http://192.168.7.14:7505\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
		const handshake = await readUntil(socket, "X-Upstream: yes");
		assert.match(handshake, /^HTTP\/1\.1 101/u);
		socket.write("ping");
		const echoed = await readUntil(socket, "echo:ping");
		assert.match(echoed, /echo:ping/u);
	} finally {
		socket.destroy();
		await gateway.close();
		// An upgraded connection never leaves the upstream server's own roster,
		// so the test destroys it before waiting for the close callback.
		for (const open of upstreamSockets) open.destroy();
		await new Promise((resolve) => upstream.close(() => resolve()));
	}
});

test("close releases the listening port", async () => {
	const upstream = await upstreamOf((_request, response) => response.end("ok"));
	const first = await startGateway({ targetPort: upstream.port, listenHost: "127.0.0.1", listenPort: 0 });
	const { port } = first;
	await first.close();
	const second = await startGateway({ targetPort: upstream.port, listenHost: "127.0.0.1", listenPort: port });
	assert.equal(second.port, port);
	await second.close();
	await upstream.close();
});
/** A stand-in Host that only accepts its own token exchange and cookie. */
async function authUpstreamOf() {
	const state = { deny: false, seen: [], upgrades: [], sockets: new Set() };
	const server = createServer((request, response) => {
		const url = new URL(request.url, "http://host.invalid");
		state.seen.push({ path: url.pathname, cookie: request.headers.cookie, token: url.searchParams.get("token") });
		if (url.pathname === "/" && url.searchParams.get("token") === "TOKEN") {
			response.writeHead(303, { location: "./", "set-cookie": "dsh-auth=host-cookie; Path=/; HttpOnly" });
			response.end();
			return;
		}
		if (state.deny || request.headers.cookie !== "dsh-auth=host-cookie") {
			response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
			response.end("unauthorized\n");
			return;
		}
		response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
		response.end("private\n");
	});
	server.on("upgrade", (request, socket) => {
		state.upgrades.push({ cookie: request.headers.cookie });
		socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
	});
	server.on("connection", (socket) => {
		state.sockets.add(socket);
		socket.once("close", () => state.sockets.delete(socket));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: server.address().port,
		state,
		close: async () => {
			// An upgraded connection never leaves the server's roster on its own.
			for (const socket of state.sockets) socket.destroy();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

/** One plain HTTP exchange. */
function requestOnce(target, headers = {}) {
	return new Promise((resolve, reject) => {
		const query = httpRequest(target, { headers }, (response) => {
			let text = "";
			response.setEncoding("utf8");
			response.on("data", (chunk) => {
				text += chunk;
			});
			response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
		});
		query.on("error", reject);
		query.end();
	});
}

test("pairing exchanges the gateway's own token and stamps the cookie afterwards", async () => {
	const upstream = await authUpstreamOf();
	const gateway = await startGateway({
		targetPort: upstream.port,
		listenHost: "127.0.0.1",
		listenPort: 0,
		pair: "SECRET",
		tokenUrl: () => `http://127.0.0.1:${String(upstream.port)}/?token=TOKEN`,
	});
	try {
		const paired = await requestOnce(`http://127.0.0.1:${String(gateway.port)}/?pair=SECRET`, { host: "192.168.102.124:7505" });
		assert.equal(paired.status, 303);
		assert.equal(paired.headers.location, "./");
		assert.equal(upstream.state.seen[0].token, "TOKEN", "the gateway, not the phone, sends the Host token");

		const page = await requestOnce(`http://127.0.0.1:${String(gateway.port)}/`, { host: "192.168.102.124:7505" });
		assert.equal(page.status, 200);
		assert.equal(page.text, "private\n");
		assert.equal(upstream.state.seen.at(-1).cookie, "dsh-auth=host-cookie", "the paired client carries no cookie of its own");
	} finally {
		await gateway.close();
		await upstream.close();
	}
});

test("a stale pairing secret is refused with a pairing message", async () => {
	const upstream = await authUpstreamOf();
	const gateway = await startGateway({
		targetPort: upstream.port,
		listenHost: "127.0.0.1",
		listenPort: 0,
		pair: "SECRET",
		tokenUrl: () => `http://127.0.0.1:${String(upstream.port)}/?token=TOKEN`,
	});
	try {
		const answer = await requestOnce(`http://127.0.0.1:${String(gateway.port)}/?pair=OLD`);
		assert.equal(answer.status, 401);
		assert.match(answer.text, /pairing expired/u);
	} finally {
		await gateway.close();
		await upstream.close();
	}
});

test("a session the Host refuses is dropped instead of retried forever", async () => {
	const upstream = await authUpstreamOf();
	const gateway = await startGateway({
		targetPort: upstream.port,
		listenHost: "127.0.0.1",
		listenPort: 0,
		pair: "SECRET",
		tokenUrl: () => `http://127.0.0.1:${String(upstream.port)}/?token=TOKEN`,
	});
	try {
		await requestOnce(`http://127.0.0.1:${String(gateway.port)}/?pair=SECRET`);
		upstream.state.deny = true;
		assert.equal((await requestOnce(`http://127.0.0.1:${String(gateway.port)}/`)).status, 401);
		upstream.state.deny = false;
		assert.equal((await requestOnce(`http://127.0.0.1:${String(gateway.port)}/`)).status, 401, "the refused session is gone");
		assert.equal(upstream.state.seen.at(-1).cookie, undefined);
	} finally {
		await gateway.close();
		await upstream.close();
	}
});

test("a paired WebSocket upgrade also carries the Host cookie", async () => {
	const upstream = await authUpstreamOf();
	const gateway = await startGateway({
		targetPort: upstream.port,
		listenHost: "127.0.0.1",
		listenPort: 0,
		pair: "SECRET",
		tokenUrl: () => `http://127.0.0.1:${String(upstream.port)}/?token=TOKEN`,
	});
	const socket = connect(gateway.port, "127.0.0.1");
	try {
		await new Promise((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		await requestOnce(`http://127.0.0.1:${String(gateway.port)}/?pair=SECRET`);
		socket.write("GET /api/remote.mux HTTP/1.1\r\nHost: 192.168.102.124:7505\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
		const answer = await readUntil(socket, "101 Switching Protocols");
		assert.match(answer, /101/u);
		assert.equal(upstream.state.upgrades.at(-1).cookie, "dsh-auth=host-cookie");
	} finally {
		socket.destroy();
		await gateway.close();
		await upstream.close();
	}
});
