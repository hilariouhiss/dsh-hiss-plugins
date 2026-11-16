/**
 * The bundle's browser half: one management tab in the Plugins page, with a switch per feature.
 *
 * Hand-written lazy-CJS bundle, no build step: executing this file only registers a factory, and the
 * module body below runs when the client module system materializes the bundle. Only `react` and
 * `react/jsx-runtime` come from the client baseline, so every control is plain markup styled with
 * host theme tokens — a token rename degrades the look, it never blanks the tab.
 *
 * The tab owns no state: it reads the running profile through `pluginManager/listPlugins` and
 * re-reads after every switch, so what the page shows is always what the host holds.
 *
 * @module dsh-hiss-plugins/client
 */
window.__ModuleLoader__.load({
	id: "dsh-hiss-plugins",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const { jsx, jsxs } = require("react/jsx-runtime");

		/** Dictionary namespace owned by this plugin. */
		const NS = "hissPlugins";
		/** The one package whose rows this tab manages. */
		const PACKAGE_ID = "dsh-hiss-plugins";
		/**
		 * The features this bundle carries, in the order the tab lists them.
		 * Each row is a top-level Loader row, which is what makes its switch addressable at all.
		 */
		const FEATURES = [
			{ key: "colgrep", moduleName: `${PACKAGE_ID}/colgrep`, description: "featureColgrepDescription" },
			{ key: "codegraph", moduleName: `${PACKAGE_ID}/codegraph`, description: "featureCodegraphDescription" },
			{ key: "project-mcp", moduleName: `${PACKAGE_ID}/project-mcp`, description: "featureProjectMcpDescription" },
			{ key: "gitbash", moduleName: `${PACKAGE_ID}/gitbash`, description: "featureGitbashDescription" },
			{ key: "superpowers", moduleName: `${PACKAGE_ID}/superpowers`, description: "featureSuperpowersDescription" },
			{ key: "ponytail", moduleName: `${PACKAGE_ID}/ponytail`, description: "featurePonytailDescription" },
			{ key: "init", moduleName: `${PACKAGE_ID}/init`, description: "featureInitDescription" },
			{ key: "fix", moduleName: `${PACKAGE_ID}/fix`, description: "featureFixDescription" },
			{ key: "lan-access", moduleName: `${PACKAGE_ID}/lan-access`, description: "featureLanAccessDescription" },
		];
		/** The same features keyed by the name a card shows. */
		const FEATURE_BY_KEY = new Map(FEATURES.map((feature) => [feature.key, feature]));

		/** Host theme tokens keep the tab inside the page's look without a stylesheet. */
		const SECTION_STYLE = { display: "flex", flexDirection: "column", gap: "12px", maxWidth: "760px", color: "var(--dsw-alias-label-primary)" };
		const LIST_STYLE = { display: "flex", flexDirection: "column", gap: "10px", margin: 0, padding: 0, listStyle: "none" };
		const CARD_STYLE = { display: "flex", alignItems: "center", gap: "14px", padding: "12px 14px", border: "0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3))", borderRadius: "12px", background: "var(--dsw-alias-settings-card-fill, transparent)" };
		const TEXT_STYLE = { display: "flex", flexDirection: "column", gap: "2px", flex: "1 1 auto", minWidth: 0 };
		const DESCRIPTION_STYLE = { color: "var(--dsw-alias-label-tertiary)", fontSize: "13px", lineHeight: "20px" };
		const SWITCH_STYLE = { display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--dsw-alias-label-tertiary)", fontSize: "13px", whiteSpace: "nowrap" };
		const STATUS_STYLE = { margin: 0, color: "var(--dsw-alias-label-tertiary)", fontSize: "13px", lineHeight: "20px" };
		const FAILURE_STYLE = { display: "flex", alignItems: "center", gap: "10px" };
		const NOTICE_STYLE = { margin: 0, color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-tertiary))", fontSize: "13px", lineHeight: "20px" };
		const REASON_STYLE = { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: "18px", maxWidth: "220px" };
		const BUTTON_STYLE = { border: "0.5px solid var(--dsw-alias-border-l3)", borderRadius: "6px", color: "var(--dsw-alias-label-primary)", font: "inherit", cursor: "pointer", background: "none", padding: "4px 10px" };
		/** Sidebar-foot action: icon in the rail, icon + label in a wide column. */
		const LAN_BUTTON_STYLE = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "32px", padding: "0 8px", border: "none", borderRadius: "8px", background: "transparent", color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-tertiary))", font: "inherit", fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
		const LAN_RAIL_STYLE = { width: "32px", padding: "0" };
		/** Frame-wide click-catcher for the phone-link popup. */
		const LAN_OVERLAY_STYLE = { position: "fixed", inset: "0", zIndex: 2147483000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0, 0, 0, 0.45)", pointerEvents: "auto" };
		const LAN_DIALOG_STYLE = { width: "380px", maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 48px)", overflow: "auto", display: "flex", flexDirection: "column", gap: "12px", padding: "16px", borderRadius: "12px", background: "var(--dsw-alias-bg-primary, #fff)", color: "var(--dsw-alias-label-primary)", boxShadow: "0 18px 48px rgba(0, 0, 0, 0.28)" };
		const LAN_HEADER_STYLE = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" };
		const LAN_HINT_STYLE = { margin: 0, color: "var(--dsw-alias-label-tertiary)", fontSize: "13px", lineHeight: "20px" };
		const LAN_FRAME_STYLE = { width: "100%", height: "440px", border: "none", borderRadius: "8px", background: "#fff" };

		/**
		 * Copy for the management tab; the `locale/*.json` files carry the same entries, where the
		 * `meta` object is the package display text the Plugins page reads.
		 */
		/** Simplified Chinese dictionary, the key source of truth. */
		const zh = {
			loading: "正在读取插件…",
			error: "暂时无法读取插件：{error}",
			retry: "重试",
			empty: "本包没有声明任何插件行。",
			enabledTag: "已启用",
			disabledTag: "已停用",
			toggleAria: "切换 {name}",
			toggleFailed: "切换 {name} 失败：{error}",
			restartRequired: "{name} 的改动将在重启 DSH 后生效。",
			reasonManagementRequired: "该插件由 DSH 自身管理，无法在这个页面切换。",
			reasonUnaddressable: "无法在 profile 中定位该插件的行，请手动修改 cordis.patch.yml。",
			reasonUnknown: "该插件无法在这个页面切换（{code}）。",
			featureColgrepDescription: "语义代码检索工具",
			featureCodegraphDescription: "代码图 MCP 工具",
			featureProjectMcpDescription: "按会话挂载项目 .mcp.json",
			featureGitbashDescription: "Windows 上的 Git Bash shell",
			featureSuperpowersDescription: "superpowers 技能常驻引导（任何回复前先检查并加载技能）",
			featurePonytailDescription: "ponytail 采纳提示与 /ponytail 等级切换",
			featureInitDescription: "生成或更新项目 AGENTS.md（/init）",
			featureFixDescription: "先查根因并报告，确认后再修复（/fix）",
			featureLanAccessDescription: "让手机在同一局域网打开本 GUI（/lan 给出带 token 的地址）",
			lanButton: "手机连接",
			lanButtonAria: "用手机通过局域网连接：打开二维码",
			lanTitle: "手机扫码连接",
			lanClose: "关闭",
			lanLoading: "正在开启局域网访问…",
			lanHint: "手机与电脑连同一个网络，用相机扫码打开；打开一次后 30 天内免 token。",
			lanRestart: "已开启局域网访问，但需要重启 DSH 后二维码才可用。",
			lanFailed: "无法开启局域网访问：{error}",
			lanNotInstalled: "这个 profile 里没有 lan-access 行。",
			lanReadOnly: "无法在这个页面启用 lan-access 行（{reason}）。",
			lanFrameFailed: "二维码页没有响应；请先打开 /lan-access 检查原因。",
		};
		/** English dictionary checked against the Chinese key set. */
		const en = {
			loading: "Reading plugins…",
			error: "Plugins are unavailable: {error}",
			retry: "Retry",
			empty: "This bundle declares no plugin rows.",
			enabledTag: "Enabled",
			disabledTag: "Disabled",
			toggleAria: "Toggle {name}",
			toggleFailed: "Switching {name} failed: {error}",
			restartRequired: "The change to {name} takes effect after DSH restarts.",
			reasonManagementRequired: "DSH manages this plugin itself, so it cannot be switched from this page.",
			reasonUnaddressable: "This plugin's row cannot be addressed in the profile; edit cordis.patch.yml by hand.",
			reasonUnknown: "This plugin cannot be switched from this page ({code}).",
			featureColgrepDescription: "semantic code search tool",
			featureCodegraphDescription: "CodeGraph MCP tools",
			featureProjectMcpDescription: "mounts the project's .mcp.json per session",
			featureGitbashDescription: "Git Bash shell on Windows",
			featureSuperpowersDescription: "always-on superpowers skill mandate",
			featurePonytailDescription: "ponytail adoption hint and /ponytail level switching",
			featureInitDescription: "generates or updates the project's AGENTS.md (/init)",
			featureFixDescription: "diagnoses the root cause and waits for confirmation before fixing (/fix)",
			featureLanAccessDescription: "opens this GUI from a phone on the same network (/lan prints the tokenized URL)",
			lanButton: "Phone link",
			lanButtonAria: "Connect a phone over the LAN: show the QR code",
			lanTitle: "Scan to connect a phone",
			lanClose: "Close",
			lanLoading: "Enabling LAN access…",
			lanHint: "Keep the phone on the same network and scan with the camera; after one open the token is not needed for 30 days.",
			lanRestart: "LAN access is enabled, but DSH must restart before the QR code is available.",
			lanFailed: "Could not enable LAN access: {error}",
			lanNotInstalled: "This profile has no lan-access row.",
			lanReadOnly: "The lan-access row cannot be enabled from here ({reason}).",
			lanFrameFailed: "The QR page did not answer; open /lan-access to see why.",
		};

		/** Read one thrown value as text. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}

		/**
		 * The dictionary key a manager refusal code reads as.
		 * @param code - the manager's failure code.
		 * @returns the key that explains it, or undefined for a code the page has no sentence for.
		 */
		function refusalKey(code) {
			if (code === "management-required") return "reasonManagementRequired";
			if (code === "unaddressable") return "reasonUnaddressable";
			return undefined;
		}

		/**
		 * Readable copy for one manager failure: the dictionary's sentence for a code the page
		 * explains, otherwise the code and the manager's own diagnostic.
		 * @param t - page dictionary lookup.
		 * @param code - the manager's failure code, when it named one.
		 * @param message - the manager's diagnostic, when it carried one.
		 * @returns the sentence the page shows.
		 */
		function failureText(t, code, message) {
			const key = refusalKey(code);
			if (key !== undefined) return t(key);
			const diagnostic = message ?? "";
			if (code === undefined || code === "") return diagnostic;
			return diagnostic === "" || diagnostic === code ? code : `${code}: ${diagnostic}`;
		}

		/**
		 * Turn a refused answer into the Error the page shows.
		 * The message is readable copy; the raw code stays on the Error for callers that branch on it.
		 * @param t - page dictionary lookup.
		 * @param code - the manager's failure code, when it named one.
		 * @param message - the manager's diagnostic, when it carried one.
		 * @returns the Error to reject with.
		 */
		function refusalError(t, code, message) {
			const error = new Error(failureText(t, code, message));
			if (code !== undefined) error.code = code;
			return error;
		}

		/**
		 * Why a read-only row cannot move here.
		 * @param t - page dictionary lookup.
		 * @param code - the row's `readOnlyReason`.
		 * @returns the sentence the card shows.
		 */
		function reasonText(t, code) {
			const key = refusalKey(code);
			return key === undefined ? t("reasonUnknown", { code: String(code) }) : t(key);
		}

		/**
		 * Project the manager's roster onto this package's features.
		 * @param entries - rows `pluginManager/listPlugins` reported.
		 * @returns one row per feature this package contributes, in the tab's fixed order, with
		 * readonly rows kept but marked untoggleable.
		 */
		function project(entries) {
			const rows = [];
			for (const feature of FEATURES) {
				const entry = entries.find((item) => item.moduleName === feature.moduleName);
				if (entry === undefined) continue;
				rows.push({
					entryId: entry.entryId,
					key: feature.key,
					enabled: entry.enabled === true,
					toggleable: entry.readOnlyReason === undefined,
					reason: entry.readOnlyReason,
				});
			}
			return rows;
		}

		/**
		 * Render one feature card: its name and one-line copy, its switch, and — for a row the
		 * profile cannot address — the sentence that says why the switch stays out of reach.
		 * @param row - one projected row.
		 * @param view - the tab's lookups, its pending entry and its toggle.
		 * @returns the card element.
		 */
		function featureCard(row, view) {
			const { t, pending, onToggle } = view;
			const reason = row.toggleable ? undefined : reasonText(t, row.reason);
			return jsxs("li", {
				style: CARD_STYLE,
				"data-feature": row.key,
				children: [
					jsxs("span", { style: TEXT_STYLE, children: [
						jsx("strong", { children: row.key }),
						jsx("span", { style: DESCRIPTION_STYLE, children: t(FEATURE_BY_KEY.get(row.key).description) }),
					] }),
					jsx("label", { style: SWITCH_STYLE, children: [
						jsx("input", {
							type: "checkbox",
							checked: row.enabled,
							disabled: !row.toggleable || pending,
							"aria-label": t("toggleAria", { name: row.key }),
							onChange: (event) => {
								onToggle(row, event.currentTarget.checked);
							},
						}),
						jsx("span", { children: row.enabled ? t("enabledTag") : t("disabledTag") }),
					] }),
					reason === undefined ? null : jsx("span", { style: REASON_STYLE, children: reason }),
				],
			}, row.entryId);
		}

		/** The Plugins-page tab: one card per feature row, each with its own switch. */
		function HissPluginsTab(props) {
			const list = props.list;
			const setEnabled = props.setEnabled;
			const t = typeof props.t === "function" ? props.t : (key) => key;
			const [request, setRequest] = React.useState(0);
			const [state, setState] = React.useState({ status: "loading" });
			const [busy, setBusy] = React.useState(null);
			const [notice, setNotice] = React.useState(null);
			React.useEffect(() => {
				let current = true;
				Promise.resolve().then(() => list()).then((rows) => {
					if (current) setState({
						status: "ready",
						rows
					});
				}, (error) => {
					if (current) setState({
						status: "error",
						message: messageOf(error)
					});
				});
				return () => {
					current = false;
				};
			}, [
				list,
				request
			]);
			/** Read the host again: the page keeps no enablement of its own. */
			const refresh = () => {
				setRequest((value) => value + 1);
			};
			/**
			 * Persist one switch through the manager, then re-read the host so the card shows what
			 * the profile now holds — a refused write included.
			 * @param row - the row the switch belongs to.
			 * @param enabled - the switch's new position.
			 * @returns the settled request, for callers that await it.
			 */
			const toggle = (row, enabled) => Promise.resolve().then(() => setEnabled(row.entryId, enabled)).then((application) => {
				if (application === "restart-required") setNotice({
					kind: "restart",
					key: row.key
				});
			}, (error) => {
				setNotice({
					kind: "failure",
					key: row.key,
					message: messageOf(error)
				});
			}).finally(() => {
				setBusy(null);
				refresh();
			});
			const view = {
				t,
				onToggle: toggle
			};
			const noticeText = notice === null ? undefined : notice.kind === "restart" ? t("restartRequired", { name: notice.key }) : t("toggleFailed", {
				name: notice.key,
				error: notice.message
			});
			return jsxs("section", {
				className: "hissPlugins",
				style: SECTION_STYLE,
				"aria-busy": state.status === "loading",
				children: [
					state.status === "loading" ? jsx("p", {
						role: "status",
						style: STATUS_STYLE,
						children: t("loading")
					}) : null,
					state.status === "error" ? jsxs("div", {
						role: "alert",
						style: FAILURE_STYLE,
						children: [jsx("p", {
							style: STATUS_STYLE,
							children: t("error", { error: state.message })
						}), jsx("button", {
							type: "button",
							style: BUTTON_STYLE,
							onClick: refresh,
							children: t("retry")
						})]
					}) : null,
					state.status === "ready" && state.rows.length === 0 ? jsx("p", {
						style: STATUS_STYLE,
						children: t("empty")
					}) : null,
					state.status === "ready" && state.rows.length > 0 ? jsx("ul", {
						style: LIST_STYLE,
						children: state.rows.map((row) => featureCard(row, {
							...view,
							pending: busy === row.entryId
						}))
					}) : null,
					noticeText === undefined ? null : jsx("p", {
						role: "status",
						style: NOTICE_STYLE,
						children: noticeText
					}),
				],
			});
		}

		/**
		 * Values apply() hands the two slot components. They live at module scope because the
		 * sidebar action and the overlay host are separate slot occupants with no shared props.
		 */
		const lanUi = {
			store: null,
			t: (key) => key,
			ensureEnabled: async () => "enabled",
			probe: async () => ({ ok: false, message: "" }),
		};

		/**
		 * Popup state shared by the sidebar action and its overlay host: the two live in
		 * different slots, so neither can own React state for the other.
		 * @returns a tiny external store.
		 */
		function createPopupStore() {
			let open = false;
			const listeners = new Set();
			return {
				get: () => open,
				set(value) {
					const next = value === true;
					if (next === open) return;
					open = next;
					for (const listener of [...listeners]) listener();
				},
				listen(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
			};
		}

		/**
		 * Subscribe a component to the popup store.
		 * @param store - the shared store.
		 * @returns whether the popup is open.
		 */
		function usePopupOpen(store) {
			const [open, setOpen] = React.useState(store.get());
			React.useEffect(() => store.listen(() => setOpen(store.get())), []);
			return open;
		}

		/** A phone outline for the sidebar action. */
		function PhoneIcon() {
			return jsx("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.8,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					jsx("rect", { x: 6, y: 2, width: 12, height: 20, rx: 3, key: "body" }),
					jsx("path", { d: "M11 18h2", key: "home" }),
				],
			});
		}

		/**
		 * The sidebar-foot action that opens the phone-link popup.
		 * @param props - `store`, the bound `t`, and the owner's column width state.
		 */
		function LanAccessButton({ wide }) {
			const { store, t } = lanUi;
			const open = usePopupOpen(store);
			return jsx("button", {
				type: "button",
				title: t("lanButton"),
				"aria-label": t("lanButtonAria"),
				"aria-expanded": open,
				style: wide ? LAN_BUTTON_STYLE : { ...LAN_BUTTON_STYLE, ...LAN_RAIL_STYLE },
				onClick: () => store.set(true),
				children: [
					jsx(PhoneIcon, { key: "icon" }),
					wide ? jsx("span", {
						key: "label",
						children: t("lanButton")
					}) : null
				]
			});
		}

		/**
		 * The frame-wide popup: enabling the row, waiting for the page, and showing the QR.
		 * @param props - `store`, the bound `t`, `ensureEnabled`, and `probe`.
		 */
		function LanAccessPopup() {
			const { store, t, ensureEnabled, probe } = lanUi;
			const open = usePopupOpen(store);
			const [state, setState] = React.useState({ status: "idle" });
			React.useEffect(() => {
				if (!open) return undefined;
				let current = true;
				setState({ status: "loading" });
				Promise.resolve().then(ensureEnabled).then((outcome) => {
					if (!current) return undefined;
					if (outcome === "restart-required") {
						setState({ status: "restart" });
						return undefined;
					}
					return probe().then((answer) => {
						if (!current) return;
						setState(answer.ok ? { status: "ready", src: answer.url } : { status: "error", message: answer.message });
					});
				}).catch((error) => {
					if (current) setState({ status: "error", message: messageOf(error) });
				});
				return () => {
					current = false;
				};
			}, [open, ensureEnabled, probe]);
			React.useEffect(() => {
				if (!open) return undefined;
				const onKey = (event) => {
					if (event.key === "Escape") store.set(false);
				};
				globalThis.window?.addEventListener?.("keydown", onKey);
				return () => globalThis.window?.removeEventListener?.("keydown", onKey);
			}, [open, store]);
			if (!open) return null;
			return jsx("div", {
				role: "presentation",
				style: LAN_OVERLAY_STYLE,
				onClick: () => store.set(false),
				children: jsxs("div", {
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("lanTitle"),
					style: LAN_DIALOG_STYLE,
					onClick: (event) => event.stopPropagation(),
					children: [
						jsxs("div", {
							style: LAN_HEADER_STYLE,
							children: [jsx("strong", { children: t("lanTitle") }), jsx("button", {
								type: "button",
								style: BUTTON_STYLE,
								onClick: () => store.set(false),
								children: t("lanClose")
							})]
						}),
						state.status === "loading" ? jsx("p", { role: "status", style: LAN_HINT_STYLE, children: t("lanLoading") }) : null,
						state.status === "restart" ? jsx("p", { role: "alert", style: LAN_HINT_STYLE, children: t("lanRestart") }) : null,
						state.status === "error" ? jsx("p", { role: "alert", style: LAN_HINT_STYLE, children: t("lanFailed", { error: state.message }) }) : null,
						state.status === "ready" ? jsx("iframe", {
							title: t("lanTitle"),
							src: state.src,
							style: LAN_FRAME_STYLE
						}) : null,
						jsx("p", { style: LAN_HINT_STYLE, children: t("lanHint") })
					]
				})
			});
		}

		/** Host commands whose run this browser half projects into the chat view. */
		const PROJECTED_COMMANDS = new Set(["mcp", "lan"]);
		/**
		 * Chat node kind of the `/mcp` and `/lan` projection.
		 *
		 * DSH hides the whole transcript while a session has no turn (the chat view counts only
		 * non-command nodes as activity, and only a turn clears the session's blank flag), so in a
		 * never-messaged session the report — logged as `command/run` + `command/done` — would
		 * stay invisible until the first message starts a turn. Registering this non-command node is
		 * how DSH's own `ui-goal` keeps `/goal` visible; the report itself stays in the generic
		 * command card, which is why the renderer below draws nothing.
		 */
		const MCP_NODE_KIND = "hiss-mcp-command";

		/**
		 * Project one `/mcp` or `/lan` run as an empty chat node.
		 * Only `command/run` is claimed: `command/done` still renders through the generic command card,
		 * and every other command is untouched.
		 */
		const mcpCommandDefinition = {
			kind: MCP_NODE_KIND,
			target: "chat",
			match: (event) => event.type === "command/run" && PROJECTED_COMMANDS.has(event.data.name)
				? { id: String(event.data.commandId), role: "start" }
				: null,
			start: (_context, match) => ({ seq: match.event.seq, commandId: match.event.data.commandId }),
			buildViewNode: (context) => ({
				key: context.key,
				kind: MCP_NODE_KIND,
				id: context.id,
				target: "chat",
				anchorSeq: context.state.seq - 0.1,
				location: context.start?.location ?? { kind: "unresolved" },
				visibility: "visible",
				data: { commandId: context.state.commandId },
			}),
		};

		/** Zero-size renderer: the node exists to keep the chat view active, not to draw the report. */
		function McpCommandNodeView() {
			return null;
		}

		/** Services required by the tab registration, its Remote answers, and the `/mcp` projection. */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.pluginManager",
			"uiConversation"
		];

		/**
		 * Contribute the management tab to the Plugins page.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "hiss-plugins: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.uiConversation.events.register(mcpCommandDefinition);
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: MCP_NODE_KIND,
				locale: NS,
			}, McpCommandNodeView));
			/**
			 * Read the running profile's rows.
			 * @returns one projected row per feature this package contributes.
			 */
			const list = async () => {
				const answer = await ctx.remote.pluginManager.listPlugins();
				if (!answer.ok) throw new Error(`pluginManager.listPlugins failed: ${answer.error.code}: ${answer.error.message}`);
				return project(answer.value);
			};
			/**
			 * Persist one row's enablement.
			 * @param entryId - the Loader entry identity `list()` reported.
			 * @param enabled - whether the row should run.
			 * @returns the manager's application outcome; `restart-required` means the next start lands it.
			 */
			const setEnabled = async (entryId, enabled) => {
				const answer = await ctx.remote.pluginManager.setPluginEnabled(entryId, enabled);
				if (!answer.ok) throw refusalError(t, answer.error.code, answer.error.message);
				const result = answer.value;
				if (result.application === "failed") throw refusalError(t, result.error?.code, result.error?.diagnostic);
				return result.application;
			};
			lanUi.store = createPopupStore();
			/**
			 * Turn the lan-access row on so the popup has something to show.
			 * @returns "enabled" when the listener is being mounted now, "restart-required" when only a restart lands it.
			 */
			const ensureLanEnabled = async () => {
				const rows = await list();
				const row = rows.find((candidate) => candidate.key === "lan-access");
				if (row === undefined) throw new Error(t("lanNotInstalled"));
				if (row.enabled) return "enabled";
				if (!row.toggleable) throw new Error(t("lanReadOnly", { reason: row.reason ?? "unknown" }));
				return (await setEnabled(row.entryId, true)) === "restart-required" ? "restart-required" : "enabled";
			};
			/**
			 * Wait for the host's QR page: a just-enabled row registers its route asynchronously.
			 * @returns whether the page answers, and the frame URL.
			 */
			const probeLanPage = async () => {
				const url = "/lan-access?embed=1";
				for (let attempt = 0; attempt < 12; attempt += 1) {
					try {
						const response = await fetch(url, { method: "HEAD", cache: "no-store" });
						if (response.ok) return { ok: true, url };
						if (response.status === 401 || response.status === 403) break;
					} catch {
						// The route does not exist yet (404) or the browser is briefly offline.
					}
					await new Promise((resolve) => setTimeout(resolve, 250));
				}
				return { ok: false, message: t("lanFrameFailed", { url: "/lan-access" }) };
			};
			ctx.slots.inject("plugins.tab", () => ctx.slots.register({
				name: "plugins.tab",
				id: "dsh-hiss-plugins",
				order: 20,
				label: () => "dsh-hiss-plugins",
				locale: NS,
				inject: () => ({
					list,
					setEnabled,
					t,
					features: FEATURES.map((feature) => feature.key)
				})
			}, HissPluginsTab));
			lanUi.t = t;
			lanUi.ensureEnabled = ensureLanEnabled;
			lanUi.probe = probeLanPage;
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "lan-access",
				order: 10,
				locale: NS,
				label: () => t("lanButton"),
			}, LanAccessButton));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "lan-access.popup",
				order: 900,
				locale: NS,
			}, LanAccessPopup));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
