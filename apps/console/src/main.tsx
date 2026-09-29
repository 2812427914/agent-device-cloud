import {
  StrictMode,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent
} from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BookOpen,
  Bot,
  Cable,
  Check,
  CirclePlus,
  Clipboard,
  FolderRoot,
  Laptop,
  LayoutDashboard,
  RefreshCw,
  Settings,
  ShieldCheck,
  X
} from "lucide-react";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate
} from "react-router-dom";
import { AnalyticsEffects } from "./analytics.tsx";
import {
  AccountSettings,
  AuthLayout,
  AuthPage,
  Brand,
  CliLogin,
  apiRequest,
  type User,
  type Request
} from "./auth-ui.tsx";
import { Agents, OAuthConsent } from "./agents.tsx";
import { Landing } from "./landing.tsx";
import { Documentation } from "./docs.tsx";
import { DeviceSettings } from "./device-settings.tsx";
import { ConfirmAction } from "./dialog.tsx";
import { LanguageSelector, LocaleProvider, useI18n, type Message } from "./i18n.tsx";
import { Overview } from "./overview.tsx";
import { publicContentEntry } from "./public-content.ts";
import { PublicContentRoute } from "./public-site.tsx";
import "./styles.css";

export interface NodeRecord {
  nodeId: string;
  label: string;
  platform: string;
  status: string;
  online: boolean;
  lastSeenAt?: string;
  revision?: number;
  accessPolicy?: {
    rootAccess: "all" | "selected";
    rootIds: string[];
    readOnlyRootIds: string[];
    allowExecution: boolean;
    maxConcurrency: number;
  };
  effectiveCapability?: NodeRecord["capability"];
  capability?: {
    tools: {
      name: string;
      title?: string;
      description?: string;
      risk: "read" | "write" | "execute";
      provider?: {
        kind: "mcp";
        providerId: string;
        providerName: string;
        sourceToolName: string;
      };
    }[];
    roots: { rootId: string; path?: string; label: string; writable: boolean }[];
    nodeVersion: string;
    accessMode?: "none" | "selected" | "home" | "full";
  };
}
interface ProjectRecord {
  projectId: string;
  label: string;
}
interface RootRecord {
  rootId: string;
  projectId: string;
  nodeId: string;
  path?: string;
  label: string;
  writable: boolean;
}
interface AuditEvent {
  eventId: string;
  invocationId?: string;
  type: string;
  payload: Record<string, any>;
  createdAt: string;
}
interface ApprovalRecord {
  approvalId: string;
  invocation: { tool: string; actor: { id: string }; args: Record<string, unknown> };
  nodeId: string;
  path?: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}
type PageProps = {
  request: Request;
  revision: number;
  refresh: () => void;
  onError: (value: string) => void;
};

