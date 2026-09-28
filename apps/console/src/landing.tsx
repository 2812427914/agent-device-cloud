import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Bot,
  Check,
  FileCode2,
  KeyRound,
  Laptop,
  Network,
  Server,
  ShieldCheck,
  Waypoints
} from "lucide-react";
import { Link } from "react-router-dom";
import { Brand } from "./auth-ui.tsx";
import { LanguageSelector, useI18n, type Message } from "./i18n.tsx";
import { PublicHeader } from "./public-header.tsx";

const useCases: Array<{
  number: string;
  title: Message;
  description: Message;
  tools: string;
  target: Message;
}> = [
  {
    number: "01",
    title: "Continue local development",
    description:
      "Let an agent inspect a repository, apply focused edits and run existing tests without rebuilding the environment elsewhere.",
    tools: "file.read · file.patch · test.run",
    target: "Developer Mac"
  },
  {
    number: "02",
    title: "Connect existing MCP tools",
    description:
      "Register local stdio or Streamable HTTP MCP servers without moving Provider credentials to the control plane.",
    tools: "GitHub MCP · database MCP",
    target: "Mac, Linux or NAS"
  },
  {
    number: "03",
    title: "Move work across interfaces",
    description:
      "Start from an MCP client, terminal, Skill or SDK and route the same governed work to the intended device.",
    tools: "MCP · CLI · Skill · SDK",
    target: "Selected device"
  },
  {
    number: "04",
    title: "Automate with boundaries",
    description:
      "Use explicit templates, writable folders and approval rules for repeatable work instead of sharing unrestricted access.",
    tools: "grant · approval · receipt",
    target: "Approved device"
  }
];

const architecture: Array<{
  number: string;
  title: Message;
  description: Message;
  icon: typeof Bot;
  modules: Message[];
}> = [
  {
    number: "01",
    title: "Agent interface",
    description: "Use MCP, CLI, Skill or SDK to call authorized tools on the selected device.",
    icon: Bot,
    modules: ["MCP client", "CLI", "Official Skill", "SDK"]
  },
  {
    number: "02",
    title: "Control plane",
    description: "Authenticates, authorizes, routes and records. It does not execute your tools.",
    icon: Waypoints,
    modules: ["Identity", "Authorization", "Placement", "Audit ledger"]
  },
  {
    number: "03",
    title: "Device connector",
    description:
      "Maintains an outbound wake connection, advertises built-in and local MCP tools, and renews active leases.",
    icon: Network,
    modules: ["WebSocket wake", "Built-in tools", "Local MCP Providers", "Lease and ACK"]
  },
  {
    number: "04",
    title: "Local runtime",
    description:
      "Revalidates local policy, runs built-in tools or calls the selected MCP Provider, and persists a receipt.",
    icon: Laptop,
    modules: ["Path validation", "Local execution", "Receipt ledger"]
  }
];

const policyLayers: Array<{ title: Message; detail: Message | "/Users/me/work" }> = [
  { title: "Account boundary", detail: "Same account owner" },
  { title: "Agent grant", detail: "Device and tool selected" },
  { title: "Device policy", detail: "Writes and execution enabled" },
  { title: "Exposed folder", detail: "/Users/me/work" },
  { title: "Live capability", detail: "file.patch advertised" }
];

const dispatchStates: Message[] = ["Authorized", "Queued", "Claimed", "Running", "Succeeded"];

const trustPrinciples: Array<{ title: Message; description: Message; icon: typeof ShieldCheck }> = [
  {
    title: "Separate identities",
    description:
      "User sessions manage the account, Agent credentials use one grant, and every device owns a separate key.",
    icon: KeyRound
  },
  {
    title: "Intersect permissions",
    description:
      "Account, Agent, device, folder and capability rules must all allow the same operation.",
    icon: ShieldCheck
  },
  {
    title: "Keep local authority",
    description:
      "The device validates paths and permissions again. Cloud policy can narrow local access, never expand it.",
    icon: Laptop
  },
  {
    title: "Record side effects",
    description:
      "Idempotency, leases and durable receipts make retries and uncertain outcomes explicit.",
    icon: Activity
  }
];

