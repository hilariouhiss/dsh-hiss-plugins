/**
 * The lan-access row's contract: it waits for the Web Host, binds a LAN
 * listener for a loopback Host, reports current (not boot-time) addresses,
 * shows the tokenized URL as a QR page to an admitted request only, and frees
 * the port when the row goes away.
 *
 * @module dsh-hiss-plugins/test/lan-access
 */
import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { apply, inject, name, renderPage, report, servePage } from "../../lib/lan-access/index.js";

const ADDRESSES = [
	{ name: "WLAN", address: "192.168.102.124", virtual: false },
	{ name: "vEthernet (Default Switch)", address: "172.19.112.1", virtual: true },
];
const VIRTUAL_ONLY = [{ name: "vEthernet (Default Switch)", address: "172.19.112.1", virtual: true }];

/**
 * Register the row against a fake host whose services already exist.
 * @param options - `webServer` fields, the `connection` service, and the row `config`.
 * @returns the recorded commands, the page route, the settled listeners, and helpers.
 */
function setup({ webServer, connection, config } = {}) {
	const calls = { commands: [], warnings: [], routes: [], admitted: [] };
	const tasks = [];
	const disposers = [];
	const server = {
		host: "127.0.0.1",
		port: 4321,
		protocol: "http:",
		getOrigin: () => "http://127.0.0.1:4321",
		register(route) {
			calls.routes.push(route);
			return () => {};
		},
		...webServer,
	};
	const ctx = {
		webServer: server,
		connection: connection ?? {
			authenticatedUrl: (base) => `${base}?token=T`,
			admit: (request) => (request.headers.cookie === "ok" ? { peer: {} } : { rejection: 401 }),
		},
		logger: {
			info() {},
			warn(message) {
				calls.warnings.push(String(message));
			},
		},
		get(service) {
			if (service === "webServer") return server;
			if (service === "connection") return ctx.connection;
			return undefined;
		},
		inject(_services, callback) {
			callback(ctx);
		},
		effect(callback) {
			const task = Promise.resolve()
				.then(callback)
				.then((dispose) => {
					if (typeof dispose === "function") disposers.push(dispose);
					return dispose;
				});
			tasks.push(task);
			return () => {};
		},
		commands: {
			register(definition) {
				calls.commands.push(definition);
			},
		},
	};
	apply(ctx, config);
	return {
		calls,
		server,
		/** Wait for the effects to settle. */
		settled: () => Promise.all(tasks),
		/** Run one `/lan` invocation. */
		run(rawInput = "") {
			return calls.commands[0].handler({ rawInput, agent: {}, signal: new AbortController().signal });
		},
		/** Dispose what the effects own, as a row reload does. */
		dispose: async () => {
			await Promise.all(tasks);
			await Promise.all(disposers.map((dispose) => dispose()));
		},
	};
}

/** A response double recording what the page wrote. */
function responseOf() {
	const captured = { status: 0, headers: undefined, body: "" };
	return {
		captured,
		writeHead(status, headers) {
			captured.status = status;
			captured.headers = headers;
		},
		end(body) {
			captured.body = String(body ?? "");
		},
	};
}

test("the row declares the webServer service, registers /lan and the QR page", async (t) => {
	const row = setup({ config: { host: "127.0.0.1", port: 0 } });
	t.after(() => row.dispose());
	assert.equal(name, "lan-access");
	assert.deepEqual(inject, ["webServer"]);
	await row.settled();
	assert.equal(row.calls.commands.length, 1);
	assert.equal(row.calls.commands[0].name, "lan");
	assert.match(row.calls.commands[0].description, /QR/u);
	assert.equal(row.calls.routes.length, 1);
	assert.equal(row.calls.routes[0].kind, "exact");
	assert.equal(row.calls.routes[0].path, "/lan-access");
	assert.equal(row.calls.routes[0].auth, "required", "the page carries the pairing secret, so the route asks for an admitted Peer");
	const page = responseOf();
	row.calls.routes[0].handler({ headers: {}, url: "/lan-access" }, page, { principal: { kind: "owner" } });
	assert.equal(page.captured.status, 200, "an admitted Peer is served without a second cookie check");
	assert.match(page.captured.headers["content-type"], /text\/html/u);
});