function App() {
  const { t } = useI18n();
  const [user, setUser] = useState<User | null>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    try {
      return await apiRequest(path, init);
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) setUser(null);
      throw error;
    }
  }, []);
  const loadUser = useCallback(async () => {
    const result = await apiRequest("/api/v1/me");
    if (result.kind !== "session") throw new Error("Sign in to manage your account.");
    setUser(result.user);
  }, []);
  useEffect(() => {
    try {
      sessionStorage.removeItem("adc.token");
      sessionStorage.removeItem("adc.url");
    } catch {
      /* Optional storage. */
    }
    loadUser().catch((error) => {
      if (error.status === 401) setUser(null);
      else setError(error.message);
    });
  }, [loadUser]);
  // The public website remains usable while account services load.
  if (location.pathname === "/") return <Landing signedIn={!!user} />;
  if (location.pathname === "/docs" || location.pathname.startsWith("/docs/"))
    return <Documentation signedIn={!!user} />;
  if (location.pathname === "/updates" || !!publicContentEntry(location.pathname))
    return <PublicContentRoute signedIn={!!user} />;
  const legacy: Record<string, string> = {
    "/devices": "/app/devices",
    "/projects": "/app/projects",
    "/agents": "/app/agents",
    "/access": "/app/approvals",
    "/audit": "/app/activity",
    "/settings": "/app/settings"
  };
  if (legacy[location.pathname]) return <Navigate to={legacy[location.pathname]!} replace />;
  if (user === undefined)
    return (
      <AuthLayout>
        <Brand />
        {error ? (
          <>
            <p className="form-error" role="alert">
              {error}
            </p>
            <button className="secondary" onClick={() => window.location.reload()}>
              {t("Retry")}
            </button>
          </>
        ) : (
          <p className="description" role="status">
            {t("Loading your account…")}
          </p>
        )}
      </AuthLayout>
    );
  const publicPage = ["/login", "/register", "/forgot-password", "/reset-password"].includes(
    location.pathname
  );
  const oauth = new URLSearchParams(location.search).has("sig");
  const requestedReturnTo = new URLSearchParams(location.search).get("return_to");
  const returnTo =
    requestedReturnTo?.startsWith("/cli-login?") &&
    !requestedReturnTo.includes("\\") &&
    !requestedReturnTo.includes("\n")
      ? requestedReturnTo
      : undefined;
  if (publicPage) {
    if (
      user &&
      ["/login", "/register"].includes(location.pathname) &&
      !oauth &&
      !new URLSearchParams(location.search).has("error")
    )
      return <Navigate to={returnTo ?? "/app"} replace />;
    return (
      <AuthPage
        currentUser={user}
        onLogin={async (destination) => {
          await loadUser();
          setError("");
          await navigate(destination ?? "/app");
        }}
      />
    );
  }
  if (!user)
    return (
      <Navigate
        to={
          location.pathname === "/authorize"
            ? `/login${location.search}`
            : location.pathname === "/cli-login"
              ? `/login?return_to=${encodeURIComponent(`/cli-login${location.search}`)}`
              : "/login"
        }
        replace
      />
    );
  if (location.pathname === "/authorize") return <OAuthConsent request={request} />;
  if (location.pathname === "/cli-login") return <CliLogin request={request} />;
  const refresh = () => setRevision((value) => value + 1);
  const props = { request, revision, refresh, onError: setError };
  const navigation: [string, Message, ReactNode][] = [
    ["/app", "Overview", <LayoutDashboard />],
    ["/app/devices", "Devices", <Cable />],
    ["/app/agents", "Agent access", <Bot />],
    ["/app/approvals", "Approvals", <ShieldCheck />],
    ["/app/activity", "Activity", <Activity />],
    ["/app/projects", "Projects", <FolderRoot />],
    ["/app/settings", "Account", <Settings />]
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label={t("Open console")}>
          {navigation.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === "/app"} title={t(label)}>
              {icon}
              <span>{t(label)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="connection">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <LinkHome />
          <NavLink className="console-docs" to="/docs">
            <BookOpen size={14} />
            {t("Docs")}
          </NavLink>
          <LanguageSelector />
          <button className="icon-button" aria-label={t("Refresh")} onClick={refresh}>
            <RefreshCw size={16} />
          </button>
        </header>
        {error ? (
          <div className="error-bar" role="alert">
            <span>{error}</span>
            <button className="icon-button" aria-label={t("Dismiss")} onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        ) : null}
        <Routes>
          <Route
            path="/app"
            element={<Overview request={request} revision={revision} onError={setError} />}
          />
          <Route path="/app/devices" element={<Devices {...props} />} />
          <Route path="/app/projects" element={<Projects {...props} />} />
          <Route path="/app/agents" element={<Agents {...props} />} />
          <Route path="/app/approvals" element={<Access {...props} />} />
          <Route path="/app/activity" element={<Audit {...props} />} />
          <Route
            path="/app/settings"
            element={
              <AccountSettings
                user={user}
                request={request}
                onUpdate={loadUser}
                onLogout={async () => {
                  await request("/api/auth/sign-out", { method: "POST", body: "{}" });
                  setUser(null);
                  setError("");
                  await navigate("/login");
                }}
              />
            }
          />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </main>
    </div>
  );
}
function LinkHome() {
  const { t } = useI18n();
  return (
    <NavLink className="console-home" to="/">
      {t("Back to home")}
    </NavLink>
  );
}
function PageHeader({
  title,
  count,
  action
}: {
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {count !== undefined ? <span className="count">{count}</span> : null}
      </div>
      {action}
    </div>
  );
}
function Empty({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="empty">
      {icon}
      <span>{label}</span>
    </div>
  );
}
function Devices({ request, revision, refresh, onError }: PageProps) {
  const { t, term, date } = useI18n();
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<NodeRecord>();
  const [action, setAction] = useState<{ node: NodeRecord; kind: "delete" | "revoke" }>();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("active");
  const [notice, setNotice] = useState<Message>();
  const visibleNodes = nodes.filter(
    (node) =>
      (filter === "all" || node.status === filter) &&
      node.label.toLowerCase().includes(search.toLowerCase())
  );
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string }>();
  const [installation, setInstallation] = useState<{
    installerUrl: string;
    downloadUrl: string;
    controlPlaneUrl: string;
  }>();
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let disposed = false,
      loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const body = await request("/api/v1/nodes");
        if (!disposed) {
          setNodes(body.nodes);
          setLoaded(true);
        }
      } catch (error) {
        if (!disposed) onError((error as Error).message);
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [request, revision, onError]);
  const createCode = async () => {
    setCreating(true);
    try {
      const release = await request("/api/v1/node-installation");
      if (!release.available)
        throw new Error(
          t("Device downloads are not available yet. Contact the installation administrator.")
        );
      setInstallation(release);
      setCopied(false);
      setPairing(
        await request("/api/v1/pairing-codes", {
          method: "POST",
          body: JSON.stringify({ ttlSeconds: 600 })
        })
      );
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setCreating(false);
    }
  };
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command =
    pairing && installation
      ? `curl -fsSL ${quote(installation.installerUrl)} | sh -s -- --url ${quote(installation.controlPlaneUrl)} --download-url ${quote(installation.downloadUrl)} --code ${quote(pairing.code)}`
      : "";
  const modes: Record<string, Message> = {
    none: "No access",
    selected: "Selected folders",
    home: "Home directory",
    full: "Full device trust"
  };
  return (
    <section className="page">
      <PageHeader
        title={t("Devices")}
        count={nodes.length}
        action={
          <button className="primary" disabled={creating} onClick={createCode}>
            <CirclePlus size={16} />
            {t("Pair device")}
          </button>
        }
      />
      <p className="description">
        {t("Folders are managed on the device and update here automatically.")}
      </p>
      {pairing ? (
        <div className="install-card">
          <div className="install-heading">
            <strong>{t("Connect this device")}</strong>
            <span>{t("Expires {date}", { date: date(pairing.expiresAt) })}</span>
            <button
              className="icon-button"
              aria-label={t("Close")}
              onClick={() => setPairing(undefined)}
            >
              <X size={16} />
            </button>
          </div>
          <p>
            {t(
              "Run this command in a terminal on your Mac or Linux device. Choose access during setup, or leave folders for later."
            )}
          </p>
          <pre>
            <code>{command}</code>
          </pre>
          <div className="install-footer">
            <span>
              {t(
                "Installs the connector and starts it in the background. Your device will appear below automatically."
              )}
            </span>
            <button
              className="secondary"
              disabled={now >= Date.parse(pairing.expiresAt)}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(command);
                  setCopied(true);
                } catch {
                  onError(t("Could not copy. Select and copy the command above."));
                }
              }}
            >
              {copied ? <Check size={16} /> : <Clipboard size={16} />}
              {t(
                now >= Date.parse(pairing.expiresAt)
                  ? "Code expired"
                  : copied
                    ? "Copied"
                    : "Copy command"
              )}
            </button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      ) : null}
      {editing ? (
        <DeviceSettings
          key={editing.nodeId}
          node={editing}
          request={request}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setNotice("Device updated.");
            refresh();
          }}
          onRevoke={() => {
            setAction({ node: editing, kind: "revoke" });
            setEditing(undefined);
          }}
        />
      ) : null}
      {action ? (
        <ConfirmAction
          title={t(action.kind === "delete" ? "Delete device {name}?" : "Revoke device {name}?", {
            name: action.node.label
          })}
          description={t(
            action.kind === "delete"
              ? "The device will be removed and its access stopped. Local files and execution history are kept. Before pairing again, run adc-node unpair --confirm {nodeId} on that device."
              : "Agents will lose access to this device. The device stays listed for your records.",
            { nodeId: action.node.nodeId }
          )}
          actionLabel={t(action.kind === "delete" ? "Delete" : "Revoke")}
          onClose={() => setAction(undefined)}
          onConfirm={async () => {
            await request(
              `/api/v1/nodes/${action.node.nodeId}${action.kind === "revoke" ? "/revoke" : ""}`,
              {
                method: action.kind === "delete" ? "DELETE" : "POST",
                body: JSON.stringify(
                  action.kind === "delete" ? { revision: action.node.revision ?? 1 } : {}
                )
              }
            );
            setNotice(action.kind === "delete" ? "Device deleted." : "Device revoked.");
            refresh();
          }}
        />
      ) : null}
      <div className="resource-toolbar">
        <input
          aria-label={t("Search devices")}
          placeholder={t("Search devices")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label={t("Status")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="active">{t("Active")}</option>
          <option value="revoked">{t("Revoked")}</option>
          <option value="all">{t("All")}</option>
        </select>
      </div>
      <div className="device-grid">
        {visibleNodes.map((node) => (
          <article className="device-card" key={node.nodeId}>
            <div className="device-heading">
              <Laptop size={24} strokeWidth={1.4} />
              <span
                className={`state ${node.status === "revoked" ? "revoked" : node.online ? "active" : "offline"}`}
              >
                {term(node.status === "revoked" ? "revoked" : node.online ? "online" : "offline")}
              </span>
            </div>
            <h2>{node.label}</h2>
            <p className="hint">
              {node.platform === "darwin" ? "macOS" : node.platform} ·{" "}
              {node.capability?.nodeVersion ?? "—"}
            </p>
            <div className="device-scope">
              <strong>{t(modes[node.capability?.accessMode ?? "selected"]!)}</strong>
              <div className="folder-tags">
                {(node.effectiveCapability ?? node.capability)?.roots.length ? (
                  (node.effectiveCapability ?? node.capability)!.roots.map((root) => (
                    <span key={root.rootId} title={root.path ?? root.label}>
                      <FolderRoot size={13} />
                      {root.path ?? root.label}
                      <small>{t(root.writable ? "Write" : "Read")}</small>
                    </span>
                  ))
                ) : (
                  <span>{t("No folders exposed yet")}</span>
                )}
              </div>
            </div>
            <div className="device-footer">
              <span className="hint">
                {t("Last seen")}
                <br />
                {node.lastSeenAt ? date(node.lastSeenAt) : t("Never")}
              </span>
              <div className="row-actions">
                {node.status === "active" ? (
                  <button className="secondary" onClick={() => setEditing(node)}>
                    {t("Manage")}
                  </button>
                ) : null}
                <button
                  className="secondary danger"
                  onClick={() => setAction({ node, kind: "delete" })}
                >
                  {t("Delete")}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {loaded && nodes.length > 0 && !visibleNodes.length ? (
        <Empty icon={<Cable />} label={t("No matching devices")} />
      ) : null}
      {!nodes.length ? (
        <div className="card">
          <Empty icon={<Cable />} label={t(loaded ? "No devices" : "Loading…")} />
          <p className="description centered">
            {t("Pair a device to bring its tools and files to your agents.")}
          </p>
        </div>
      ) : null}
      <details className="local-help">
        <summary>{t("Manage local access")}</summary>
        <p className="description">
          {t("Run on the device. Changes take effect without restarting the connector.")}
        </p>
        <div className="local-commands">
          <div>
            <strong>{t("Selected folders")}</strong>
            <pre>
              <code>
                {
                  'adc-node roots add "/path/to/folder"\nadc-node roots list\nadc-node roots remove root_id'
                }
              </code>
            </pre>
          </div>
          <div>
            <strong>{t("Home directory")}</strong>
            <pre>
              <code>adc-node access home</code>
            </pre>
          </div>
          <div>
            <strong>{t("Full device trust")}</strong>
            <pre>
              <code>adc-node access full</code>
            </pre>
            <p className="hint">
              {t(
                "Full trust uses the connector user's OS permissions, without ADC command or protected-file filters."
              )}
            </p>
          </div>
          <div>
            <strong>{t("No access")}</strong>
            <pre>
              <code>adc-node access none</code>
            </pre>
          </div>
        </div>
      </details>
    </section>
  );
}
function Projects({ request, revision, refresh, onError }: PageProps) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectRecord[]>([]),
    [roots, setRoots] = useState<RootRecord[]>([]),
    [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [creating, setCreating] = useState(false),
    [adding, setAdding] = useState(""),
    [nodeId, setNodeId] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([request("/api/v1/projects"), request("/api/v1/nodes")])
      .then(async ([p, n]) => {
        const loaded = await Promise.all(
          p.projects.map((project: ProjectRecord) =>
            request(`/api/v1/projects/${project.projectId}/roots`)
          )
        );
        if (active) {
          setProjects(p.projects);
          setNodes(n.nodes);
          setRoots(loaded.flatMap((body) => body.roots));
        }
      })
      .catch((error) => {
        if (active) onError(error.message);
      });
    return () => {
      active = false;
    };
  }, [request, revision, onError]);
  const submit = async (event: FormEvent<HTMLFormElement>, projectId?: string) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request(projectId ? `/api/v1/projects/${projectId}/roots` : "/api/v1/projects", {
        method: "POST",
        body: JSON.stringify(
          projectId
            ? {
                rootId: data.get("rootId"),
                nodeId,
                label: data.get("label"),
                writable: data.get("writable") === "on"
              }
            : { label: data.get("label") }
        )
      });
      setCreating(false);
      setAdding("");
      refresh();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="page">
      <PageHeader
        title={t("Projects & folders")}
        count={projects.length}
        action={
          <button className="primary" onClick={() => setCreating(true)}>
            <CirclePlus size={16} />
            {t("New project")}
          </button>
        }
      />
      <p className="description">
        {t("Optional groups for existing workflows. Authorize devices directly from Agent access.")}
      </p>
      {creating ? (
        <form className="inline-form" onSubmit={(event) => submit(event)}>
          <input
            name="label"
            aria-label={t("Project name")}
            placeholder={t("Project name")}
            maxLength={128}
            required
          />
          <button className="primary" disabled={busy}>
            {t("Create")}
          </button>
          <button className="secondary" type="button" onClick={() => setCreating(false)}>
            {t("Cancel")}
          </button>
        </form>
      ) : null}
      <div className="project-list">
        {projects.map((project) => (
          <div className="project-row" key={project.projectId}>
            <div className="project-title">
              <FolderRoot size={19} />
              <strong>{project.label}</strong>
              <code>{project.projectId}</code>
              <button
                className="icon-button"
                aria-label={t("Add authorized root")}
                onClick={() => {
                  setAdding(project.projectId);
                  setNodeId("");
                }}
              >
                <CirclePlus size={16} />
              </button>
            </div>
            {adding === project.projectId ? (
              <form
                className="inline-form root-form"
                onSubmit={(event) => submit(event, project.projectId)}
              >
                <select
                  required
                  aria-label={t("Device")}
                  value={nodeId}
                  onChange={(event) => setNodeId(event.target.value)}
                >
                  <option value="" disabled>
                    {t("Device")}
                  </option>
                  {nodes
                    .filter((node) => node.status === "active")
                    .map((node) => (
                      <option key={node.nodeId} value={node.nodeId}>
                        {node.label}
                      </option>
                    ))}
                </select>
                <select
                  name="rootId"
                  aria-label={t("Device folder")}
                  key={nodeId}
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    {t("Advertised device folder")}
                  </option>
                  {nodes
                    .find((node) => node.nodeId === nodeId)
                    ?.capability?.roots.map((root) => (
                      <option key={root.rootId} value={root.rootId}>
                        {root.path ?? root.label} ({t(root.writable ? "Write" : "Read")})
                      </option>
                    ))}
                </select>
                <input
                  name="label"
                  aria-label={t("Folder label")}
                  placeholder={t("Folder label")}
                  maxLength={128}
                  required
                />
                <label className="checkbox">
                  <input name="writable" type="checkbox" />
                  {t("Writable")}
                </label>
                <button className="primary" disabled={busy}>
                  {t("Add")}
                </button>
                <button className="secondary" type="button" onClick={() => setAdding("")}>
                  {t("Cancel")}
                </button>
              </form>
            ) : null}
            <div className="root-list">
              {roots
                .filter((root) => root.projectId === project.projectId)
                .map((root) => (
                  <div className="root-row" key={`${root.nodeId}:${root.rootId}`}>
                    <FolderRoot size={16} />
                    <span>{root.label}</span>
                    <code>{root.path ?? root.rootId}</code>
                    <span>{nodes.find((node) => node.nodeId === root.nodeId)?.label}</span>
                    <span className="state">{t(root.writable ? "Write" : "Read")}</span>
                  </div>
                ))}
            </div>
          </div>
        ))}
        {!projects.length ? <Empty icon={<FolderRoot />} label={t("No projects")} /> : null}
      </div>
    </section>
  );
}
function Access({ request, revision, refresh, onError }: PageProps) {
  const { t, term, date } = useI18n();
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]),
    [busy, setBusy] = useState("");
  useEffect(() => {
    request("/api/v1/approvals")
      .then((body) => setApprovals(body.approvals))
      .catch((error) => onError(error.message));
  }, [request, revision, onError]);
  const resolve = async (approvalId: string, decision: "approved" | "denied") => {
    setBusy(approvalId);
    try {
      await request(`/api/v1/approvals/${approvalId}`, {
        method: "POST",
        body: JSON.stringify({ decision })
      });
      refresh();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="page">
      <PageHeader
        title={t("Approvals")}
        count={approvals.filter((item) => item.status === "pending").length}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {(["Requested", "Tool", "Agent", "Device", "Path", "Status"] as const).map(
                (title) => (
                  <th key={title}>{t(title)}</th>
                )
              )}
              <th aria-label={t("Actions")} />
            </tr>
          </thead>
          <tbody>
            {approvals.map((item) => (
              <tr key={item.approvalId}>
                <td>{date(item.createdAt)}</td>
                <td>
                  <strong>{item.invocation.tool}</strong>
                  <details>
                    <summary>{t("Requested arguments")}</summary>
                    <pre className="approval-args">
                      {JSON.stringify(item.invocation.args, null, 2)}
                    </pre>
                  </details>
                </td>
                <td>
                  <code>{item.invocation.actor.id}</code>
                </td>
                <td>
                  <code>{item.nodeId}</code>
                </td>
                <td>
                  <code>
                    {item.path ??
                      String(item.invocation.args.path ?? item.invocation.args.cwd ?? "—")}
                  </code>
                </td>
                <td>
                  <span className={`state ${item.status}`}>{term(item.status)}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      aria-label={t("Approve")}
                      disabled={
                        busy === item.approvalId ||
                        item.status !== "pending" ||
                        Date.parse(item.expiresAt) <= Date.now()
                      }
                      onClick={() => resolve(item.approvalId, "approved")}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={t("Deny")}
                      disabled={busy === item.approvalId || item.status !== "pending"}
                      onClick={() => resolve(item.approvalId, "denied")}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!approvals.length ? <Empty icon={<ShieldCheck />} label={t("No approvals")} /> : null}
      </div>
    </section>
  );
}
function Audit({ request, revision, onError }: PageProps) {
  const { t, term, date } = useI18n();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => {
    request("/api/v1/audit")
      .then((body) => setEvents(body.events.slice().reverse()))
      .catch((error) => onError(error.message));
  }, [request, revision, onError]);
  return (
    <section className="page">
      <PageHeader title={t("Activity")} count={events.length} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {(
                ["Time", "Event", "Invocation", "Device", "Path", "Decision / Status"] as const
              ).map((title) => (
                <th key={title}>{t(title)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.eventId}>
                <td>{date(event.createdAt)}</td>
                <td>{event.type}</td>
                <td>
                  <code>{event.invocationId ?? "—"}</code>
                </td>
                <td>
                  <code>{event.payload.nodeId ?? "—"}</code>
                </td>
                <td>
                  <code>{event.payload.path ?? "—"}</code>
                </td>
                <td>
                  {term(event.payload.policyDecision?.reasonCode ?? event.payload.status ?? "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length ? <Empty icon={<Activity />} label={t("No activity yet")} /> : null}
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <BrowserRouter>
        <AnalyticsEffects />
        <App />
      </BrowserRouter>
    </LocaleProvider>
  </StrictMode>
);
