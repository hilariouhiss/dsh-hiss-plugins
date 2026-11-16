/**
 * The browser half's contract: the module-loader registration, the Plugins-page tab it
 * contributes, and the ordering, refusal and rendering behaviour of that tab.
 * @module dsh-hiss-plugins/test/client
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The registration key: the client module system matches it against the Loader row's package. */
const PACKAGE_ID = "dsh-hiss-plugins";
/** Dictionary namespace the tab registers and binds. */
const NS = "hissPlugins";
/** The nine feature rows the tab manages, in the order it lists them. */
const FEATURE_KEYS = ["colgrep", "codegraph", "project-mcp", "gitbash", "superpowers", "ponytail", "init", "fix", "lan-access"];
/** Refusal codes the page explains in its own words. */
const READ_ONLY_CODES = ["management-required", "unaddressable"];

/** The render pass in flight; the bundle's `require("react")` reaches these hooks. */
let activePass = null;
const react = {
	useState(initial) {
		if (activePass === null) throw new Error("useState called outside a render pass");
		return activePass.useState(initial);
	},
	useEffect(effect, deps) {
		if (activePass === null) throw new Error("useEffect called outside a render pass");
		return activePass.useEffect(effect, deps);
	},
};

/** Elements as plain records, so a test can read the tree a component returned. */
function jsx(type, props, key) {
	return { type, props: key === undefined ? (props ?? {}) : { ...props, key } };
}
const jsxRuntime = { jsx, jsxs: jsx };

let captured;
globalThis.window = { __ModuleLoader__: { load: (record) => { captured = record; } } };
await import("../lib/client.js");

/** Materialize the lazily registered bundle through the client baseline's module table. */
function loadBundle() {
	return captured.factory((specifier) => {
		if (specifier === "react") return react;
		if (specifier === "react/jsx-runtime") return jsxRuntime;
		throw new Error(`the client baseline has no module ${specifier}`);
	});
}