test("/lan lists the current LAN address, the QR page and the cookie lifetime", async (t) => {
	const row = setup({ config: { host: "127.0.0.1", port: 0 } });
	t.after(() => row.dispose());
	await row.settled();
	const result = report({ status: "listening", port: 7505, pair: "PAIR", pageUrl: "http://127.0.0.1:4321/lan-access" }, { authenticatedUrl: (base) => `${base}?token=T` }, ADDRESSES);
	assert.equal(result.kind, "success");
	assert.match(result.text, /http:\/\/192\.168\.102\.124:7505\/\?pair=PAIR/u);
	assert.match(result.text, /http:\/\/127\.0\.0\.1:4321\/lan-access/u);
	const withoutPage = report({ status: "listening", port: 7505, pair: "PAIR" }, { authenticatedUrl: (base) => `${base}?token=T` }, ADDRESSES);
	assert.match(withoutPage.text, /30 days/u, "without a QR page the plain cookie lifetime note is the fallback");
	assert.match(result.text, /172\.19\.112\.1/u, "other adapters are named, not implied");
	assert.equal(row.calls.warnings.length, 1, "the exposure is logged once");
	assert.match(row.calls.warnings[0], /plain HTTP/u);
});

test("/lan reports a machine without a LAN address", () => {
	const result = report({ status: "listening", port: 7505 }, { authenticatedUrl: (base) => base }, []);
	assert.equal(result.kind, "error");
	assert.match(result.text, /no physical LAN IPv4 address/u);
});

test("/lan reports the boot-time failure instead of pretending to listen", () => {
	const failed = report({ status: "failed", error: "listen EADDRNOTAVAIL 1.2.3.4:7505" }, { authenticatedUrl: (base) => base }, ADDRESSES);
	assert.equal(failed.kind, "error");
	assert.match(failed.text, /not running/u);
	assert.match(failed.text, /EADDRNOTAVAIL/u);
	const closed = report({ status: "closed" }, { authenticatedUrl: (base) => base }, ADDRESSES);
	assert.match(closed.text, /disabled/u);
});

test("a Host already bound to a network address is reported without a second listener", async (t) => {
	const row = setup({ webServer: { host: "192.168.7.14", port: 7505 }, config: { host: "127.0.0.1", port: 0 } });
	t.after(() => row.dispose());
	await row.settled();
	const result = row.run();
	assert.equal(result.kind, "success");
	assert.match(result.text, /already listens on a network address/u);
	assert.match(result.text, /http:\/\/192\.168\.7\.14:7505\/\?token=T/u);
	assert.equal(row.calls.warnings.length, 0);
	assert.equal(row.calls.routes.length, 1, "the QR page is still useful in the direct case");
});

test("a host that admits no route leaves the cookie check to the page", () => {
	const state = { status: "listening", port: 7505, pair: "PAIR" };
	const connection = {
		authenticatedUrl: (base) => `${base}?token=T`,
		admit: (request) => (request.headers.cookie === "ok" ? { peer: {} } : { rejection: 401 }),
	};
	const denied = responseOf();
	servePage({ headers: {} }, denied, { state, connection, addresses: ADDRESSES });
	assert.equal(denied.captured.status, 401);
	assert.match(denied.captured.body, /Open this page from the DSH window/u);

	const allowed = responseOf();
	servePage({ headers: { cookie: "ok" } }, allowed, { state, connection, addresses: ADDRESSES });
	assert.equal(allowed.captured.status, 200);
	assert.match(allowed.captured.headers["content-type"], /text\/html/u);
	assert.equal(allowed.captured.body.split("<svg ").length - 1, 1, "only the reachable adapter gets a QR image");
	assert.match(allowed.captured.body, /http:\/\/192\.168\.102\.124:7505\/\?pair=PAIR/u);
	assert.ok(!allowed.captured.body.includes("172.19.112.1"), "a virtual adapter is not listed at all");
	assert.ok(!allowed.captured.body.includes("签名 cookie"), "the popup below the frame carries that hint");
});

