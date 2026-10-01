import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { CirclePlus, Clipboard, ShieldCheck, X } from "lucide-react";
import { AuthLayout, type Request } from "./auth-ui.tsx";
import { useI18n, type Message } from "./i18n.tsx";
import type { NodeRecord } from "./main.tsx";
import { ConfirmAction, Dialog } from "./dialog.tsx";

interface Grant {
  grantId: string;
  name: string;
  profile: string;
  projectId?: string;
  nodeIds: string[];
  rootIds: string[];
  rootAccess?: "selected" | "all";
  resourcesByNode?: Record<string, Array<{ rootId: string; path?: string }>>;
  approvalPolicy?: string;
  allowedTools: string[];
  revokedAt?: string;
  revision?: number;
}
interface Credential {
  credentialId: string;
  name: string;
  grantId: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
interface Binding {
  clientId: string;
  grantId: string;
  revokedAt: string | null;
}
interface Project {
  projectId: string;
  label: string;
}
interface Root {
  rootId: string;
  nodeId: string;
  path?: string;
  label: string;
  writable: boolean;
}
const readTools = [
  "device.list",
  "device.status",
  "file.list",
  "file.read",
  "file.search",
  "command.template.list",
  "task.status",
  "task.result"
];
const fileTools = ["file.write", "file.edit", "file.patch"];
const runTools = ["shell.exec", "command.template.run", "test.run", "task.cancel"];
const levels: [string, Message, string[]][] = [
  ["read", "Read only", readTools],
  ["write", "Read & write", [...readTools, ...fileTools]],
  ["run", "Read, write & run", [...readTools, ...fileTools, ...runTools]],
  [
    "templates",
    "Approved templates only",
    [...readTools, "command.template.run", "test.run", "task.cancel"]
  ]
];
const approvalLabels: Record<string, Message> = {
  never: "No approval",
  writes: "Before changes or execution",
  execute: "Before execution",
  always: "Every device operation"
};
function approvalLabel(grant: Grant): Message {
  return (
    approvalLabels[grant.approvalPolicy ?? ""] ??
    (grant.profile === "approve-required" ? "Before changes or execution" : "Legacy policy")
  );
}

export function Agents({
  request,
  revision,
  refresh,
  onError
}: {
  request: Request;
  revision: number;
  refresh: () => void;
  onError: (error: string) => void;
}) {
  const { t, date } = useI18n();
  const [grants, setGrants] = useState<Grant[]>([]),
    [credentials, setCredentials] = useState<Credential[]>([]),
    [bindings, setBindings] = useState<Binding[]>([]);
  const [projects, setProjects] = useState<Project[]>([]),
    [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [creating, setCreating] = useState(false),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState<Grant>();
  const [editing, setEditing] = useState<Grant>();
  const [action, setAction] = useState<{ grant: Grant; kind: "delete" | "revoke" }>();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("active");
  const [notice, setNotice] = useState<Message>();
  const visibleGrants = grants.filter(
    (grant) =>
      (filter === "all" || (filter === "active" ? !grant.revokedAt : !!grant.revokedAt)) &&
      grant.name.toLowerCase().includes(search.toLowerCase())
  );
  useEffect(() => {
    let active = true;
    Promise.all(
      ["grants", "credentials", "oauth/bindings", "projects", "nodes"].map((path) =>
        request(`/api/v1/${path}`)
      )
    )
      .then(([g, c, b, p, n]) => {
        if (active) {
          setGrants(g.grants);
          setCredentials(c.credentials);
          setBindings(b.bindings);
          setProjects(p.projects);
          setNodes(n.nodes);
        }
      })
      .catch((error) => {
        if (active) onError(error.message);
      });
    return () => {
      active = false;
    };
  }, [request, revision, onError]);
  const revoke = async (path: string, body: object = {}) => {
    if (!window.confirm(t("Revoke this access? Existing connections using it will stop working.")))
      return;
    setBusy(true);
    try {
      await request(`/api/v1/${path}`, { method: "POST", body: JSON.stringify(body) });
      refresh();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const createToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await request("/api/v1/credentials", {
        method: "POST",
        body: JSON.stringify({
          grantId: data.get("grant"),
          name: data.get("name"),
          expiresInDays: Number(data.get("days"))
        })
      });
      setToken(result.token);
      refresh();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="page">
      <div className="page-header">
        <h1>{t("Agent access")}</h1>
        <button
          className="primary"
          onClick={() => {
            setEditing(undefined);
            setCreating(true);
          }}
        >
          <CirclePlus size={16} />
          {t("Authorize agent")}
        </button>
      </div>
      <p className="description">
        {t(
          "Choose devices, capabilities and approvals. Use the same access through MCP, CLI, Skills or SDK."
        )}
      </p>
      {notice ? (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      ) : null}
      {creating || editing ? (
        <GrantForm
          key={editing?.grantId ?? "new"}
          {...(editing ? { initial: editing } : {})}
          request={request}
          projects={projects}
          nodes={nodes}
          onError={onError}
          onClose={() => {
            setCreating(false);
            setEditing(undefined);
          }}
          onCreated={() => {
            setCreating(false);
            setEditing(undefined);
            setNotice(
              editing
                ? "Authorization updated. Existing connections use the saved permissions."
                : "Agent authorized."
            );
            refresh();
          }}
        />
      ) : null}
      {action ? (
        <ConfirmAction
          title={t(
            action.kind === "delete"
              ? "Delete authorization {name}?"
              : "Revoke authorization {name}?",
            { name: action.grant.name }
          )}
          description={t(
            action.kind === "delete"
              ? "This authorization and its connections will be removed from the list. Execution history is kept."
              : "All connections for this authorization stop working. You can still view or delete the revoked authorization."
          )}
          actionLabel={t(action.kind === "delete" ? "Delete" : "Revoke")}
          onClose={() => setAction(undefined)}
          onConfirm={async () => {
            await request(
              `/api/v1/grants/${action.grant.grantId}${action.kind === "revoke" ? "/revoke" : ""}`,
              {
                method: action.kind === "delete" ? "DELETE" : "POST",
                body: JSON.stringify(
                  action.kind === "delete" ? { revision: action.grant.revision ?? 1 } : {}
                )
              }
            );
            setToken("");
            setNotice(
              action.kind === "delete" ? "Authorization deleted." : "Authorization revoked."
            );
            refresh();
          }}
        />
      ) : null}
      {connecting ? (
        <div className="card token-card" role="status">
          <div className="page-header">
            <h2>{t("Connect CLI")}</h2>
            <button
              className="icon-button"
              aria-label={t("Close")}
              onClick={() => setConnecting(undefined)}
            >
              <X size={16} />
            </button>
          </div>
          <p className="description">
            {t("Sign in once in your terminal, then connect this access without copying a token.")}
          </p>
          <div className="token-value">
            <code>adc connect {connecting.grantId} --json</code>
            <button
              className="icon-button"
              aria-label={t("Copy command")}
              onClick={() =>
                void navigator.clipboard
                  .writeText(`adc connect ${connecting.grantId} --json`)
                  .catch(() => onError(t("Could not copy. Select and copy the command above.")))
              }
            >
              <Clipboard size={16} />
            </button>
          </div>
          <p className="hint">
            <code>adc login --url {window.location.origin}</code>
          </p>
        </div>
      ) : null}
      {token ? (
        <div className="card token-card" role="status">
          <div className="page-header">
            <h2>{t("Copy your access key")}</h2>
            <button
              className="icon-button"
              aria-label={t("Dismiss access key")}
              onClick={() => setToken("")}
            >
              <X size={16} />
            </button>
          </div>
          <p className="description">
            {t("This access key is shown once. Store it with your application's secrets.")}
          </p>
          <div className="token-value">
            <code>{token}</code>
            <button
              className="icon-button"
              aria-label={t("Copy access key")}
              onClick={() =>
                void navigator.clipboard
                  .writeText(token)
                  .catch(() => onError(t("Copy failed. Select and copy the access key manually.")))
              }
            >
              <Clipboard size={16} />
            </button>
          </div>
          <p className="hint">
            <code>adc auth token --url {window.location.origin}</code>
            <br />
            {t("Paste the access key when prompted.")}
          </p>
        </div>
      ) : null}
      <div className="resource-toolbar">
        <input
          aria-label={t("Search authorizations")}
          placeholder={t("Search authorizations")}
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
      <div className="resource-list">
        {visibleGrants.map((grant) => (
          <div className="resource-row" key={grant.grantId}>
            <div>
              <strong>{grant.name}</strong>
              <p className="hint">
                {grant.projectId
                  ? `${projects.find((project) => project.projectId === grant.projectId)?.label ?? grant.projectId} · `
                  : ""}
                {t("{count} devices", { count: grant.nodeIds.length })} ·{" "}
                {t(grant.rootAccess === "all" ? "All exposed folders" : "{count} folders", {
                  count: grant.rootIds.length
                })}{" "}
                · {t(approvalLabel(grant))}
              </p>
              <details>
                <summary>{t("Tool permissions")}</summary>
                <p className="tool-list">{grant.allowedTools.join(", ")}</p>
              </details>
              {Object.keys(grant.resourcesByNode ?? {}).length ? (
                <details>
                  <summary>{t("Folders")}</summary>
                  <p className="tool-list">
                    {Object.entries(grant.resourcesByNode ?? {})
                      .flatMap(([nodeId, roots]) =>
                        roots.map(
                          (root) =>
                            `${nodes.find((node) => node.nodeId === nodeId)?.label ?? nodeId}: ${root.path ?? root.rootId}`
                        )
                      )
                      .join(" · ")}
                  </p>
                </details>
              ) : null}
            </div>
            <div className="row-actions">
              {grant.revokedAt ? (
                <span className="state revoked">{t("Revoked")}</span>
              ) : (
                <>
                  <button
                    className="secondary"
                    onClick={() => {
                      setCreating(false);
                      setEditing(grant);
                    }}
                  >
                    {t("Edit")}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setToken("");
                      setConnecting(grant);
                    }}
                  >
                    {t("Connect CLI")}
                  </button>
                  <button
                    className="secondary danger"
                    disabled={busy}
                    onClick={() => setAction({ grant, kind: "revoke" })}
                  >
                    {t("Revoke")}
                  </button>
                </>
              )}
              <button
                className="secondary danger"
                onClick={() => setAction({ grant, kind: "delete" })}
              >
                {t("Delete")}
              </button>
            </div>
          </div>
        ))}
        {!visibleGrants.length ? (
          <div className="empty">
            <ShieldCheck size={20} />
            {t(grants.length ? "No matching authorizations" : "No agents authorized yet")}
          </div>
        ) : null}
      </div>
      <details className="advanced-permissions">
        <summary>{t("Advanced access keys")}</summary>
        <p className="description">
          {t(
            "Access keys are only needed for SDKs and clients that cannot use OAuth or adc connect."
          )}
        </p>
        <form className="connection-form" onSubmit={createToken}>
          <label>
            {t("Access")}
            <select name="grant" required defaultValue="">
              <option value="" disabled>
                {t("Choose an authorization")}
              </option>
              {grants
                .filter((grant) => !grant.revokedAt)
                .map((grant) => (
                  <option key={grant.grantId} value={grant.grantId}>
                    {grant.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("Name")}
            <input name="name" placeholder={t("SDK integration")} maxLength={128} required />
          </label>
          <label>
            {t("Expires in")}
            <select name="days" defaultValue="30">
              {[7, 30, 90].map((days) => (
                <option key={days} value={days}>
                  {t("{days} days", { days })}
                </option>
              ))}
              <option value="365">{t("1 year")}</option>
            </select>
          </label>
          <button
            className="secondary"
            disabled={busy || !grants.some((grant) => !grant.revokedAt)}
          >
            {t("Create access key")}
          </button>
        </form>
        <div className="resource-list">
          {credentials.map((credential) => (
            <div className="resource-row" key={credential.credentialId}>
              <div>
                <strong>{credential.name}</strong>
                <p className="hint">
                  {grants.find((grant) => grant.grantId === credential.grantId)?.name} ·{" "}
                  {t("Expires {date}", { date: date(credential.expiresAt) })} ·{" "}
                  {credential.lastUsedAt
                    ? t("Last used {date}", { date: date(credential.lastUsedAt) })
                    : t("Never used")}
                </p>
              </div>
              {credential.revokedAt ? (
                <span className="state revoked">{t("Revoked")}</span>
              ) : Date.parse(credential.expiresAt) <= Date.now() ? (
                <span className="state expired">{t("Expired")}</span>
              ) : (
                <button
                  className="secondary danger"
                  disabled={busy}
                  onClick={() => revoke(`credentials/${credential.credentialId}/revoke`)}
                >
                  {t("Revoke")}
                </button>
              )}
            </div>
          ))}
          {!credentials.length ? <p className="empty">{t("No access keys created")}</p> : null}
        </div>
      </details>
      <h2>{t("MCP connections")}</h2>
      <div className="card">
        <p className="description">
          {t(
            "Add this URL in an MCP client that supports OAuth, then sign in and choose an authorization."
          )}
        </p>
        <code>{window.location.origin}/mcp</code>
        <details className="mcp-config">
          <summary>{t("For clients using an access key, add this MCP configuration.")}</summary>
          <pre>
            <code>
              {JSON.stringify(
                {
                  mcpServers: {
                    adc: {
                      url: `${window.location.origin}/mcp`,
                      headers: { Authorization: "Bearer <ACCESS_KEY>" }
                    }
                  }
                },
                null,
                2
              )}
            </code>
          </pre>
        </details>
      </div>
      <div className="resource-list">
        {bindings.map((binding) => (
          <div className="resource-row" key={binding.clientId}>
            <div>
              <strong>
                {grants.find((grant) => grant.grantId === binding.grantId)?.name ?? "MCP"}
              </strong>
              <code className="subtle">{binding.clientId}</code>
            </div>
            {binding.revokedAt ? (
              <span className="state revoked">{t("Revoked")}</span>
            ) : (
              <button
                className="secondary danger"
                disabled={busy}
                onClick={() => revoke("oauth/bindings/revoke", { clientId: binding.clientId })}
              >
                {t("Disconnect")}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function GrantForm({
  request,
  projects,
  nodes,
  onError,
  onClose,
  onCreated,
  initial
}: {
  request: Request;
  projects: Project[];
  nodes: NodeRecord[];
  onError: (message: string) => void;
  onClose: () => void;
  onCreated: () => void;
  initial?: Grant;
}) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState(initial?.projectId ?? ""),
    [roots, setRoots] = useState<Root[]>([]);
  const [level, setLevel] = useState(
      initial
        ? (levels.find(
            ([, , allowed]) =>
              allowed.length === initial.allowedTools.length &&
              allowed.every((tool) => initial.allowedTools.includes(tool))
          )?.[0] ?? "custom")
        : "read"
    ),
    [tools, setTools] = useState(initial?.allowedTools ?? readTools);
  const [profile, setProfile] = useState(initial?.profile ?? "workspace-write");
  const [approval, setApproval] = useState(
      initial?.approvalPolicy ?? (initial?.profile === "approve-required" ? "writes" : "never")
    ),
    [rootAccess, setRootAccess] = useState(initial?.rootAccess ?? (initial ? "selected" : "all"));
  const [nodeIds, setNodeIds] = useState<string[]>(initial?.nodeIds ?? []),
    [rootIds, setRootIds] = useState<string[]>(initial?.rootIds ?? []),
    [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    if (!projectId) {
      setRoots(
        nodes.flatMap((node) =>
          (node.capability?.roots ?? []).map((root) => ({ ...root, nodeId: node.nodeId }))
        )
      );
      return;
    }
    let active = true;
    setRootAccess("selected");
    setRoots([]);
    request(`/api/v1/projects/${projectId}/roots`)
      .then((body) => {
        if (active) setRoots(body.roots);
      })
      .catch((error) => {
        if (active) setFormError(error.message);
      });
    return () => {
      active = false;
    };
  }, [request, projectId, nodes, onError]);
  const available = roots.filter((root) => nodeIds.includes(root.nodeId));
  const presetToolIds = new Set([...readTools, ...fileTools, ...runTools]);
  const nativeById = new Map<string, { name: string; title: string; nodeIds: Set<string> }>();
  const customById = new Map<
    string,
    {
      name: string;
      title: string;
      provider: string;
      nodeIds: Set<string>;
    }
  >();
  for (const node of nodes.filter(
    (candidate) => candidate.status === "active" && nodeIds.includes(candidate.nodeId)
  )) {
    const effectiveToolIds = new Set(
      (node.effectiveCapability ?? node.capability)?.tools.map((tool) => tool.name) ?? []
    );
    for (const tool of (node.capability ?? node.effectiveCapability)?.tools ?? []) {
      if (!tool.name.startsWith("mcp.")) {
        if (presetToolIds.has(tool.name)) continue;
        const current = nativeById.get(tool.name);
        if (current) current.nodeIds.add(node.nodeId);
        else
          nativeById.set(tool.name, {
            name: tool.name,
            title: tool.title ?? tool.name,
            nodeIds: new Set([node.nodeId])
          });
        continue;
      }
      if (!effectiveToolIds.has(tool.name)) continue;
      const current = customById.get(tool.name);
      if (current) {
        current.nodeIds.add(node.nodeId);
      } else {
        customById.set(tool.name, {
          name: tool.name,
          title: tool.title ?? tool.provider?.sourceToolName ?? tool.name,
          provider: tool.provider?.providerName ?? tool.provider?.providerId ?? "MCP",
          nodeIds: new Set([node.nodeId])
        });
      }
    }
  }
  const nativeTools = [...nativeById.values()].sort((left, right) =>
    left.title.localeCompare(right.title)
  );
  const customTools = [...customById.values()].sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) || left.title.localeCompare(right.title)
  );
  const unavailableCustomTools = tools
    .filter((tool) => tool.startsWith("mcp.") && !customById.has(tool))
    .sort();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!projectId && !nodeIds.length) {
      setFormError(t("Choose one or more devices."));
      return;
    }
    const selectedRoots = rootIds;
    setFormError("");
    setBusy(true);
    try {
      await request(initial ? `/api/v1/grants/${initial.grantId}` : "/api/v1/grants", {
        method: initial ? "PATCH" : "POST",
        body: JSON.stringify({
          name: data.get("name"),
          ...(projectId ? { projectId } : {}),
          profile,
          nodeIds,
          rootAccess,
          rootIds: rootAccess === "all" ? [] : selectedRoots,
          approvalPolicy: approval,
          ...(initial ? { revision: initial.revision ?? 1 } : {}),
          allowedTools: tools
        })
      });
      onCreated();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t(initial ? "Edit authorization" : "Authorize agent")}
      onClose={onClose}
      busy={busy}
      wide
    >
      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}
      {initial ? (
        <p className="description">
          {t("Changes apply to existing connections. No reconnection is needed.")}
        </p>
      ) : null}
      <form className="grant-form" onSubmit={submit}>
        <div className="form-grid">
          <label>
            {t("Agent name")}
            <input
              name="name"
              defaultValue={initial?.name ?? ""}
              maxLength={128}
              required
              placeholder={t("Coding assistant")}
            />
          </label>
          <label>
            {t("Capabilities")}
            <select
              value={level}
              onChange={(event) => {
                setLevel(event.target.value);
                setProfile("workspace-write");
                setTools(levels.find(([id]) => id === event.target.value)![2]);
              }}
            >
              {levels.map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label)}
                </option>
              ))}
              {level === "custom" ? (
                <option value="custom" disabled>
                  {t("Custom capabilities")}
                </option>
              ) : null}
            </select>
          </label>
          <label>
            {t("Approval policy")}
            <select value={approval} onChange={(event) => setApproval(event.target.value)}>
              {Object.entries(approvalLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>{t("Devices")}</legend>
          <div className="checkbox-grid">
            {nodes
              .filter((node) => node.status === "active" || nodeIds.includes(node.nodeId))
              .map((node) => (
                <label className="checkbox" key={node.nodeId}>
                  <input
                    type="checkbox"
                    checked={nodeIds.includes(node.nodeId)}
                    onChange={(event) => {
                      setNodeIds((ids) =>
                        event.target.checked
                          ? [...ids, node.nodeId]
                          : ids.filter((id) => id !== node.nodeId)
                      );
                      setRootIds([]);
                    }}
                  />
                  {node.label}
                  {node.status !== "active" ? ` · ${t("Unavailable")}` : ""}
                </label>
              ))}
            {nodeIds
              .filter((id) => !nodes.some((node) => node.nodeId === id))
              .map((id) => (
                <label className="checkbox" key={id}>
                  <input
                    type="checkbox"
                    checked
                    onChange={() => {
                      setNodeIds((ids) => ids.filter((value) => value !== id));
                      setRootIds([]);
                    }}
                  />
                  {id} · {t("Unavailable")}
                </label>
              ))}
          </div>
          {!nodes.some((node) => node.status === "active") ? (
            <Link to="/app/devices">{t("Pair device")}</Link>
          ) : null}
        </fieldset>
        <fieldset>
          <legend>{t("Folders")}</legend>
          {!projectId ? (
            <div className="scope-choice">
              <label className="checkbox">
                <input
                  type="radio"
                  name="rootAccess"
                  value="all"
                  checked={rootAccess === "all"}
                  onChange={() => setRootAccess("all")}
                />
                {t("All exposed folders")}
              </label>
              <label className="checkbox">
                <input
                  type="radio"
                  name="rootAccess"
                  value="selected"
                  checked={rootAccess === "selected"}
                  onChange={() => setRootAccess("selected")}
                />
                {t("Choose folders")}
              </label>
            </div>
          ) : null}
          {rootAccess === "all" ? (
            <p className="hint">
              {t(
                "Includes folders you expose later on these devices. Local access remains the upper limit."
              )}
            </p>
          ) : (
            <div className="checkbox-grid">
              {available.map((root) => (
                <label className="checkbox" key={`${root.nodeId}:${root.rootId}`}>
                  <input
                    type="checkbox"
                    checked={rootIds.includes(root.rootId)}
                    onChange={(event) =>
                      setRootIds((ids) =>
                        event.target.checked
                          ? [...new Set([...ids, root.rootId])]
                          : ids.filter((id) => id !== root.rootId)
                      )
                    }
                  />
                  {root.path ?? root.label} ·{" "}
                  {nodes.find((node) => node.nodeId === root.nodeId)?.label} ·{" "}
                  {t(root.writable ? "Write" : "Read")}
                </label>
              ))}
            </div>
          )}
          {rootAccess === "selected"
            ? rootIds
                .filter((id) => !available.some((root) => root.rootId === id))
                .map((id) => (
                  <label className="checkbox" key={id}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() => setRootIds((ids) => ids.filter((value) => value !== id))}
                    />
                    {id} · {t("Unavailable")}
                  </label>
                ))
            : null}
          {rootAccess === "selected" && !rootIds.length ? (
            <p className="hint">
              {t("No folders selected: device discovery and task tools only.")}
            </p>
          ) : null}
          {!available.length ? (
            <p className="hint">
              {t(
                nodeIds.length
                  ? "No folders exposed yet"
                  : "Select devices to see their exposed folders."
              )}
            </p>
          ) : null}
        </fieldset>
        {tools.some((tool) => runTools.includes(tool) || tool.startsWith("mcp.")) ? (
          <p className="description">
            {t(
              "Commands run with the connector user's OS permissions. Choose execution for agents you trust."
            )}
          </p>
        ) : null}
        <details className="advanced-permissions">
          <summary>{t("Tool permissions")}</summary>
          <div className="checkbox-grid">
            {[...readTools, ...fileTools, ...runTools].map((tool) => (
              <label className="checkbox" key={tool}>
                <input
                  type="checkbox"
                  checked={tools.includes(tool)}
                  onChange={(event) => {
                    setLevel("custom");
                    setProfile("workspace-write");
                    setTools((current) =>
                      event.target.checked
                        ? [...current, tool]
                        : current.filter((value) => value !== tool)
                    );
                  }}
                />
                {tool}
              </label>
            ))}
          </div>
          {nativeTools.length ? (
            <>
              <h3 className="permission-group-title">{t("Device-native capabilities")}</h3>
              <div className="checkbox-grid">
                {nativeTools.map((tool) => (
                  <label className="checkbox capability-choice" key={tool.name}>
                    <input
                      type="checkbox"
                      checked={tools.includes(tool.name)}
                      onChange={(event) => {
                        setLevel("custom");
                        setProfile("workspace-write");
                        setTools((current) =>
                          event.target.checked
                            ? [...new Set([...current, tool.name])]
                            : current.filter((value) => value !== tool.name)
                        );
                      }}
                    />
                    <span>
                      <strong>{tool.title}</strong>
                      <small>
                        {tool.name} · {tool.nodeIds.size}{" "}
                        {t(tool.nodeIds.size === 1 ? "device" : "devices")}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
          {customTools.length || unavailableCustomTools.length ? (
            <>
              <h3 className="permission-group-title">{t("MCP Provider tools")}</h3>
              <div className="checkbox-grid">
                {customTools.map((tool) => (
                  <label className="checkbox capability-choice" key={tool.name}>
                    <input
                      type="checkbox"
                      checked={tools.includes(tool.name)}
                      onChange={(event) => {
                        setLevel("custom");
                        setProfile("workspace-write");
                        setTools((current) =>
                          event.target.checked
                            ? [...new Set([...current, tool.name])]
                            : current.filter((value) => value !== tool.name)
                        );
                      }}
                    />
                    <span>
                      <strong>{tool.title}</strong>
                      <small>
                        {t("{provider} · {count} devices · High risk", {
                          provider: tool.provider,
                          count: tool.nodeIds.size
                        })}
                      </small>
                      <code>{tool.name}</code>
                    </span>
                  </label>
                ))}
                {unavailableCustomTools.map((tool) => (
                  <label className="checkbox capability-choice" key={tool}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setTools((current) => current.filter((value) => value !== tool))
                      }
                    />
                    <span>
                      <strong>{tool}</strong>
                      <small>{t("Unavailable on selected devices")}</small>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </details>
        {projects.length ? (
          <label className="project-choice">
            {t("Project (optional)")}
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setRootIds([]);
              }}
            >
              <option value="">{t("Direct device access")}</option>
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="row-actions form-actions">
          <button
            className="primary"
            disabled={busy || (!projectId && !nodeIds.length) || !tools.length}
          >
            {t(initial ? "Save changes" : "Authorize agent")}
          </button>
          <button className="secondary" type="button" onClick={onClose}>
            {t("Cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function OAuthConsent({ request }: { request: Request }) {
  const { t } = useI18n();
  const location = useLocation();
  const clientId = new URLSearchParams(location.search).get("client_id") ?? "";
  const [clientName, setClientName] = useState(""),
    [grants, setGrants] = useState<Grant[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [resources, setResources] = useState<{
    projects: Project[];
    nodes: NodeRecord[];
    roots: Root[];
  }>({ projects: [], nodes: [], roots: [] });
  useEffect(() => {
    let active = true;
    setLoaded(false);
    Promise.all([
      request(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`),
      request("/api/v1/grants"),
      request("/api/v1/projects"),
      request("/api/v1/nodes")
    ])
      .then(async ([client, body, projects, nodes]) => {
        const roots = await Promise.all(
          projects.projects.map((project: Project) =>
            request(`/api/v1/projects/${project.projectId}/roots`)
          )
        );
        if (active) {
          setClientName(client.client_name || "MCP");
          setGrants(body.grants.filter((grant: Grant) => !grant.revokedAt));
          setResources({
            projects: projects.projects,
            nodes: nodes.nodes,
            roots: roots.flatMap((body) => body.roots)
          });
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [request, clientId]);
  const grant = grants.find((grant) => grant.grantId === selected);
  const decide = async (accept: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (accept)
        await request("/api/v1/oauth/bindings", {
          method: "POST",
          body: JSON.stringify({ clientId, grantId: selected })
        });
      const result = await request("/api/auth/oauth2/consent", {
        method: "POST",
        body: JSON.stringify({ accept, oauth_query: location.search.slice(1) })
      });
      window.location.assign(result.url);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  };
  const roots = grant?.projectId
    ? resources.roots
    : resources.nodes.flatMap((node) => node.capability?.roots ?? []);
  return (
    <AuthLayout wide>
      <h1>{t("Connect {name}", { name: clientName || "Agent" })}</h1>
      <p className="description">
        {t("Choose the access this application will receive. You can disconnect it at any time.")}
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <label className="field">
        {t("Agent authorization")}
        <select value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="">{t("Choose an authorization")}</option>
          {grants.map((grant) => (
            <option key={grant.grantId} value={grant.grantId}>
              {grant.name}
            </option>
          ))}
        </select>
      </label>
      {grant ? (
        <div className="card">
          <h2>{grant.name}</h2>
          <p className="description">
            {t(approvalLabel(grant))}
            {grant.projectId
              ? ` · ${resources.projects.find((project) => project.projectId === grant.projectId)?.label ?? grant.projectId}`
              : ""}
          </p>
          <p className="hint">
            {t("Devices")}:{" "}
            {grant.nodeIds
              .map((id) => resources.nodes.find((node) => node.nodeId === id)?.label ?? id)
              .join(", ") || t("None")}
          </p>
          <p className="hint">
            {t("Folders")}:{" "}
            {grant.rootAccess === "all"
              ? t("All exposed folders")
              : Object.entries(grant.resourcesByNode ?? {})
                  .flatMap(([nodeId, grantedRoots]) =>
                    grantedRoots.map(
                      (root) =>
                        `${resources.nodes.find((node) => node.nodeId === nodeId)?.label ?? nodeId}: ${root.path ?? root.rootId}`
                    )
                  )
                  .join(", ") ||
                grant.rootIds
                  .map((id) => {
                    const root = roots.find((candidate) => candidate.rootId === id);
                    return root?.path ?? root?.label ?? id;
                  })
                  .join(", ") ||
                t("None")}
          </p>
          {grant.rootAccess === "all" ? (
            <p className="hint">
              {t(
                "Includes folders you expose later on these devices. Local access remains the upper limit."
              )}
            </p>
          ) : null}
          <p className="tool-list">{grant.allowedTools.join(", ") || t("No tools")}</p>
          {grant.allowedTools.some((tool) => runTools.includes(tool) || tool.startsWith("mcp.")) ? (
            <p className="description">
              {t("This authorization permits running commands on the selected devices.")}
            </p>
          ) : null}
        </div>
      ) : null}
      {loaded && !grants.length ? (
        <p className="description">
          <Link to="/app/agents" target="_blank" rel="noopener noreferrer">
            {t("Authorize an agent")}
          </Link>{" "}
          {t("in a new tab, then reload this page.")}
        </p>
      ) : null}
      <div className="row-actions form-actions">
        <button
          className="primary"
          disabled={busy || !loaded || !selected}
          onClick={() => decide(true)}
        >
          {t("Allow access")}
        </button>
        <button className="secondary" disabled={busy} onClick={() => decide(false)}>
          {t("Deny")}
        </button>
      </div>
      <p className="hint">
        {t("Application ID")}: <code className="wrap">{clientId}</code>
      </p>
    </AuthLayout>
  );
}
