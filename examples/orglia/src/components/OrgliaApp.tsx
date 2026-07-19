import {
	useEffect,
	useRef,
	useState,
	type ComponentType,
	type FormEvent,
} from "react";
import {
	AlertTriangle,
	BarChart3,
	Boxes,
	Building2,
	CalendarDays,
	CheckSquare2,
	ChevronLeft,
	ClipboardCheck,
	FileSpreadsheet,
	FolderKanban,
	HelpCircle,
	Home,
	Languages,
	LoaderCircle,
	LogOut,
	Menu,
	PanelLeftClose,
	RefreshCw,
	Search,
	ShieldCheck,
	Siren,
	UsersRound,
	WifiOff,
	X,
} from "lucide-react";
import type { ModuleId } from "@/domain/types";
import { copy, moduleLabel, roleLabel } from "@/lib/i18n";
import { useOrglia } from "@/state/OrgliaStore";
import { FeatureView } from "@/views/FeatureView";
import { ContextPanel } from "@/views/ContextPanel";
import { NATIVE_DEMO_EMAIL, NATIVE_DEMO_PASSWORD } from "@/lib/native-demo";

const modules: Array<{
	id: ModuleId;
	icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}> = [
	{ id: "overview", icon: Home },
	{ id: "projects", icon: FolderKanban },
	{ id: "crm", icon: UsersRound },
	{ id: "orders", icon: ClipboardCheck },
	{ id: "inventory", icon: Boxes },
	{ id: "approvals", icon: CheckSquare2 },
	{ id: "shifts", icon: CalendarDays },
	{ id: "incidents", icon: Siren },
	{ id: "analytics", icon: BarChart3 },
	{ id: "admin", icon: ShieldCheck },
];

function LoginScreen() {
	const { login, session, setLocale, syncState, syncMessage, t } = useOrglia();
	const [email, setEmail] = useState(NATIVE_DEMO_EMAIL);
	const [password, setPassword] = useState("");
	const [nativeDemo, setNativeDemo] = useState(false);
	useEffect(() => {
		const controller = new AbortController();
		fetch("/api/native-demo", { signal: controller.signal })
			.then((response) => (response.ok ? response.json() : null))
			.then((result: { enabled?: boolean } | null) => {
				if (!result?.enabled) return;
				setNativeDemo(true);
				setEmail(NATIVE_DEMO_EMAIL);
				setPassword(NATIVE_DEMO_PASSWORD);
			})
			.catch(() => {});
		return () => controller.abort();
	}, []);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		await login(email, password);
	};
	return (
		<main className="login-page" id="main-content">
			<section className="login-card" aria-labelledby="login-title">
				<div className="login-brand">
					<span>O</span>
					<div>
						<strong>Orglia</strong>
						<small>
							{copy(
								session.locale,
								"統合業務ワークスペース",
								"Integrated operations workspace",
							)}
						</small>
					</div>
				</div>
				<h1 id="login-title">{t("login")}</h1>
				<p>
					{copy(
						session.locale,
						"組織のアカウントで安全にアクセスします。テナントとロールはサーバー側でセッションに固定されます。",
						"Sign in securely. The server binds your tenant and role to the session.",
					)}
				</p>
				{nativeDemo && (
					<p className="demo-credentials" role="status">
						{copy(
							session.locale,
							"ローカルデモ用の認証情報を入力済みです。",
							"Local demo credentials are prefilled.",
						)}
					</p>
				)}
				<form onSubmit={submit}>
					<label>
						{t("email")}
						<input
							type="email"
							autoComplete="username"
							required
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
					</label>
					<label>
						{t("password")}
						<input
							type="password"
							autoComplete="current-password"
							required
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
					</label>
					{syncState === "error" && (
						<p className="form-error" role="alert">
							{syncMessage}
						</p>
					)}
					<button
						className="button button--primary"
						type="submit"
						disabled={syncState === "loading"}
					>
						{syncState === "loading" ? (
							<>
								<LoaderCircle className="spin" />
								{t("signingIn")}
							</>
						) : (
							t("login")
						)}
					</button>
				</form>
				<label className="login-locale">
					<Languages size={16} />
					<span className="sr-only">{t("language")}</span>
					<select
						value={session.locale}
						onChange={(event) => setLocale(event.target.value as "ja" | "en")}
					>
						<option value="ja">日本語</option>
						<option value="en">English</option>
					</select>
				</label>
			</section>
		</main>
	);
}