test("an admitted Peer needs no second check, which a 0.2.2+ Host would refuse", () => {
	const connection = {
		authenticatedUrl: (base) => `${base}?token=T`,
		admit: () => {
			throw new Error("the same cookie no longer passes a repeated admit");
		},
	};
	const page = responseOf();
	servePage({ headers: {}, url: "/lan-access?embed=1" }, page, {
		state: { status: "listening", port: 7505, pair: "PAIR" },
		connection,
		addresses: ADDRESSES,
		peer: { principal: { kind: "owner" } },
	});
	assert.equal(page.captured.status, 200, "the Host admitted this request and passed its Peer");
	assert.equal(page.captured.body.split("<svg ").length - 1, 1, "only the reachable adapter gets a QR image");
});

test("the embed variant drops the page heading for the in-app popup", () => {
	const response = responseOf();
	servePage({ headers: { cookie: "ok" }, url: "/lan-access?embed=1" }, response, {
		state: { status: "listening", port: 7505, pair: "PAIR" },
		connection: { authenticatedUrl: (base) => `${base}?token=T`, admit: () => ({ peer: {} }) },
		addresses: ADDRESSES,
	});
	assert.equal(response.captured.status, 200);
	assert.ok(!response.captured.body.includes("<h1>"), "the popup host draws its own title");
	assert.match(response.captured.body, /<svg /u);
	assert.ok(!response.captured.body.includes("签名 cookie"), "no instructional paragraph in the frame");
});

test("a machine with only virtual adapters shows no QR at all", () => {
	const page = responseOf();
	servePage({ headers: { cookie: "ok" } }, page, {
		state: { status: "listening", port: 7505, pair: "PAIR" },
		connection: { authenticatedUrl: (base) => base, admit: () => ({ peer: {} }) },
		addresses: VIRTUAL_ONLY,
	});
	assert.equal(page.captured.status, 200);
	assert.ok(!page.captured.body.includes("<svg "), "a virtual address is never offered as a scan target");
	assert.match(page.captured.body, /只有虚拟网卡/u);

	const result = report({ status: "listening", port: 7505, pair: "PAIR" }, { authenticatedUrl: (base) => base }, VIRTUAL_ONLY);
	assert.equal(result.kind, "error");
	assert.match(result.text, /no physical LAN IPv4 address/u);
});

test("the QR page states a failed listener instead of showing a dead link", () => {
	const response = responseOf();
	servePage({ headers: { cookie: "ok" } }, response, {
		state: { status: "failed", error: "listen EADDRINUSE 0.0.0.0:7505" },
		connection: { authenticatedUrl: (base) => base, admit: () => ({ peer: {} }) },
		addresses: ADDRESSES,
	});
	assert.equal(response.captured.status, 200);
	assert.match(response.captured.body, /监听失败/u);
	assert.match(response.captured.body, /EADDRINUSE/u);
});

test("the rendered page escapes the error text", () => {
	const html = renderPage({ status: "failed", error: "<script>alert(1)</script>" }, { authenticatedUrl: (base) => base }, []);
	assert.ok(!html.includes("<script>alert(1)</script>"), "an error is text, never markup");
	assert.match(html, /&lt;script&gt;/u);
});

test("disposing the row closes the LAN listener", async () => {
	const row = setup({ config: { host: "127.0.0.1", port: 0 } });
	await row.settled();
	const state = row.calls.warnings.length > 0 ? row.calls.warnings[0] : "";
	assert.match(state, /serving the browser surface on port \d+/u);
	const port = Number(/port (\d+)/u.exec(state)[1]);
	await row.dispose();
	await assert.rejects(new Promise((resolve, reject) => {
		const socket = connect(port, "127.0.0.1");
		socket.once("connect", () => {
			socket.destroy();
			resolve();
		});
		socket.once("error", reject);
	}), /ECONNREFUSED/u);
});

test("a failed bind is reported by /lan instead of failing the row", async () => {
	const row = setup({ config: { host: "203.0.113.9", port: 0 } });
	await row.settled();
	const result = row.run();
	assert.equal(result.kind, "error");
	assert.match(result.text, /not running/u);
	assert.match(row.calls.warnings[0], /lan-access:/u);
});

test("an invalid port is refused while loading the row", () => {
	assert.throws(() => setup({ config: { port: "7505x" } }), /port/u);
});

test("/lan rejects arguments", async (t) => {
	const row = setup({ config: { host: "127.0.0.1", port: 0 } });
	t.after(() => row.dispose());
	await row.settled();
	assert.deepEqual(row.run("extra"), { kind: "error", text: "Usage: /lan (no arguments)" });
});