/** One running-profile row as pluginManager/listPlugins reports it, shuffled on purpose. */
const ROWS = [
	{ entryId: "core-tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberPhase: "active", patchId: "core-tools" },
	{ entryId: "hiss-plugins", moduleName: PACKAGE_ID, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins" },
	{ entryId: "hiss-gitbash", moduleName: `${PACKAGE_ID}/gitbash`, enabled: false, fiberPhase: null, patchId: "dsh-hiss-plugins-gitbash" },
	{ entryId: "hiss-superpowers", moduleName: `${PACKAGE_ID}/superpowers`, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins-superpowers" },
	{ entryId: "hiss-colgrep", moduleName: `${PACKAGE_ID}/colgrep`, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins-colgrep" },
	{ entryId: "hiss-project-mcp", moduleName: `${PACKAGE_ID}/project-mcp`, enabled: true, fiberPhase: "active", readOnlyReason: "unaddressable" },
	{ entryId: "hiss-codegraph", moduleName: `${PACKAGE_ID}/codegraph`, enabled: false, fiberPhase: "pending", patchId: "dsh-hiss-plugins-codegraph" },
	{ entryId: "hiss-ponytail", moduleName: `${PACKAGE_ID}/ponytail`, enabled: false, fiberPhase: "pending", patchId: "dsh-hiss-plugins-ponytail" },
	{ entryId: "hiss-init", moduleName: `${PACKAGE_ID}/init`, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins-init" },
	{ entryId: "hiss-fix", moduleName: `${PACKAGE_ID}/fix`, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins-fix" },
	{ entryId: "hiss-lan-access", moduleName: `${PACKAGE_ID}/lan-access`, enabled: false, fiberPhase: null, patchId: "dsh-hiss-plugins-lan-access" },
];

/** What those rows must become: this package's nine features, in the tab's fixed order. */
const MAPPED = [
	{ entryId: "hiss-colgrep", key: "colgrep", enabled: true, toggleable: true, reason: undefined },
	{ entryId: "hiss-codegraph", key: "codegraph", enabled: false, toggleable: true, reason: undefined },
	{ entryId: "hiss-project-mcp", key: "project-mcp", enabled: true, toggleable: false, reason: "unaddressable" },
	{ entryId: "hiss-gitbash", key: "gitbash", enabled: false, toggleable: true, reason: undefined },
	{ entryId: "hiss-superpowers", key: "superpowers", enabled: true, toggleable: true, reason: undefined },
	{ entryId: "hiss-ponytail", key: "ponytail", enabled: false, toggleable: true, reason: undefined },
	{ entryId: "hiss-init", key: "init", enabled: true, toggleable: true, reason: undefined },
	{ entryId: "hiss-fix", key: "fix", enabled: true, toggleable: true, reason: undefined },
	{ entryId: "hiss-lan-access", key: "lan-access", enabled: false, toggleable: true, reason: undefined },
];

/** A successful read answer. */
function listOk(rows = ROWS) {
	return { ok: true, value: rows };
}

/** A successful change answer. */
function changeOk(application = "applied", error = undefined) {
	return {
		ok: true,
		value: { changed: true, application, stage: "enable", target: "hiss-colgrep", ...(error === undefined ? {} : { error }) },
	};
}

/**
 * Run the bundle's apply against a fake context.
 * @param options - scripted manager answers and the language the bound lookup resolves.
 * @returns the recorded calls, the inject face and the registered component.
 */
function applyBundle(options = {}) {
	const list = options.list ?? (() => listOk());
	const setEnabled = options.setEnabled ?? (() => changeOk());
	const calls = { effects: [], injected: [], registered: [], definitions: [], toggled: [], listed: 0, dictionaries: null };
	const manager = {
		async listPlugins() {
			calls.listed += 1;
			return list();
		},
		async setPluginEnabled(entryId, enabled) {
			calls.toggled.push([entryId, enabled]);
			return setEnabled(entryId, enabled);
		},
	};
	const language = options.language ?? "en";
	const ctx = {
		effect(callback, name) {
			calls.effects.push(name);
			return callback();
		},
		locale: {
			register(namespace, dictionaries) {
				calls.dictionaries = { namespace, dictionaries };
				return () => {};
			},
			bind(namespace) {
				return (key, params) => {
					assert.equal(namespace, NS);
					const text = calls.dictionaries?.dictionaries?.[language]?.[key];
					assert.equal(typeof text, "string", `dictionary key ${key} is missing`);
					return params === undefined ? text : text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
				};
			},
			resolveText(value) {
				return typeof value === "string" ? value : String(value?.en ?? value);
			},
		},
		slots: {
			inject(name, callback) {
				calls.injected.push(name);
				return callback();
			},
			register(registration, component) {
				calls.registered.push({ registration, component });
				return () => {};
			},
		},
		uiConversation: {
			events: {
				register(definition) {
					calls.definitions.push(definition);
					return () => {};
				},
			},
		},
		remote: { pluginManager: manager },
		logger: { error() {}, warn() {}, info() {} },
	};
	const exported = loadBundle();
	exported.apply(ctx);
	return { calls };
}

/** The Plugins-page tab registration; the bundle also contributes a chat node renderer. */
function tabOf(calls) {
	return calls.registered.find((entry) => entry.registration.name === "plugins.tab");
}

/** The inject face the tab registration exposes. */
function faceOf(calls) {
	const { registration } = tabOf(calls);
	return registration.inject();
}

/** Flatten a stub tree into its element records and text leaves. */
function flatten(node) {
	if (Array.isArray(node)) return node.flatMap(flatten);
	if (node === null || node === undefined || typeof node === "boolean") return [];
	if (typeof node === "object") return [node, ...flatten(node.props?.children)];
	return [node];
}

/** The text a stub tree renders, joined for one assertion. */
function textOf(tree) {
	return flatten(tree).filter((node) => typeof node === "string").join(" ");
}

/** Mount the tab with the props a slot renderer passes: the inject face plus the owner props. */
function mount(calls) {
	const { registration, component } = tabOf(calls);
	return mountComponent(component, { ...registration.inject(), install() {}, openPackage() {} });
}

/** The slot registration contributed under one slot name. */
function registrationOf(calls, name) {
	return calls.registered.find((entry) => entry.registration.name === name);
}

/**
 * Mount one registered component with the props its slot passes.
 * @param component - the registered render function.
 * @param props - the props the slot hands it.
 * @returns the settled tree pump.
 */
function mountComponent(component, props) {
	const slots = new Map();
	let tree;
	/** Set by any state write, including the ones an awaited request resolves after a pass. */
	let dirty = true;
	/** Let awaited work settle before deciding the tree is stable. */
	const flush = () => new Promise((resolve) => setImmediate(resolve));
	/** Re-render until no state write is left, running effects whose dependencies changed. */
	const settle = async () => {
		for (let pass = 0; pass < 12; pass += 1) {
			let cursor = 0;
			dirty = false;
			activePass = {
				useState(initial) {
					const at = cursor;
					cursor += 1;
					const slot = slots.get(at) ?? { value: initial };
					slots.set(at, slot);
					return [slot.value, (next) => {
						const value = typeof next === "function" ? next(slot.value) : next;
						if (!Object.is(value, slot.value)) {
							slot.value = value;
							dirty = true;
						}
					}];
				},
				useEffect(effect, deps) {
					const at = cursor;
					cursor += 1;
					const slot = slots.get(at);
					if (slot !== undefined && deps !== undefined && slot.deps !== undefined && deps.length === slot.deps.length && deps.every((value, index) => Object.is(value, slot.deps[index]))) return;
					slot?.cleanup?.();
					slots.set(at, { deps, cleanup: effect() });
				},
			};
			try {
				tree = component(props);
			} finally {
				activePass = null;
			}
			await flush();
			if (!dirty) break;
		}
		return tree;
	};
	return { settle };
}

test("the bundle registers a lazy factory under the package id", () => {
	assert.equal(captured.id, PACKAGE_ID);
	assert.equal(typeof captured.factory, "function");
});

test("the bundle exports apply and the client services it uses", () => {
	const exported = loadBundle();
	assert.equal(typeof exported.apply, "function");
	assert.deepEqual(exported.inject, ["slots", "locale", "remote", "remote.pluginManager", "uiConversation"]);
});

test("apply registers the dictionaries, the chat projection, the tab and the phone-link pair", () => {
	const { calls } = applyBundle();
	assert.deepEqual(calls.effects, ["hiss-plugins: dictionaries"]);
	assert.equal(calls.dictionaries.namespace, NS);
	assert.deepEqual(calls.injected, ["conversation.chat.node", "plugins.tab", "sidebar.footer.action", "shell.overlay"]);
	assert.equal(calls.registered.length, 4);
	assert.equal(calls.definitions.length, 1);
	const { registration, component } = tabOf(calls);
	assert.equal(registration.name, "plugins.tab");
	assert.equal(registration.id, "dsh-hiss-plugins");
	assert.equal(registration.order, 20);
	assert.equal(registration.locale, NS);
	assert.equal(typeof registration.label, "function");
	assert.equal(registration.label(), "dsh-hiss-plugins");
	assert.equal(typeof registration.inject, "function");
	assert.equal(typeof component, "function");
});

test("the /mcp and /lan runs project a chat node, so a never-messaged session renders the transcript", () => {
	const { calls } = applyBundle();
	const [definition] = calls.definitions;
	assert.equal(definition.kind, "hiss-mcp-command");
	assert.equal(definition.target, "chat");
	const run = { type: "command/run", seq: 5, time: 1, data: { commandId: "cmd-1", name: "mcp", args: "" } };
	assert.deepEqual(definition.match(run), { id: "cmd-1", role: "start" });
	assert.deepEqual(definition.match({ type: "command/run", seq: 8, time: 1, data: { commandId: "cmd-3", name: "lan", args: "" } }), { id: "cmd-3", role: "start" });
	assert.equal(definition.match({ type: "command/run", seq: 6, time: 1, data: { commandId: "cmd-2", name: "goal" } }), null);
	assert.equal(definition.match({ type: "command/done", seq: 7, time: 1, data: { commandId: "cmd-1", kind: "success", text: "done" } }), null);
	const match = { ...definition.match(run), event: run };
	const context = { key: "hiss-mcp-command:cmd-1", id: "cmd-1", start: match, matches: [match], state: definition.start({}, match) };
	const node = definition.buildViewNode(context);
	assert.equal(node.key, context.key);
	assert.equal(node.kind, "hiss-mcp-command");
	assert.notEqual(node.kind, "command", "command nodes alone leave the chat view inactive, which is the bug");
	assert.equal(node.target, "chat");
	assert.equal(node.visibility, "visible");
	assert.ok(node.anchorSeq < run.seq);
	assert.equal(node.data.commandId, "cmd-1");
});

test("the projection renders nothing: the generic command card keeps the report", () => {
	const { calls } = applyBundle();
	const entry = calls.registered.find((item) => item.registration.name === "conversation.chat.node");
	assert.equal(entry.registration.key, "hiss-mcp-command");
	assert.equal(entry.registration.locale, NS);
	assert.equal(entry.component(), null);
});

test("the inject face exposes the nine feature keys in the tab's order", () => {
	const { calls } = applyBundle();
	const face = faceOf(calls);
	assert.deepEqual(face.features, FEATURE_KEYS);
	assert.equal(typeof face.list, "function");
	assert.equal(typeof face.setEnabled, "function");
	assert.equal(typeof face.t, "function");
});

test("list keeps this package's rows and returns them in the fixed order", async () => {
	const { calls } = applyBundle();
	const rows = await faceOf(calls).list();
	assert.deepEqual(rows, MAPPED);
	assert.deepEqual(rows.map((row) => row.key), FEATURE_KEYS);
});

test("list drops every foreign module name", async () => {
	const { calls } = applyBundle({
		list: () => listOk([
			{ entryId: "core-tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberPhase: "active", patchId: "core-tools" },
			{ entryId: "hiss-plugins", moduleName: PACKAGE_ID, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins" },
			{ entryId: "other", moduleName: `${PACKAGE_ID}/colgrep-extra`, enabled: true, fiberPhase: "active", patchId: "other" },
			{ entryId: "hiss-colgrep", moduleName: `${PACKAGE_ID}/colgrep`, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins-colgrep" },
		]),
	});
	const rows = await faceOf(calls).list();
	assert.deepEqual(rows.map((row) => row.key), ["colgrep"]);
});

test("list throws a readable error when the manager refuses to answer", async () => {
	const { calls } = applyBundle({ list: () => ({ ok: false, error: { code: "gateway/internal", message: "socket closed" } }) });
	await assert.rejects(faceOf(calls).list(), /socket closed/);
});

for (const code of READ_ONLY_CODES) {
	test(`setEnabled explains a ${code} refusal carried by the answer`, async () => {
		const { calls } = applyBundle({ setEnabled: () => ({ ok: false, error: { code, message: code } }) });
		const face = faceOf(calls);
		await assert.rejects(face.setEnabled("hiss-colgrep", false), (error) => {
			assert.equal(error.code, code);
			assert.equal(error.message, face.t(code === "management-required" ? "reasonManagementRequired" : "reasonUnaddressable"));
			assert.ok(!error.message.includes(code), "readable copy must not leak the raw code");
			return true;
		});
	});

	test(`setEnabled explains a ${code} refusal carried by a failed change`, async () => {
		const { calls } = applyBundle({ setEnabled: () => changeOk("failed", { code }) });
		const face = faceOf(calls);
		await assert.rejects(face.setEnabled("hiss-plugins", true), (error) => {
			assert.equal(error.code, code);
			assert.ok(error.message.length > 0);
			assert.ok(!error.message.includes(code), "readable copy must not leak the raw code");
			return true;
		});
	});
}

test("setEnabled forwards both arguments and returns the application", async () => {
	const { calls } = applyBundle({ setEnabled: (entryId, enabled) => changeOk(enabled ? "applied" : "restart-required") });
	const face = faceOf(calls);
	assert.equal(await face.setEnabled("hiss-colgrep", false), "restart-required");
	assert.equal(await face.setEnabled("hiss-codegraph", true), "applied");
	assert.deepEqual(calls.toggled, [["hiss-colgrep", false], ["hiss-codegraph", true]]);
});

test("the tab renders one labelled switch per feature once the list arrives", async () => {
	const { calls } = applyBundle();
	const tab = mount(calls);
	const tree = await tab.settle();
	const inputs = flatten(tree).filter((node) => node.type === "input");
	assert.deepEqual(inputs.map((node) => node.props["aria-label"]), FEATURE_KEYS.map((key) => `Toggle ${key}`));
	assert.deepEqual(inputs.map((node) => node.props.type), FEATURE_KEYS.map(() => "checkbox"));
	assert.deepEqual(inputs.map((node) => node.props.checked), MAPPED.map((row) => row.enabled));
	assert.deepEqual(inputs.map((node) => node.props.disabled), MAPPED.map((row) => !row.toggleable));
	const text = textOf(tree);
	for (const copy of ["semantic code search tool", "CodeGraph MCP tools", "mounts the project's .mcp.json per session", "Git Bash shell on Windows", "always-on superpowers skill mandate", "ponytail adoption hint and /ponytail level switching", "generates or updates the project's AGENTS.md (/init)", "diagnoses the root cause and waits for confirmation before fixing (/fix)", "opens this GUI from a phone on the same network (/lan prints the tokenized URL)"]) {
		assert.ok(text.includes(copy), `the card copy ${copy} is missing`);
	}
	assert.ok(text.includes("Enabled"));
	assert.ok(text.includes("Disabled"));
	assert.ok(text.includes("cannot be addressed"), "a read-only row states why it cannot move");
});

test("the Chinese dictionary resolves the tab copy too", async () => {
	const { calls } = applyBundle({ language: "zh" });
	const tab = mount(calls);
	const tree = await tab.settle();
	const text = textOf(tree);
	assert.ok(text.includes("语义代码检索工具"));
	assert.ok(text.includes("代码图 MCP 工具"));
	assert.ok(text.includes("按会话挂载项目 .mcp.json"));
	assert.ok(text.includes("Windows 上的 Git Bash shell"));
	assert.ok(text.includes("superpowers 技能常驻引导（任何回复前先检查并加载技能）"));
	assert.ok(text.includes("ponytail 采纳提示与 /ponytail 等级切换"));
	assert.ok(text.includes("生成或更新项目 AGENTS.md（/init）"));
	assert.ok(text.includes("先查根因并报告，确认后再修复（/fix）"));
});

test("the tab shows the loading line until the manager answers", async () => {
	const { calls } = applyBundle({ list: () => new Promise(() => {}) });
	const tab = mount(calls);
	const tree = await tab.settle();
	assert.ok(textOf(tree).includes("Reading plugins…"));
	assert.equal(flatten(tree).filter((node) => node.type === "input").length, 0);
});

test("a roster without this package's rows renders the empty line and no list", async () => {
	const { calls } = applyBundle({
		list: () => listOk([{ entryId: "core-tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberPhase: "active", patchId: "core-tools" }]),
	});
	const tab = mount(calls);
	const tree = await tab.settle();
	assert.equal(flatten(tree).filter((node) => node.type === "input").length, 0);
	assert.equal(flatten(tree).filter((node) => node.type === "ul").length, 0);
	assert.ok(textOf(tree).includes("This bundle declares no plugin rows."));
});

test("toggling a switch persists through the manager and re-reads the host", async () => {
	const { calls } = applyBundle();
	const tab = mount(calls);
	const inputs = flatten(await tab.settle()).filter((node) => node.type === "input");
	await inputs[0].props.onChange({ currentTarget: { checked: false } });
	await tab.settle();
	assert.deepEqual(calls.toggled, [["hiss-colgrep", false]]);
	assert.equal(calls.listed, 2, "the page re-reads the host after a toggle");
});

test("a change that waits for a restart is reported to the reader", async () => {
	const { calls } = applyBundle({ setEnabled: () => changeOk("restart-required") });
	const tab = mount(calls);
	const inputs = flatten(await tab.settle()).filter((node) => node.type === "input");
	await inputs[1].props.onChange({ currentTarget: { checked: true } });
	const text = textOf(await tab.settle());
	assert.ok(text.includes("codegraph"));
	assert.ok(text.includes("after DSH restarts"));
});

test("a refused toggle reports why and still re-reads the host", async () => {
	const { calls } = applyBundle({ setEnabled: () => changeOk("failed", { code: "management-required" }) });
	const tab = mount(calls);
	const inputs = flatten(await tab.settle()).filter((node) => node.type === "input");
	await inputs[0].props.onChange({ currentTarget: { checked: false } });
	const text = textOf(await tab.settle());
	assert.ok(text.includes("DSH manages this plugin itself"));
	assert.ok(!text.includes("management-required"));
	assert.equal(calls.listed, 2);
});

test("a failed read shows the diagnostic and a retry that re-reads", async () => {
	let answer = { ok: false, error: { code: "gateway/offline", message: "offline" } };
	const { calls } = applyBundle({ list: () => answer });
	const tab = mount(calls);
	const tree = await tab.settle();
	assert.ok(textOf(tree).includes("offline"));
	const retry = flatten(tree).find((node) => node.type === "button");
	assert.equal(retry.props.type, "button");
	answer = listOk();
	await retry.props.onClick();
	const recovered = await tab.settle();
	assert.equal(calls.listed, 2);
	assert.equal(flatten(recovered).filter((node) => node.type === "input").length, 9);
});


test("the sidebar foot offers a phone-link action that opens the popup", async () => {
	const { calls } = applyBundle();
	const entry = registrationOf(calls, "sidebar.footer.action");
	assert.equal(entry.registration.id, "lan-access");
	assert.equal(entry.registration.order, 10);
	assert.equal(entry.registration.label(), "Phone link");

	const wide = await mountComponent(entry.component, { wide: true }).settle();
	const wideButton = flatten(wide).find((node) => node.type === "button");
	assert.equal(wideButton.props.title, "Phone link");
	assert.match(wideButton.props["aria-label"], /QR code/u);
	assert.equal(wideButton.props["aria-expanded"], false);
	assert.ok(textOf(wide).includes("Phone link"));

	const rail = await mountComponent(entry.component, { wide: false }).settle();
	assert.ok(!textOf(rail).includes("Phone link"), "the 56px rail shows the icon only");
});

test("clicking the phone action enables a disabled row and shows the QR frame", async (t) => {
	const originalFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	const fetched = [];
	globalThis.fetch = async (url, init) => {
		fetched.push([String(url), init?.method]);
		return { ok: true, status: 200 };
	};
	const { calls } = applyBundle();
	const popup = mountComponent(registrationOf(calls, "shell.overlay").component, {});
	assert.equal(await popup.settle(), null, "the overlay host draws nothing until opened");

	const buttonTree = await mountComponent(registrationOf(calls, "sidebar.footer.action").component, { wide: true }).settle();
	flatten(buttonTree).find((node) => node.type === "button").props.onClick();
	const tree = await popup.settle();
	assert.deepEqual(calls.toggled, [["hiss-lan-access", true]], "the click turns the row on");
	assert.deepEqual(fetched, [["/lan-access?embed=1", "HEAD"]]);
	const frame = flatten(tree).find((node) => node.type === "iframe");
	assert.equal(frame.props.src, "/lan-access?embed=1");
	assert.match(textOf(tree), /Scan to connect a phone/u);
});

test("the popup reports a restart instead of an empty frame", async (t) => {
	const originalFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	globalThis.fetch = async () => ({ ok: true, status: 200 });
	const { calls } = applyBundle({ setEnabled: () => changeOk("restart-required") });
	const popup = mountComponent(registrationOf(calls, "shell.overlay").component, {});
	await popup.settle();
	const buttonTree = await mountComponent(registrationOf(calls, "sidebar.footer.action").component, { wide: true }).settle();
	flatten(buttonTree).find((node) => node.type === "button").props.onClick();
	const tree = await popup.settle();
	assert.match(textOf(tree), /restart before the QR code/u);
	assert.equal(flatten(tree).find((node) => node.type === "iframe"), undefined);
});

test("the popup reports a refused enablement", async (t) => {
	const originalFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	globalThis.fetch = async () => ({ ok: true, status: 200 });
	const { calls } = applyBundle({ setEnabled: () => ({ ok: false, error: { code: "gateway/internal", message: "socket closed" } }) });
	const popup = mountComponent(registrationOf(calls, "shell.overlay").component, {});
	await popup.settle();
	const buttonTree = await mountComponent(registrationOf(calls, "sidebar.footer.action").component, { wide: true }).settle();
	flatten(buttonTree).find((node) => node.type === "button").props.onClick();
	const tree = await popup.settle();
	assert.match(textOf(tree), /Could not enable LAN access.*socket closed/u);
});

test("the popup reports a QR page the browser may not open", async (t) => {
	const originalFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	globalThis.fetch = async () => ({ ok: false, status: 401 });
	const { calls } = applyBundle();
	const popup = mountComponent(registrationOf(calls, "shell.overlay").component, {});
	await popup.settle();
	const buttonTree = await mountComponent(registrationOf(calls, "sidebar.footer.action").component, { wide: true }).settle();
	flatten(buttonTree).find((node) => node.type === "button").props.onClick();
	const tree = await popup.settle();
	assert.match(textOf(tree), /QR page did not answer/u);
	assert.equal(flatten(tree).find((node) => node.type === "iframe"), undefined);
});

test("the inlined dictionaries stay in sync with the locale JSON files", () => {
	const { calls } = applyBundle();
	const { namespace, dictionaries } = calls.dictionaries;
	assert.equal(namespace, NS);
	assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort());
	for (const language of ["en", "zh"]) {
		const parsed = JSON.parse(readFileSync(join(HERE, "..", "locale", `${language}.json`), "utf8"));
		assert.equal(typeof parsed.meta?.title, "string", `locale/${language}.json carries meta.title`);
		assert.equal(typeof parsed.meta?.description, "string", `locale/${language}.json carries meta.description`);
		delete parsed.meta;
		assert.deepEqual(parsed, dictionaries[language], `locale/${language}.json mirrors the inlined dictionary`);
		for (const [key, value] of Object.entries(dictionaries[language])) {
			assert.equal(typeof value, "string", `dictionary entry ${key} is a string`);
			assert.notEqual(value, "", `dictionary entry ${key} is not empty`);
		}
	}
});