function SyncBanner() {
	const { syncState, syncMessage, retryPending, dismissSyncError, t } =
		useOrglia();
	if (syncState === "ready" || syncState === "loading") return null;
	const actionable = ["offline", "conflict", "error"].includes(syncState);
	return (
		<div
			className={`sync-banner sync-banner--${syncState}`}
			role={actionable ? "alert" : "status"}
		>
			{syncState === "saving" ? (
				<LoaderCircle className="spin" />
			) : syncState === "offline" ? (
				<WifiOff />
			) : (
				<AlertTriangle />
			)}
			<strong>{syncState === "saving" ? t("saving") : syncMessage}</strong>
			{actionable && (
				<div>
					<button className="button" onClick={() => void retryPending()}>
						<RefreshCw />
						{syncState === "conflict" ? t("retry") : t("refresh")}
					</button>
					<button className="button button--quiet" onClick={dismissSyncError}>
						{t("dismiss")}
					</button>
				</div>
			)}
		</div>
	);
}

export function OrgliaApp() {
	const {
		data,
		session,
		authLoading,
		authenticated,
		currentTenant,
		currentUser,
		setModule,
		setLocale,
		allowed,
		t,
		toast,
		logout,
	} = useOrglia();
	const [moduleOpen, setModuleOpen] = useState(false);
	const [contextOpen, setContextOpen] = useState(true);
	const workspaceRef = useRef<HTMLDivElement>(null);
	const sidebarRef = useRef<HTMLElement>(null);
	useEffect(() => {
		if (!moduleOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setModuleOpen(false);
		};
		document.addEventListener("keydown", onKey);
		sidebarRef.current
			?.querySelector<HTMLElement>("button:not(:disabled)")
			?.focus();
		if (workspaceRef.current) workspaceRef.current.inert = true;
		return () => {
			document.removeEventListener("keydown", onKey);
			if (workspaceRef.current) workspaceRef.current.inert = false;
		};
	}, [moduleOpen]);

	if (authLoading)
		return (
			<main className="app-loading" aria-busy="true">
				<LoaderCircle className="spin" />
				<span>Orglia</span>
			</main>
		);
	if (!authenticated) return <LoginScreen />;

	const pendingApprovals = data.approvals.filter(
		(item) => item.status === "pending",
	).length;
	const activeIncidents = data.incidents.filter(
		(item) => item.status !== "resolved",
	).length;
	return (
		<div className="app-shell" data-module={session.activeModule}>
			<a href="#main-content" className="skip-link">
				{copy(session.locale, "本文へ移動", "Skip to content")}
			</a>
			<aside
				className="global-rail"
				aria-label={copy(
					session.locale,
					"グローバルナビゲーション",
					"Global navigation",
				)}
			>
				<button
					className="brand"
					onClick={() => setModule("overview")}
					aria-label={copy(session.locale, "Orglia ホーム", "Orglia home")}
				>
					<span>O</span>
					<strong>Orglia</strong>
				</button>
				<nav>
					<button
						className={session.activeModule === "overview" ? "is-active" : ""}
						aria-label={t("overview")}
						onClick={() => setModule("overview")}
					>
						<Home />
						<span>{t("overview")}</span>
					</button>
					<button
						aria-label={copy(
							session.locale,
							"検索（準備中）",
							"Search (not available)",
						)}
						disabled
						title={copy(
							session.locale,
							"このサンプルでは未提供です",
							"Not available in this example",
						)}
					>
						<Search />
						<span>{copy(session.locale, "検索", "Search")}</span>
					</button>
					<button
						aria-label={t("approvals")}
						onClick={() => setModule("approvals")}
					>
						<CheckSquare2 />
						<span>{t("approvals")}</span>
						{pendingApprovals > 0 && <b>{pendingApprovals}</b>}
					</button>
					<button
						aria-label={t("incidents")}
						onClick={() => setModule("incidents")}
					>
						<AlertTriangle />
						<span>{t("incidents")}</span>
						{activeIncidents > 0 && <b>{activeIncidents}</b>}
					</button>
					<button
						aria-label={t("analytics")}
						onClick={() => setModule("analytics")}
					>
						<FileSpreadsheet />
						<span>{t("analytics")}</span>
					</button>
				</nav>
				<div className="global-rail__bottom">
					<button
						disabled
						title={copy(
							session.locale,
							"このサンプルでは未提供です",
							"Not available in this example",
						)}
					>
						<HelpCircle />
						<span>{copy(session.locale, "ヘルプ", "Help")}</span>
					</button>
					<button
						disabled
						title={copy(
							session.locale,
							"このサンプルでは未提供です",
							"Not available in this example",
						)}
					>
						<PanelLeftClose />
						<span>{copy(session.locale, "折りたたむ", "Collapse")}</span>
					</button>
				</div>
			</aside>

			{moduleOpen && (
				<button
					className="module-backdrop"
					aria-label={t("close")}
					onClick={() => setModuleOpen(false)}
				/>
			)}
			<aside
				ref={sidebarRef}
				className={`module-sidebar ${moduleOpen ? "is-open" : ""}`}
				aria-label={copy(session.locale, "モジュール", "Modules")}
				role={moduleOpen ? "dialog" : undefined}
				aria-modal={moduleOpen || undefined}
			>
				<div className="module-sidebar__title">
					<strong>{copy(session.locale, "モジュール", "Modules")}</strong>
					<button
						className="icon-button mobile-only"
						onClick={() => setModuleOpen(false)}
						aria-label={t("close")}
					>
						<X />
					</button>
				</div>
				<nav>
					{modules.map(({ id, icon: Icon }) => (
						<button
							key={id}
							className={`module-nav module-${id} ${session.activeModule === id ? "is-active" : ""}`}
							disabled={!allowed(id)}
							aria-current={session.activeModule === id ? "page" : undefined}
							onClick={() => {
								setModule(id);
								setModuleOpen(false);
							}}
							title={!allowed(id) ? t("restricted") : undefined}
						>
							<Icon size={18} aria-hidden={true} />
							<span>{moduleLabel(session.locale, id)}</span>
						</button>
					))}
				</nav>
				<div className="sidebar-foot">
					<span>{t("sessionSecurity")}</span>
					<small>revision-backed API</small>
				</div>
			</aside>

			<div ref={workspaceRef} className="workspace">
				<header className="topbar">
					<button
						className="icon-button mobile-only"
						onClick={() => setModuleOpen(true)}
						aria-label={copy(
							session.locale,
							"モジュールを開く",
							"Open modules",
						)}
					>
						<Menu />
					</button>
					{data.sampleData && (
						<div className="sample-notice">
							<span>i</span>
							<span>{t("sample")}</span>
						</div>
					)}
					<div className="topbar__controls">
						<span className="tenant-label">
							<Building2 size={16} />
							{currentTenant.name}
						</span>
						<label>
							<span className="sr-only">{t("language")}</span>
							<Languages size={16} />
							<select
								value={session.locale}
								onChange={(event) =>
									setLocale(event.target.value as "ja" | "en")
								}
							>
								<option value="ja">日本語</option>
								<option value="en">English</option>
							</select>
						</label>
						<span className="user-session">
							<span className="avatar">{currentUser.name.slice(0, 1)}</span>
							<span>
								<strong>{currentUser.name}</strong>
								<small>{roleLabel(session.locale, currentUser.role)}</small>
							</span>
						</span>
						<button
							className="icon-button"
							aria-label={t("logout")}
							title={t("logout")}
							onClick={() => void logout()}
						>
							<LogOut />
						</button>
					</div>
				</header>
				<SyncBanner />
				<div className={`content-frame ${contextOpen ? "has-context" : ""}`}>
					<main id="main-content" tabIndex={-1}>
						<FeatureView onOpenContext={() => setContextOpen(true)} />
					</main>
					{contextOpen && (
						<aside className="context-panel" aria-label={t("details")}>
							<button
								className="context-close"
								onClick={() => setContextOpen(false)}
								aria-label={t("close")}
							>
								<X />
							</button>
							<ContextPanel />
						</aside>
					)}
					{!contextOpen && (
						<button
							className="context-reopen"
							onClick={() => setContextOpen(true)}
						>
							<ChevronLeft size={16} />
							{t("details")}
						</button>
					)}
				</div>
			</div>
			<div className="live-toast" role="status" aria-live="polite">
				{toast}
			</div>
		</div>
	);
}