export function Landing({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<"MCP" | "CLI" | "Skill">("MCP");
  const start = signedIn ? "/app" : "/login";
  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>(".landing [data-reveal]");
    if (!("IntersectionObserver" in window)) {
      sections.forEach((section) => section.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  const snippets = {
    MCP: `${window.location.origin}/mcp`,
    CLI: `adc login --url ${window.location.origin}
adc connect ACCESS
adc node list --json
adc invoke file.read --node node_example \\
  --args '{"path":"/Users/me/work/README.md"}' --json`,
    Skill: "skills/agent-device-cloud/SKILL.md\n\nadc node list --json"
  };

  return (
    <div className="landing">
      <PublicHeader signedIn={signedIn} />

      <main>
        <section className="hero product-hero">
          <div className="hero-copy">
            <p className="eyebrow">
              {t("Public preview · Private device infrastructure for AI agents")}
            </p>
            <h1>Agent Device Cloud</h1>
            <p className="hero-statement">
              {t(
                "Give any AI agent controlled access to the files, tools and environments already on your devices."
              )}
            </p>
            <p className="hero-description">
              {t(
                "Agents keep using MCP, CLI or SDK. ADC authorizes and routes each call; the selected Mac or Linux device runs the tool."
              )}
            </p>
            <div className="hero-actions">
              <Link className="primary" to={start}>
                {t(signedIn ? "Open console" : "Create an account")}
                <ArrowRight size={17} />
              </Link>
              <Link to="/docs/architecture" className="text-link">
                {t("Read the architecture")}
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>

          <div className="product-stage" aria-label={t("Live control plane")}>
            <div className="stage-bar">
              <span className="stage-signal">
                <i />
                {t("Live control plane")}
              </span>
              <code>inv_01 · mcp.github.search</code>
            </div>

            <div className="stage-canvas">
              <article className="stage-endpoint stage-agent">
                <header>
                  <span className="stage-icon">
                    <Bot size={20} />
                  </span>
                  <small>{t("Agent interface")}</small>
                </header>
                <strong>{t("Call a local MCP tool")}</strong>
                <div className="stage-tags">
                  <span>MCP</span>
                  <span>CLI</span>
                  <span>Skill</span>
                  <span>SDK</span>
                </div>
                <code>actor_coding · grant_dev</code>
              </article>

              <div className="stage-route" aria-hidden="true">
                <span />
                <code>{t("Authorized tool call")}</code>
              </div>

              <section className="stage-control">
                <header>
                  <span>
                    <Waypoints size={18} />
                    {t("Control plane")}
                  </span>
                  <small>{t("Policy and placement")}</small>
                </header>
                <div className="stage-gates">
                  {[
                    ["01", "Identity verified"],
                    ["02", "Agent grant matched"],
                    ["03", "Device policy allowed"],
                    ["04", "Approval satisfied"]
                  ].map(([number, label]) => (
                    <div key={number}>
                      <small>{number}</small>
                      <Check size={13} />
                      <span>{t(label as Message)}</span>
                    </div>
                  ))}
                </div>
                <footer>
                  <span>{t("Audit ledger")}</span>
                  <code>decision_allow · job_01</code>
                </footer>
              </section>

              <div className="stage-route" aria-hidden="true">
                <span />
                <code>{t("Signed lease")}</code>
              </div>

              <article className="stage-endpoint stage-device">
                <header>
                  <span className="stage-icon">
                    <Laptop size={20} />
                  </span>
                  <span className="stage-signal">
                    <i />
                    {t("Connected")}
                  </span>
                </header>
                <small>{t("Selected device")}</small>
                <strong>{t("Built-in tools + MCP Providers")}</strong>
                <div className="stage-local-check">
                  <Check size={13} />
                  <span>{t("Provider credentials stay local")}</span>
                </div>
                <code>mcp.github.search · file.patch</code>
              </article>
            </div>

            <div className="stage-state-track" aria-label={t("Invocation lifecycle")}>
              {dispatchStates.map((state, index) => (
                <div
                  key={state}
                  className={index === dispatchStates.length - 1 ? "is-current" : ""}
                >
                  <i />
                  <span>{t(state)}</span>
                </div>
              ))}
            </div>

            <div className="stage-receipt">
              <Check size={14} />
              <span>
                <strong>{t("Completed on device")}</strong>
                <small>{t("Receipt recorded")}</small>
              </span>
              <code>rcpt_01 · 1.8s</code>
            </div>
          </div>
        </section>

        <section className="proof-strip" aria-label={t("Trust model")} data-reveal>
          <div>
            <strong>{t("Runs on your device")}</strong>
            <span>{t("Only requested results travel back.")}</span>
          </div>
          <div>
            <strong>{t("Outbound connection")}</strong>
            <span>{t("No inbound port on the device.")}</span>
          </div>
          <div>
            <strong>{t("Explicit access")}</strong>
            <span>{t("Each Agent gets its own grant.")}</span>
          </div>
          <div>
            <strong>{t("Auditable effects")}</strong>
            <span>{t("Every side effect gets a receipt.")}</span>
          </div>
        </section>

        <section className="landing-band problem-band" data-reveal>
          <div className="landing-band-inner problem-layout">
            <div>
              <p className="eyebrow">{t("Why Agent Device Cloud")}</p>
              <h2>{t("The context agents need is not in the cloud.")}</h2>
            </div>
            <div className="problem-copy">
              <p>
                {t(
                  "Your code, tools, credentials and private services already live on machines you control."
                )}
              </p>
              <p>
                {t(
                  "Cloud agents are useful, but copying an entire working environment into every agent is slow, fragile and difficult to govern."
                )}
              </p>
              <p>
                {t(
                  "Agent Device Cloud connects the two without turning your device into an unaudited remote shell."
                )}
              </p>
            </div>
          </div>
        </section>

        <section id="use-cases" className="landing-section use-case-section" data-reveal>
          <p className="eyebrow">{t("Built first for developers and self-hosters")}</p>
          <h2>{t("Real work, on the machine that is ready for it.")}</h2>
          <div className="use-case-list">
            <div className="use-case-legend" aria-hidden="true">
              <span>{t("Work")}</span>
              <span>{t("Governed route")}</span>
              <span>{t("Execution target")}</span>
            </div>
            {useCases.map((item) => (
              <article key={item.number}>
                <span>{item.number}</span>
                <div>
                  <h3>{t(item.title)}</h3>
                  <p>{t(item.description)}</p>
                </div>
                <div className="use-case-route">
                  <code>{item.tools}</code>
                  <span aria-hidden="true">
                    <i />
                    <ArrowRight size={15} />
                  </span>
                </div>
                <div className="use-case-target">
                  <Laptop size={17} />
                  <span>{t(item.target)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="architecture" className="landing-band architecture-band" data-reveal>
          <div className="landing-band-inner">
            <p className="eyebrow">{t("Architecture")}</p>
            <h2>{t("One control plane. Execution remains local.")}</h2>
            <p className="section-lead">
              {t(
                "Use familiar Agent interfaces. ADC applies authorization and routing centrally; the selected device validates and executes each tool locally."
              )}
            </p>
            <div className="architecture-flow">
              {architecture.map(({ number, title, description, icon: Icon, modules }, index) => (
                <article key={number}>
                  <header>
                    <span>{number}</span>
                    <Icon size={21} />
                  </header>
                  <div>
                    <h3>{t(title)}</h3>
                    <p>{t(description)}</p>
                  </div>
                  <div className="architecture-modules">
                    {modules.map((module) => (
                      <span key={module}>{t(module)}</span>
                    ))}
                  </div>
                  {index < architecture.length - 1 ? (
                    <div className="architecture-link-line">
                      <ArrowDown size={15} />
                      <code>
                        {index === 0
                          ? t("Authorized request")
                          : index === 1
                            ? t("Outbound dispatch")
                            : t("Local execution")}
                      </code>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            <div className="dispatch-visual" aria-label={t("Dispatch state")}>
              <header>
                <span>{t("Dispatch state")}</span>
                <code>at-least-once · durable receipt</code>
              </header>
              <div>
                {dispatchStates.map((state, index) => (
                  <span
                    key={state}
                    className={index === dispatchStates.length - 1 ? "is-terminal" : ""}
                  >
                    <i />
                    {t(state)}
                  </span>
                ))}
              </div>
              <p>
                {t(
                  "Cancellation is checked during lease renewal. An unprovable side effect becomes unknown_outcome, never a silent retry."
                )}
              </p>
            </div>
            <div className="data-boundary">
              <div>
                <strong>{t("Control plane records")}</strong>
                <p>
                  {t(
                    "Accounts, disclosed path metadata, grants, invocation state, requested results, artifacts and receipts."
                  )}
                </p>
              </div>
              <div>
                <strong>{t("Device retains")}</strong>
                <p>
                  {t(
                    "The private device key, unrequested files and the local environment. Only an authorized operation can return content."
                  )}
                </p>
              </div>
            </div>
            <Link className="text-link architecture-link" to="/docs/architecture">
              {t("Explore the system design")}
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        <section className="landing-section trust-section" data-reveal>
          <p className="eyebrow">{t("Trust model")}</p>
          <h2>{t("Permission is the smallest shared intersection.")}</h2>
          <div className="permission-visual">
            <div className="permission-stack">
              {policyLayers.map((layer, index) => (
                <div key={layer.title} className={`permission-layer layer-${index + 1}`}>
                  <span>{t(layer.title)}</span>
                  <strong>
                    {layer.detail === "/Users/me/work" ? layer.detail : t(layer.detail)}
                  </strong>
                  <i aria-hidden="true" />
                </div>
              ))}
            </div>
            <div className="permission-result">
              <ShieldCheck size={25} />
              <span>{t("Effective permission")}</span>
              <strong>file.patch</strong>
              <code>/Users/me/work/src/**</code>
              <p>{t("Allowed only when every layer agrees.")}</p>
            </div>
          </div>
          <div className="trust-grid">
            {trustPrinciples.map(({ title, description, icon: Icon }) => (
              <article key={title}>
                <Icon size={22} strokeWidth={1.5} />
                <h3>{t(title)}</h3>
                <p>{t(description)}</p>
              </article>
            ))}
          </div>
          <div className="truth-note">
            <ShieldCheck size={22} />
            <div>
              <strong>{t("Security boundary, stated plainly")}</strong>
              <p>
                {t(
                  "Restricted process mode reduces common mistakes; it is not an OS sandbox. Full device trust uses the connector user's actual permissions."
                )}
              </p>
            </div>
            <Link to="/docs/security">{t("Read the security model")}</Link>
          </div>
        </section>

        <section id="connect" className="landing-band integration-band" data-reveal>
          <div className="landing-band-inner integration-section">
            <div>
              <p className="eyebrow">{t("Familiar interfaces, one policy")}</p>
              <h2>{t("Bring your own Agent.")}</h2>
              <p>
                {t(
                  "Use MCP, CLI, Skill or SDK. ADC applies the same authorization, device selection and audit trail behind each interface."
                )}
              </p>
              <Link className="text-link" to="/docs/integrations">
                {t("Integration guides")}
                <ArrowRight size={16} />
              </Link>
            </div>
            <div className="integration-demo">
              <div className="method-tabs" role="tablist" aria-label={t("Connect")}>
                {(["MCP", "CLI", "Skill"] as const).map((item) => (
                  <button
                    key={item}
                    id={`tab-${item}`}
                    role="tab"
                    aria-selected={item === method}
                    aria-controls="method-panel"
                    onClick={() => setMethod(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div role="tabpanel" id="method-panel" aria-labelledby={`tab-${method}`} tabIndex={0}>
                <p>{t(`${method} description`)}</p>
                <pre>
                  <code>{snippets[method]}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section roadmap-section" data-reveal>
          <p className="eyebrow">{t("Roadmap")}</p>
          <h2>{t("A clear boundary between available and planned.")}</h2>
          <div className="roadmap-columns">
            <article className="is-current">
              <i aria-hidden="true" />
              <span>{t("Available now")}</span>
              <h3>{t("A complete personal device loop")}</h3>
              <p>
                {t(
                  "Accounts, macOS/Linux connectors, local MCP Providers, scoped grants, approvals, audit, MCP OAuth, CLI, Skill and self-hosting."
                )}
              </p>
            </article>
            <article>
              <i aria-hidden="true" />
              <span>{t("Next")}</span>
              <h3>{t("Production hardening")}</h3>
              <p>
                {t(
                  "Signed releases, automatic updates, keychain storage, quotas, retention and external artifact storage."
                )}
              </p>
            </article>
            <article>
              <i aria-hidden="true" />
              <span>{t("Later")}</span>
              <h3>{t("Teams and broader capabilities")}</h3>
              <p>
                {t(
                  "Container isolation, team roles, SSO, SIEM export, Windows and additional local executors."
                )}
              </p>
            </article>
          </div>
          <Link className="secondary" to="/docs/roadmap">
            {t("See the roadmap")}
            <ArrowRight size={16} />
          </Link>
        </section>

        <section className="landing-band self-host-band" data-reveal>
          <div className="landing-band-inner self-host-layout">
            <Server size={31} strokeWidth={1.3} />
            <div>
              <p className="eyebrow">{t("Hosted or self-hosted")}</p>
              <h2>{t("One product, the same trust model.")}</h2>
              <p>
                {t(
                  "Use the hosted preview now, or deploy the same application on your own infrastructure. Both use the same accounts, authorization, approvals, audit and device software."
                )}
              </p>
            </div>
            <div className="row-actions">
              <Link className="primary" to={start}>
                {t(signedIn ? "Open console" : "Create an account")}
                <ArrowRight size={16} />
              </Link>
              <Link className="secondary" to="/docs/self-hosting">
                {t("Self-hosting guide")}
              </Link>
            </div>
          </div>
        </section>

        <section className="landing-section faq-section" data-reveal>
          <p className="eyebrow">FAQ</p>
          <h2>{t("Questions that should have clear answers.")}</h2>
          <div>
            <details>
              <summary>{t("Does the control plane copy my device?")}</summary>
              <p>
                {t(
                  "No. It does not crawl or mirror your filesystem. Authorized requests and their returned results pass through the control plane and are recorded for audit."
                )}
              </p>
            </details>
            <details>
              <summary>{t("Is full device trust sandboxed?")}</summary>
              <p>
                {t(
                  "No. It deliberately uses the connector user's OS permissions. Use selected folders and narrow tool grants when that level of trust is unnecessary."
                )}
              </p>
            </details>
            <details>
              <summary>{t("What happens when my device sleeps?")}</summary>
              <p>
                {t(
                  "New calls report the device as offline. The connector reconnects automatically after the device wakes."
                )}
              </p>
            </details>
            <details>
              <summary>{t("Do I need to reinstall after changing folders?")}</summary>
              <p>
                {t(
                  "No. Local folder and access changes reload automatically and immediately narrow affected running work."
                )}
              </p>
            </details>
            <details>
              <summary>{t("Do MCP Provider credentials leave my device?")}</summary>
              <p>
                {t(
                  "No. Provider environment variables and HTTP headers stay in the local Connector configuration. The control plane receives tool descriptions and requested results, not Provider credentials."
                )}
              </p>
            </details>
          </div>
        </section>

        <section className="final-cta" data-reveal>
          <FileCode2 size={30} strokeWidth={1.2} />
          <h2>{t("Connect the tools and environment you already trust.")}</h2>
          <p>{t("Start with one device, one folder and one Agent authorization.")}</p>
          <div className="hero-actions">
            <Link className="primary" to={start}>
              {t("Connect a device")}
              <ArrowRight size={17} />
            </Link>
            <Link className="secondary" to="/docs">
              {t("Read the docs")}
            </Link>
          </div>
        </section>
      </main>

      <footer className="public-footer">
        <Brand />
        <nav aria-label={t("Documentation")}>
          <Link to="/docs">{t("Docs")}</Link>
          <Link to="/docs/security">{t("Security")}</Link>
          <Link to="/docs/roadmap">{t("Roadmap")}</Link>
          <Link to="/docs/changelog">{t("Changelog")}</Link>
        </nav>
        <LanguageSelector />
      </footer>
    </div>
  );
}
