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
import { trackAnalytics } from "./analytics.tsx";
import type { Request } from "./auth-ui.tsx";
import { useI18n, type Message } from "./i18n.tsx";
interface ActivitySummary {
  eventId: string;
  type: string;
  createdAt: string;
  payload: { nodeId?: string; path?: string; status?: string };
}

interface OverviewData {
  counts: {
    connectedDevices: number;
    onlineNow: number;
    activeAgents: number;
    pendingApprovals: number;
    clientConnections: number;
  };
  recentActivity: ActivitySummary[];
}

const emptyData: OverviewData = {
  counts: {
    connectedDevices: 0,
    onlineNow: 0,
    activeAgents: 0,
    pendingApprovals: 0,
    clientConnections: 0
  },
  recentActivity: []
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
    request("/api/v1/overview")
      .then((body) => {
        if (!active) return;
        setData(body);
        setLoaded(true);
      })
      .catch((error) => {
        if (active) onError((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [request, revision, onError]);

  const offline = data.counts.connectedDevices - data.counts.onlineNow;
  const hasNoDevices = data.counts.connectedDevices === 0;
  useEffect(() => {
    if (
      !loaded ||
      !data.counts.connectedDevices ||
      !data.counts.activeAgents ||
      !data.counts.clientConnections
    )
      return;
    try {
      if (localStorage.getItem("adc.analytics.setup-complete.v1") === "1") return;
    } catch {
      /* Browser storage is optional. */
    }
    if (!trackAnalytics("setup_completed")) return;
    try {
      localStorage.setItem("adc.analytics.setup-complete.v1", "1");
    } catch {
      /* Browser storage is optional. */
    }
  }, [
    data.counts.activeAgents,
    data.counts.clientConnections,
    data.counts.connectedDevices,
    loaded
  ]);
  const stats: Array<[Message, number, typeof Cable]> = [
    ["Connected devices", data.counts.connectedDevices, Cable],
    ["Online now", data.counts.onlineNow, Activity],
    ["Active agents", data.counts.activeAgents, Bot],
    ["Pending approvals", data.counts.pendingApprovals, ShieldCheck],
    ["Client connections", data.counts.clientConnections, KeyRound]
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
      complete: data.counts.connectedDevices > 0,
      to: "/app/devices"
    },
    {
      title: "Agent authorized",
      description: "Define an agent's devices and capabilities.",
      complete: data.counts.activeAgents > 0,
      to: "/app/agents"
    },
    {
      title: "Client connected",
      description: "Connect the CLI or an MCP client.",
      complete: data.counts.clientConnections > 0,
      to: "/app/agents"
    }
  ];
  const recent = data.recentActivity;

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
        className={`overview-health ${offline > 0 || hasNoDevices ? "attention" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span className={`status-dot ${offline > 0 || hasNoDevices ? "offline" : "online"}`} />
        <strong>
          {t(
            !loaded
              ? "Loading…"
              : offline > 0 || hasNoDevices
                ? "Attention needed"
                : "Everything connected at a glance."
          )}
        </strong>
        <span>
          {t(
            !loaded
              ? "Loading your account…"
              : hasNoDevices
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
          {data.counts.pendingApprovals ? (
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
