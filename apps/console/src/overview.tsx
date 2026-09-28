import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  Cable,
  Check,
  Circle,
  KeyRound,
  ShieldCheck
} from "lucide-react";
import { Link } from "react-router-dom";
import type { Request } from "./auth-ui.tsx";
import { useI18n, type Message } from "./i18n.tsx";
import type { NodeRecord } from "./main.tsx";

interface GrantSummary {
  grantId: string;
  revokedAt?: string;
}

interface ApprovalSummary {
  approvalId: string;
  status: string;
}

interface CredentialSummary {
  credentialId: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface BindingSummary {
  clientId: string;
  revokedAt: string | null;
}

interface ActivitySummary {
  eventId: string;
  type: string;
  createdAt: string;
  payload: { nodeId?: string; path?: string; status?: string };
}

interface OverviewData {
  nodes: NodeRecord[];
  grants: GrantSummary[];
  approvals: ApprovalSummary[];
  credentials: CredentialSummary[];
  bindings: BindingSummary[];
  events: ActivitySummary[];
}

const emptyData: OverviewData = {
  nodes: [],
  grants: [],
  approvals: [],
  credentials: [],
  bindings: [],
  events: []
};

export function Overview({
  request,
  revision,
  onError
}: {
  request: Request;
  revision: number;
  onError: (message: string) => void;
}) {
  const { t, date, term } = useI18n();
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      request("/api/v1/nodes"),
      request("/api/v1/grants"),
      request("/api/v1/approvals"),
      request("/api/v1/credentials"),
      request("/api/v1/oauth/bindings"),
      request("/api/v1/audit")
    ])
      .then(([nodes, grants, approvals, credentials, bindings, audit]) => {
        if (!active) return;
        setData({
          nodes: nodes.nodes,
          grants: grants.grants,
          approvals: approvals.approvals,
          credentials: credentials.credentials,
          bindings: bindings.bindings,
          events: audit.events
        });
        setLoaded(true);
      })
      .catch((error) => {
        if (active) onError((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [request, revision, onError]);

  const activeNodes = data.nodes.filter((node) => node.status === "active");
  const onlineNodes = activeNodes.filter((node) => node.online);
  const activeGrants = data.grants.filter((grant) => !grant.revokedAt);
  const pendingApprovals = data.approvals.filter((approval) => approval.status === "pending");
  const activeCredentials = data.credentials.filter(
    (credential) => !credential.revokedAt && Date.parse(credential.expiresAt) > Date.now()
  );
  const activeBindings = data.bindings.filter((binding) => !binding.revokedAt);
  const clientConnections = activeCredentials.length + activeBindings.length;
  const offline = activeNodes.length - onlineNodes.length;
  const stats: Array<[Message, number, typeof Cable]> = [
    ["Connected devices", activeNodes.length, Cable],
    ["Online now", onlineNodes.length, Activity],
    ["Active agents", activeGrants.length, Bot],
    ["Pending approvals", pendingApprovals.length, ShieldCheck],
    ["Client connections", clientConnections, KeyRound]
  ];
  const setup: Array<{
    title: Message;
    description: Message;
    complete: boolean;
    to: string;
  }> = [
    {
      title: "Device connected",
      description: "Pair and configure a device.",
      complete: activeNodes.length > 0,
      to: "/app/devices"
    },
    {
      title: "Agent authorized",
      description: "Define an agent's devices and capabilities.",
      complete: activeGrants.length > 0,
      to: "/app/agents"
    },
    {
      title: "Client connected",
      description: "Connect the CLI or an MCP client.",
      complete: clientConnections > 0,
      to: "/app/agents"
    }
  ];
  const recent = data.events.slice(-5).reverse();

  return (
    <section className="page overview-page">
      <div className="page-header">
        <div>
          <h1>{t("Overview")}</h1>
        </div>
        <Link className="secondary" to="/docs">
          {t("Docs")}
          <ArrowRight size={15} />
        </Link>
      </div>
      <p className="description">
        {t("Follow setup progress, review pending decisions and see recent account activity.")}
      </p>
      <div className="overview-stats" aria-busy={!loaded}>
        {stats.map(([label, value, Icon]) => (
          <div key={label}>
            <Icon size={17} />
            <strong>{loaded ? value : "—"}</strong>
            <span>{t(label)}</span>
          </div>
        ))}
      </div>
      <div
        className={`overview-health ${offline > 0 || activeNodes.length === 0 ? "attention" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span
          className={`status-dot ${offline > 0 || activeNodes.length === 0 ? "offline" : "online"}`}
        />
        <strong>
          {t(
            !loaded
              ? "Loading…"
              : offline > 0 || activeNodes.length === 0
                ? "Attention needed"
                : "Everything connected at a glance."
          )}
        </strong>
        <span>
          {t(
            !loaded
              ? "Loading your account…"
              : activeNodes.length === 0
                ? "Pair and configure a device."
                : offline > 0
                  ? "{count} devices are offline."
                  : "All connected devices are online.",
            { count: offline }
          )}
        </span>
      </div>
      <div className="overview-columns">
        <section>
          <h2>{t("Setup progress")}</h2>
          <div className="setup-list">
            {setup.map((item) => (
              <Link key={item.title} to={item.to}>
                <span className={item.complete ? "complete" : ""}>
                  {item.complete ? <Check size={15} /> : <Circle size={15} />}
                </span>
                <span>
                  <strong>{t(item.title)}</strong>
                  <small>{t(item.description)}</small>
                </span>
                <span className="setup-state">{t(item.complete ? "Complete" : "Next")}</span>
                <ArrowRight size={15} />
              </Link>
            ))}
          </div>
          {pendingApprovals.length ? (
            <Link className="secondary overview-action" to="/app/approvals">
              <ShieldCheck size={15} />
              {t("Review approvals")}
            </Link>
          ) : null}
        </section>
        <section>
          <div className="section-heading">
            <h2>{t("Recent activity")}</h2>
            <Link to="/app/activity">{t("Review all activity")}</Link>
          </div>
          <div className="activity-list">
            {recent.map((event) => (
              <div key={event.eventId}>
                <span className="activity-mark" />
                <span>
                  <strong>{event.type}</strong>
                  <small>
                    {event.payload.path ??
                      event.payload.nodeId ??
                      term(event.payload.status ?? "—")}
                  </small>
                </span>
                <time>{date(event.createdAt)}</time>
              </div>
            ))}
            {loaded && !recent.length ? <p>{t("No recent activity.")}</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
