import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  Bot,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clipboard,
  History,
  Laptop,
  Milestone,
  Network,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  Wrench
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useI18n, type Message } from "./i18n.tsx";
import { PublicHeader } from "./public-header.tsx";

export type DocsPageId =
  | "overview"
  | "quickstart"
  | "use-cases"
  | "concepts"
  | "architecture"
  | "connector"
  | "integrations"
  | "tools"
  | "security"
  | "self-hosting"
  | "troubleshooting"
  | "roadmap"
  | "changelog";

export const docsPages: Array<{
  id: DocsPageId;
  title: Message;
  icon: typeof BookOpen;
  group: "Start" | "Understand" | "Build" | "Operate" | "Project";
}> = [
  { id: "overview", title: "Documentation", icon: BookOpen, group: "Start" },
  { id: "quickstart", title: "Get started", icon: Rocket, group: "Start" },
  { id: "use-cases", title: "Use cases", icon: BriefcaseBusiness, group: "Start" },
  { id: "concepts", title: "Core concepts", icon: Network, group: "Understand" },
  { id: "architecture", title: "Architecture", icon: Boxes, group: "Understand" },
  { id: "security", title: "Security", icon: ShieldCheck, group: "Understand" },
  { id: "connector", title: "Device connector", icon: Laptop, group: "Build" },
  { id: "integrations", title: "Integrations", icon: Network, group: "Build" },
  { id: "tools", title: "Tool reference", icon: Wrench, group: "Build" },
  { id: "self-hosting", title: "Self-hosting", icon: Server, group: "Operate" },
  { id: "troubleshooting", title: "Troubleshooting", icon: CircleHelp, group: "Operate" },
  { id: "roadmap", title: "Roadmap", icon: Milestone, group: "Project" },
  { id: "changelog", title: "Changelog", icon: History, group: "Project" }
];

const docsSummaries: Partial<Record<DocsPageId, Message>> = {
  quickstart: "Connect your first device",
  "use-cases": "Real work, on the machine that is ready for it.",
  concepts: "How authorization works",
  architecture: "One control plane. Execution remains local.",
  security: "Trust model",
  connector: "Install and pair",
  integrations: "Connect an MCP client",
  "self-hosting": "Deploy with Docker Compose",
  troubleshooting: "Device is offline",
  roadmap: "A clear boundary between available and planned.",
  changelog: "Version 0.1.0"
};

export const documentedTools = [
  "device.list",
  "device.status",
  "file.list",
  "file.read",
  "file.search",
  "file.write",
  "file.edit",
  "file.patch",
  "shell.exec",
  "command.template.list",
  "command.template.run",
  "test.run",
  "task.status",
  "task.result",
  "task.cancel"
] as const;

export function docsPageId(pathname: string): DocsPageId | undefined {
  if (pathname === "/docs" || pathname === "/docs/") return "overview";
  const id = pathname.match(/^\/docs\/([^/]+)\/?$/)?.[1];
  return docsPages.some((page) => page.id === id) ? (id as DocsPageId) : undefined;
}

function CodeBlock({ label, children }: { label: string; children: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-code">
      <div>
        <span>{label}</span>
        <button
          className="icon-button"
          title={t("Copy command")}
          aria-label={t("Copy command")}
          onClick={() => {
            void navigator.clipboard
              .writeText(children)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              })
              .catch(() => setCopied(false));
          }}
        >
          {copied ? <Check size={15} /> : <Clipboard size={15} />}
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="docs-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function PageIntro({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="docs-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function DocumentationOverview() {
  const { t } = useI18n();
  return (
    <>
      <PageIntro
        eyebrow="AGENT DEVICE CLOUD"
        title={t("Documentation")}
        description={t(
          "Understand where the product fits, how its trust model works and how to connect your first governed device workflow."
        )}
      />
      <div className="docs-index">
        {docsPages.slice(1).map(({ id, title, icon: Icon }) => (
          <Link key={id} to={`/docs/${id}`}>
            <Icon size={20} strokeWidth={1.5} />
            <span>
              <strong>{t(title)}</strong>
              <small>
                {id === "tools"
                  ? t("{count} tools", { count: documentedTools.length })
                  : t(docsSummaries[id]!)}
              </small>
            </span>
            <ChevronRight size={16} />
          </Link>
        ))}
      </div>
    </>
  );
}

function Quickstart() {
  const { t } = useI18n();
  return (
    <>
      <PageIntro
        eyebrow={t("Get started")}
        title={t("Connect your first device")}
        description={t(
          "Go from account creation to a first tool call without weakening the device's local boundary."
        )}
      />
      <Section id="requirements" title={t("Before you begin")}>
        <p>
          {t(
            "The hosted preview requires an account and a supported macOS or glibc Linux device. Installed connectors include their own Node.js runtime; Node.js 22 is only required for source development."
          )}
        </p>
      </Section>
      <ol className="docs-steps">
        <li>
          <span>01</span>
          <div>
            <h2>{t("Create an account")}</h2>
            <p>
              {t("Open the console and use one of the sign-in methods enabled by this deployment.")}
            </p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <h2>{t("Pair a device")}</h2>
            <p>
              {t(
                "Open Devices, create a pairing code, and run the generated command on macOS or glibc Linux."
              )}
            </p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <h2>{t("Authorize an agent")}</h2>
            <p>
              {t("Choose devices, folders, tools and an approval policy. Projects are optional.")}
            </p>
          </div>
        </li>
        <li>
          <span>04</span>
          <div>
            <h2>{t("Connect a client")}</h2>
            <p>
              {t("Use OAuth MCP when available, or run adc connect after signing in to the CLI.")}
            </p>
          </div>
        </li>
        <li>
          <span>05</span>
          <div>
            <h2>{t("Verify access")}</h2>
            <p>
              {t(
                "Start with device.list or file.list, then inspect Activity for the policy decision and receipt."
              )}
            </p>
          </div>
        </li>
      </ol>
    </>
  );
}

function UseCases() {
  const { t } = useI18n();
  const cases: Array<{
    title: Message;
    description: Message;
    access: string;
    outcome: Message;
  }> = [
    {
      title: "Continue local development",
      description:
        "Let an agent inspect a repository, apply focused edits and run existing tests without rebuilding the environment elsewhere.",
      access: "file.read · file.patch · test.run",
      outcome: "The existing repository, dependencies and toolchain stay on the selected machine."
    },
    {
      title: "Connect existing MCP tools",
      description:
        "Register local stdio or Streamable HTTP MCP servers without moving Provider credentials to the control plane.",
      access: "GitHub MCP · database MCP",
      outcome:
        "The Agent receives only requested results rather than a copy of the whole environment."
    },
    {
      title: "Move work across interfaces",
      description:
        "Start from an MCP client, terminal, Skill or SDK and route the same governed work to the intended device.",
      access: "MCP · CLI · Skill · SDK",
      outcome: "Every interface uses the same authorization, error semantics and audit trail."
    },
    {
      title: "Automate with boundaries",
      description:
        "Use explicit templates, writable folders and approval rules for repeatable work instead of sharing unrestricted access.",
      access: "template · approval · receipt",
      outcome:
        "Sensitive actions remain reviewable and retries have explicit idempotency semantics."
    }
  ];
  return (
    <>
      <PageIntro
        eyebrow={t("Use cases")}
        title={t("Real work, on the machine that is ready for it.")}
        description={t(
          "Choose the narrowest workflow that gives an Agent the context it needs. Expand access only when the work requires it."
        )}
      />
      <div className="docs-scenarios">
        {cases.map((item, index) => (
          <section key={item.title}>
            <header>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h2>{t(item.title)}</h2>
            </header>
            <p>{t(item.description)}</p>
            <dl>
              <div>
                <dt>{t("Typical access")}</dt>
                <dd>
                  <code>{item.access}</code>
                </dd>
              </div>
              <div>
                <dt>{t("Expected outcome")}</dt>
                <dd>{t(item.outcome)}</dd>
              </div>
            </dl>
          </section>
        ))}
      </div>
      <p className="docs-callout">
        {t(
          "Agent Device Cloud is not a public compute marketplace, a general RPA product or a hosted shell."
        )}
      </p>
    </>
  );
}

function Concepts() {
  const { t } = useI18n();
  const concepts: Array<[Message, Message]> = [
    [
      "Local device scope",
      "The device owner exposes no folders, selected folders, the home directory or the full filesystem."
    ],
    [
      "Cloud device policy",
      "Account owners can narrow folders, make them read-only and disable execution for every Agent."
    ],
    [
      "Agent authorization",
      "Agent access selects devices, folders and tools. Existing connections always use the latest saved settings."
    ],
    [
      "Approval policy",
      "Approvals are independent from capability. They can apply to writes, execution or every device operation."
    ]
  ];
  return (
    <>
      <PageIntro
        eyebrow={t("Core concepts")}
        title={t("How authorization works")}
        description={t(
          "Every operation is limited by the intersection of local device scope, device policy, Agent authorization and approval policy."
        )}
      />
      <div className="concept-flow" aria-label={t("How authorization works")}>
        {concepts.map(([title], index) => (
          <div key={title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{t(title)}</strong>
          </div>
        ))}
      </div>
      {concepts.map(([title, description]) => (
        <Section key={title} id={title.toLowerCase().replaceAll(" ", "-")} title={t(title)}>
          <p>{t(description)}</p>
        </Section>
      ))}
      <p className="docs-callout">
        {t(
          "Projects are optional groups for legacy or multi-device workflows; they are not a security boundary."
        )}
      </p>
    </>
  );
}

function Architecture() {
  const { t } = useI18n();
  const layers: Array<{
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
      icon: Boxes,
      modules: ["Identity", "Authorization", "Placement", "Audit ledger"]
    },
    {
      number: "03",
      title: "Device connector",
      description:
        "Makes an outbound connection, advertises built-in and local MCP tools, and maintains the lease.",
      icon: Network,
      modules: ["Outbound poll", "Built-in tools", "Local MCP Providers", "Lease and ACK"]
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
  const lifecycle: Array<{ state: string; description: Message }> = [
    {
      state: "requested",
      description: "The client creates a typed invocation from its current Agent authorization."
    },
    {
      state: "authorized",
      description: "The control plane resolves the device and evaluates every policy layer."
    },
    {
      state: "approval?",
      description: "Approval-sensitive work waits without occupying a device lease."
    },
    {
      state: "leased",
      description: "The device claims, acknowledges and renews a bounded execution lease."
    },
    {
      state: "running",
      description: "The local runtime validates the resource again before executing."
    },
    {
      state: "terminal",
      description: "The terminal result, receipt and optional artifact return to the control plane."
    }
  ];
  const policies: Array<{ title: Message; detail: Message | "/Users/me/work" }> = [
    { title: "Account boundary", detail: "Same account owner" },
    { title: "Agent grant", detail: "Device and tool selected" },
    { title: "Device policy", detail: "Writes and execution enabled" },
    { title: "Exposed folder", detail: "/Users/me/work" },
    { title: "Live capability", detail: "file.patch advertised" }
  ];
  return (
    <>
      <PageIntro
        eyebrow={t("Architecture")}
        title={t("One control plane. Execution remains local.")}
        description={t(
          "Use familiar Agent interfaces. ADC applies authorization and routing centrally; the selected device validates and executes each tool locally."
        )}
      />
      <div className="docs-system-map" aria-label={t("Current request path")}>
        <header>
          <span className="stage-signal">
            <i />
            {t("Current request path")}
          </span>
          <code>{t("Authorized tool call")}</code>
        </header>
        <div className="docs-architecture">
          {layers.map(({ number, title, description, icon: Icon, modules }, index) => (
            <div key={number}>
              <span>{number}</span>
              <Icon size={19} />
              <section>
                <strong>{t(title)}</strong>
                <p>{t(description)}</p>
              </section>
              <div>
                {modules.map((module) => (
                  <small key={module}>{t(module)}</small>
                ))}
              </div>
              {index < layers.length - 1 ? (
                <span className="docs-architecture-link">
                  <ArrowDown size={14} />
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <footer>
          <span>{t("Control plane boundary")}</span>
          <span>{t("Device boundary")}</span>
        </footer>
      </div>
      <Section id="request-lifecycle" title={t("Request lifecycle")}>
        <ol className="docs-lifecycle">
          {lifecycle.map((step, index) => (
            <li key={step.state}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <code>{step.state}</code>
              <p>{t(step.description)}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section id="authorization" title={t("Effective authorization")}>
        <p>
          {t(
            "An operation proceeds only when every independent boundary permits it; no layer can expand a narrower one."
          )}
        </p>
        <div className="docs-policy-map">
          <div>
            {policies.map((policy, index) => (
              <div key={policy.title} className={`layer-${index + 1}`}>
                <Check size={13} />
                <span>{t(policy.title)}</span>
                <code>{policy.detail === "/Users/me/work" ? policy.detail : t(policy.detail)}</code>
              </div>
            ))}
          </div>
          <aside>
            <ShieldCheck size={22} />
            <span>{t("Effective permission")}</span>
            <strong>file.patch</strong>
            <code>/Users/me/work/src/**</code>
          </aside>
        </div>
      </Section>
      <Section id="delivery" title={t("Delivery semantics")}>
        <div className="docs-dispatch-map" aria-label={t("Dispatch state")}>
          <div>
            {["queued", "leased", "running", "succeeded"].map((state) => (
              <code key={state}>{state}</code>
            ))}
          </div>
          <aside>
            <code>running</code>
            <ArrowDown size={13} />
            <code>unknown_outcome</code>
            <small>{t("No terminal receipt can be proven")}</small>
          </aside>
        </div>
        <p>
          {t(
            "Dispatch is at-least-once. Side effects require an actor-scoped idempotency key and are recorded in a local durable ledger before execution."
          )}
        </p>
        <p>
          {t(
            "If execution may have happened but no terminal receipt can be proven, the result is unknown_outcome and is never silently retried."
          )}
        </p>
      </Section>
      <Section id="ownership" title={t("Data boundaries")}>
        <div className="docs-boundary-grid">
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
      </Section>
    </>
  );
}

function Connector() {
  const { t } = useI18n();
  return (
    <>
      <PageIntro
        eyebrow={t("Device connector")}
        title={t("Install and pair")}
        description={t(
          "The installer verifies a platform archive, preserves existing identity during upgrades and starts a user service."
        )}
      />
      <CodeBlock label="macOS / Linux">
        {`curl -fsSL https://devices.example.com/install.sh | sh -s -- \\
  --url https://devices.example.com --code 'PAIRING_CODE'`}
      </CodeBlock>
      <Section id="access-modes" title={t("Access modes")}>
        <ul className="docs-list">
          <li>
            <code>none</code>
            <span>{t("No access exposes no folders.")}</span>
          </li>
          <li>
            <code>selected</code>
            <span>{t("Selected folders exposes only explicitly added paths.")}</span>
          </li>
          <li>
            <code>home</code>
            <span>{t("Home directory exposes the connector user's home.")}</span>
          </li>
          <li>
            <code>full</code>
            <span>
              {t(
                "Full device trust exposes the filesystem using the connector user's OS permissions."
              )}
            </span>
          </li>
        </ul>
      </Section>
      <Section id="commands" title={t("Lifecycle commands")}>
        <CodeBlock label="adc-node">
          {`adc-node status
adc-node roots add "/path/to/workspace" --label Workspace
adc-node roots list
adc-node mcp list
adc-node access home
adc-node access full
adc-node access none
adc-node logs
adc-node restart
adc-node rotate-key
adc-node uninstall`}
        </CodeBlock>
        <p>
          {t(
            "Changes to access and folders reload automatically. Removing access cancels affected running work."
          )}
        </p>
      </Section>
      <Section id="local-mcp-providers" title={t("Local MCP Providers")}>
        <p>
          {t(
            "The Connector can discover tools from local stdio or Streamable HTTP MCP servers. Provider credentials remain in the local device configuration; registering a Provider does not grant Agent access."
          )}
        </p>
        <CodeBlock label="adc-node">
          {`adc-node mcp add github --name GitHub --stdio npx \\
  --args '["-y","@modelcontextprotocol/server-github"]' \\
  --env-file ~/.config/adc/github-mcp-env.json

adc-node mcp add internal --name Internal \\
  --http https://mcp.internal.example/api \\
  --headers-file ~/.config/adc/internal-mcp-headers.json

adc-node mcp list
adc-node mcp remove github`}
        </CodeBlock>
        <p>
          {t(
            "Use the same Provider ID on multiple devices to aggregate an identical tool. Schema changes create a new tool ID, and every dynamic tool requires explicit authorization, a target device and an idempotency key."
          )}
        </p>
      </Section>
    </>
  );
}

function Integrations() {
  const { t } = useI18n();
  const origin = window.location.origin;
  return (
    <>
      <PageIntro
        eyebrow={t("Integrations")}
        title="MCP · CLI · Skill · SDK"
        description={t(
          "Tools use the same schemas and policy path across HTTP, CLI, MCP, SDK and Skill."
        )}
      />
      <Section id="oauth-mcp" title={t("Connect an MCP client")}>
        <p>
          {t(
            "OAuth MCP clients use the server's /mcp endpoint and let the user choose an existing Agent authorization."
          )}
        </p>
        <p>
          {t(
            "Each logical tool appears once. Its target list contains only authorized devices that advertise that tool, and device execution requires the Agent to select one of those targets."
          )}
        </p>
        <CodeBlock label="MCP URL">{`${origin}/mcp`}</CodeBlock>
      </Section>
      <Section id="token-mcp" title={t("Access-key MCP")}>
        <CodeBlock label="mcp.json">
          {JSON.stringify(
            {
              mcpServers: {
                adc: {
                  url: `${origin}/mcp`,
                  headers: { Authorization: "Bearer <ACCESS_KEY>" }
                }
              }
            },
            null,
            2
          )}
        </CodeBlock>
      </Section>
      <Section id="cli" title={t("Command line")}>
        <CodeBlock label="adc">
          {`adc login --url ${origin} --email you@example.com
adc access list --json
adc connect ACCESS
adc node list --json
adc invoke file.read --node node_example \\
  --args '{"path":"/Users/me/work/README.md"}' --json`}
        </CodeBlock>
      </Section>
      <Section id="skill" title={t("Official Skill")}>
        <p>
          {t(
            "The official Skill orchestrates the same adc CLI and never reads device credentials."
          )}
        </p>
        <CodeBlock label="Skill">skills/agent-device-cloud/SKILL.md</CodeBlock>
      </Section>
    </>
  );
}

function ToolReference() {
  const { t } = useI18n();
  const groups: Array<{ tools: string[]; risk: Message; purpose: Message }> = [
    {
      tools: ["device.list", "device.status"],
      risk: "Read",
      purpose: "Discover devices and inspect their current capability."
    },
    {
      tools: ["file.list", "file.read", "file.search"],
      risk: "Read",
      purpose: "List, read and search files inside authorized folders."
    },
    {
      tools: ["file.write", "file.edit", "file.patch"],
      risk: "Write",
      purpose: "Create, replace, edit or patch files atomically."
    },
    {
      tools: ["shell.exec", "command.template.list", "command.template.run", "test.run"],
      risk: "Execute",
      purpose: "Run shell commands or locally configured command templates and tests."
    },
    {
      tools: ["task.status", "task.result", "task.cancel"],
      risk: "Varies",
      purpose: "Inspect or cancel asynchronous work."
    }
  ];
  return (
    <>
      <PageIntro
        eyebrow={t("Tool reference")}
        title={t("{count} built-in tools", { count: documentedTools.length })}
        description={t(
          "Tools use the same schemas and policy path across HTTP, CLI, MCP, SDK and Skill."
        )}
      />
      <div className="table-wrap docs-table">
        <table>
          <thead>
            <tr>
              <th>{t("Tool")}</th>
              <th>{t("Risk")}</th>
              <th>{t("Purpose")}</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((group) =>
              group.tools.map((tool) => (
                <tr key={tool}>
                  <td>
                    <code>{tool}</code>
                  </td>
                  <td>{t(group.risk)}</td>
                  <td>{t(group.purpose)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="docs-callout">
        {t(
          "Side-effecting calls require a stable idempotency key. Reuse it only for an exact retry."
        )}
      </p>
      <p>
        {t(
          "Devices may also register namespaced MCP Provider tools. Their original input schema is exposed to the Agent, they default to execution risk, and they appear only after explicit authorization."
        )}
      </p>
    </>
  );
}

function Security() {
  const { t } = useI18n();
  const controls: Array<[Message, Message, Message]> = [
    [
      "Stolen access key",
      "Access keys are hashed, expire and bind to one revocable authorization.",
      "A copied access key remains usable until it expires or is revoked."
    ],
    [
      "Compromised device key",
      "Every request uses an Ed25519 signature, timestamp and durable one-time nonce.",
      "A stolen private key remains valid until the device is revoked."
    ],
    [
      "Path escape",
      "Canonical paths, realpath, no-follow opens and descriptor identity checks are enforced locally.",
      "Portable APIs cannot eliminate every hostile parent-directory race or hard-link alias."
    ],
    [
      "Duplicate side effect",
      "Stable idempotency keys and a fsynced local ledger prevent automatic duplicate execution.",
      "A crash after the effect but before its receipt is reported as unknown_outcome."
    ],
    [
      "Sensitive output",
      "Protected paths, bounded output and common secret patterns are filtered in restricted mode.",
      "Redaction is best effort and cannot prove arbitrary authorized content is safe."
    ]
  ];
  return (
    <>
      <PageIntro
        eyebrow={t("Security")}
        title={t("Trust model")}
        description={t(
          "Every operation is limited by the intersection of local device scope, device policy, Agent authorization and approval policy."
        )}
      />
      <ul className="docs-principles">
        <li>
          <ShieldCheck />
          <span>
            {t(
              "Management sessions administer an account. Agent credentials can only use their bound authorization."
            )}
          </span>
        </li>
        <li>
          <ShieldCheck />
          <span>
            {t(
              "Device requests are signed with a local Ed25519 key, timestamp and one-time nonce."
            )}
          </span>
        </li>
        <li>
          <ShieldCheck />
          <span>
            {t(
              "Filesystem operations validate canonical paths and symlink boundaries again on the device."
            )}
          </span>
        </li>
      </ul>
      <Section id="limitations" title={t("Important limitation")}>
        <p className="docs-warning">
          {t(
            "Restricted process mode is a guardrail, not a sandbox. Full device trust disables command and protected-path filters."
          )}
        </p>
      </Section>
      <Section id="credentials" title={t("Credential storage")}>
        <p>
          {t(
            "Device private keys currently use a mode-0600 file. Keychain and keyring support is not implemented."
          )}
        </p>
      </Section>
      <Section id="visibility" title={t("What the control plane can see")}>
        <p>
          {t(
            "The control plane stores exposed path names, invocation arguments, returned results, artifacts and audit metadata."
          )}
        </p>
        <p>
          {t(
            "It does not hold the device private key or proactively crawl the filesystem. An authorized result may still contain sensitive data."
          )}
        </p>
      </Section>
      <Section id="threats" title={t("Threats and controls")}>
        <div className="table-wrap docs-table">
          <table>
            <thead>
              <tr>
                <th>{t("Threat")}</th>
                <th>{t("Control")}</th>
                <th>{t("Residual risk")}</th>
              </tr>
            </thead>
            <tbody>
              {controls.map(([threat, control, residual]) => (
                <tr key={threat}>
                  <td>
                    <strong>{t(threat)}</strong>
                  </td>
                  <td>{t(control)}</td>
                  <td>{t(residual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section id="assurance" title={t("Current assurance")}>
        <div className="docs-assurance">
          <div>
            <strong>{t("Verified in automation and preview")}</strong>
            <ul>
              <li>{t("Protocol schemas, policy decisions and adapter parity")}</li>
              <li>{t("Real PostgreSQL migrations, locking, restart and account isolation")}</li>
              <li>{t("Path traversal, symlink escape, cancellation and idempotency recovery")}</li>
              <li>{t("macOS arm64 installation, upgrade, reconnect and uninstall")}</li>
              <li>{t("Public HTTPS deployment, database readiness and restart recovery")}</li>
            </ul>
          </div>
          <div>
            <strong>{t("Not yet certified")}</strong>
            <ul>
              <li>{t("External penetration testing and signed release provenance")}</li>
              <li>{t("Production SMTP and real GitHub consent flows")}</li>
              <li>{t("Linux systemd and every generated cross-platform archive")}</li>
              <li>{t("Hard filesystem, network and process isolation")}</li>
            </ul>
          </div>
        </div>
      </Section>
    </>
  );
}

function SelfHosting() {
  const { t } = useI18n();
  return (
    <>
      <PageIntro
        eyebrow={t("Self-hosting")}
        title={t("Deploy with Docker Compose")}
        description={t(
          "Production requires HTTPS, PostgreSQL, a stable auth secret and working SMTP when email verification is enabled."
        )}
      />
      <CodeBlock label="Terminal">
        {`cp .env.example .env
openssl rand -hex 48
openssl rand -hex 32
docker compose --env-file .env -f deploy/compose.yaml up -d --build`}
      </CodeBlock>
      <Section id="configuration" title={t("Required configuration")}>
        <dl className="docs-definitions">
          <div>
            <dt>ADC_PUBLIC_URL</dt>
            <dd>{t("HTTPS origin")}</dd>
          </div>
          <div>
            <dt>ADC_AUTH_SECRET</dt>
            <dd>{t("Stable secret, 32+ characters")}</dd>
          </div>
          <div>
            <dt>ADC_DATABASE_PASSWORD</dt>
            <dd>{t("PostgreSQL password")}</dd>
          </div>
          <div>
            <dt>ADC_SMTP_URL</dt>
            <dd>{t("Required when email verification is enabled")}</dd>
          </div>
        </dl>
      </Section>
      <Section id="operations" title={t("Operations")}>
        <p>
          {t(
            "Back up PostgreSQL and the auth secret together. Check /health and authenticated /metrics after upgrades."
          )}
        </p>
      </Section>
    </>
  );
}

function Troubleshooting() {
  const { t } = useI18n();
  const items: Array<[Message, Message]> = [
    [
      "Device is offline",
      "Check adc-node status and adc-node logs, then restart the user service."
    ],
    [
      "No folders are visible",
      "Run adc-node roots list and add a folder or select home/full access locally."
    ],
    [
      "Approval is waiting",
      "Open Approvals before the request expires. A changed or revoked grant cannot be approved."
    ],
    [
      "Unknown outcome",
      "Do not retry with a new idempotency key until audit and local effects have been reconciled."
    ],
    [
      "Tool is denied",
      "Check the Agent tool list, device policy, writable folder and local access mode."
    ]
  ];
  return (
    <>
      <PageIntro
        eyebrow={t("Troubleshooting")}
        title={t("Troubleshooting")}
        description={t(
          "Diagnose device presence, local scope, approvals and uncertain execution without weakening access."
        )}
      />
      <div className="troubleshooting-list">
        {items.map(([title, description]) => (
          <section key={title}>
            <h2>{t(title)}</h2>
            <p>{t(description)}</p>
          </section>
        ))}
      </div>
    </>
  );
}

function Roadmap() {
  const { t } = useI18n();
  const stages: Array<{ state: Message; title: Message; items: Message[] }> = [
    {
      state: "Available now",
      title: "A complete personal device loop",
      items: [
        "Personal accounts, email and GitHub sign-in",
        "macOS and glibc Linux connectors for arm64 and x64",
        "Scoped Agent grants, approvals, audit and durable receipts",
        "MCP OAuth, CLI connections, SDK and official Skill",
        "Hosted public preview and the same application for self-hosted deployment"
      ]
    },
    {
      state: "Next",
      title: "Production hardening",
      items: [
        "Signed release packages and unattended updates",
        "Keychain and keyring-backed device identity",
        "External artifact storage, quotas and retention",
        "Operational doctor, backup and restore automation",
        "Interoperability validation with named MCP clients"
      ]
    },
    {
      state: "Later",
      title: "Teams and broader capabilities",
      items: [
        "Linux container isolation for higher-risk execution",
        "Team roles, shared device pools and approval workflows",
        "Enterprise SSO, SCIM and SIEM export",
        "Windows connector and additional local executors",
        "Tool plugin and community Skill ecosystem"
      ]
    }
  ];
  return (
    <>
      <PageIntro
        eyebrow={t("Roadmap")}
        title={t("A clear boundary between available and planned.")}
        description={t(
          "Roadmap items describe direction, not shipped capability. Current behavior is always documented separately from future work."
        )}
      />
      <div className="docs-roadmap">
        {stages.map((stage) => (
          <section key={stage.state}>
            <span>{t(stage.state)}</span>
            <h2>{t(stage.title)}</h2>
            <ul>
              {stage.items.map((item) => (
                <li key={item}>{t(item)}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Section id="principles" title={t("What will not change")}>
        <ul className="docs-list">
          <li>
            <code>01</code>
            <span>{t("Device-side policy remains the final authority.")}</span>
          </li>
          <li>
            <code>02</code>
            <span>{t("Hosted and self-hosted deployments keep the same core product.")}</span>
          </li>
          <li>
            <code>03</code>
            <span>
              {t("Protocol, policy and receipts remain independent from any single Agent.")}
            </span>
          </li>
        </ul>
      </Section>
    </>
  );
}

function Changelog() {
  const { t } = useI18n();
  return (
    <>
      <PageIntro
        eyebrow={t("Changelog")}
        title={t("Version 0.1.0")}
        description={t(
          "Release notes describe behavior changes and required operator actions before upgrading."
        )}
      />
      <Section id="initial-release" title={t("Initial pre-release")}>
        <p>
          {t(
            "Account isolation, device pairing, direct grants, approvals, receipts, MCP OAuth, CLI, Skill and installable connectors."
          )}
        </p>
      </Section>
      <Section id="known-limits" title={t("Known limits")}>
        <p>
          {t(
            "Windows, hard process isolation, signed packages, automatic updates, quotas and external artifact storage are not available yet."
          )}
        </p>
      </Section>
    </>
  );
}

function DocContent({ page }: { page: DocsPageId }) {
  if (page === "overview") return <DocumentationOverview />;
  if (page === "quickstart") return <Quickstart />;
  if (page === "use-cases") return <UseCases />;
  if (page === "concepts") return <Concepts />;
  if (page === "architecture") return <Architecture />;
  if (page === "connector") return <Connector />;
  if (page === "integrations") return <Integrations />;
  if (page === "tools") return <ToolReference />;
  if (page === "security") return <Security />;
  if (page === "self-hosting") return <SelfHosting />;
  if (page === "troubleshooting") return <Troubleshooting />;
  if (page === "roadmap") return <Roadmap />;
  return <Changelog />;
}

export function Documentation({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const page = docsPageId(location.pathname);
  const currentIndex = page ? docsPages.findIndex((item) => item.id === page) : -1;
  const visiblePages = docsPages.filter((item) =>
    t(item.title).toLowerCase().includes(query.trim().toLowerCase())
  );
  return (
    <div className="docs-site">
      <PublicHeader signedIn={signedIn} />
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <strong>{t("Documentation")}</strong>
          <label className="docs-search">
            <Search size={14} />
            <input
              aria-label={t("Search docs")}
              placeholder={t("Search docs")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <nav aria-label={t("Documentation")}>
            {(["Start", "Understand", "Build", "Operate", "Project"] as const).map((group) => (
              <div className="docs-nav-group" key={group}>
                <span>{t(group)}</span>
                {visiblePages
                  .filter((item) => item.group === group)
                  .map(({ id, title, icon: Icon }) => (
                    <Link
                      key={id}
                      className={page === id ? "active" : ""}
                      to={id === "overview" ? "/docs" : `/docs/${id}`}
                    >
                      <Icon size={15} />
                      {t(title)}
                    </Link>
                  ))}
              </div>
            ))}
            {!visiblePages.length ? (
              <p className="docs-empty">{t("No matching documentation")}</p>
            ) : null}
          </nav>
        </aside>
        <main className="docs-main">
          {page ? (
            <>
              <article>
                <DocContent page={page} />
              </article>
              <nav className="docs-pagination" aria-label={t("Documentation")}>
                {docsPages[currentIndex - 1] ? (
                  <Link
                    to={
                      docsPages[currentIndex - 1]!.id === "overview"
                        ? "/docs"
                        : `/docs/${docsPages[currentIndex - 1]!.id}`
                    }
                  >
                    <ChevronLeft size={16} />
                    <span>
                      <small>{t("Previous")}</small>
                      {t(docsPages[currentIndex - 1]!.title)}
                    </span>
                  </Link>
                ) : (
                  <span />
                )}
                {docsPages[currentIndex + 1] ? (
                  <Link to={`/docs/${docsPages[currentIndex + 1]!.id}`}>
                    <span>
                      <small>{t("Next")}</small>
                      {t(docsPages[currentIndex + 1]!.title)}
                    </span>
                    <ChevronRight size={16} />
                  </Link>
                ) : null}
              </nav>
            </>
          ) : (
            <article>
              <PageIntro
                eyebrow="404"
                title={t("Page not found")}
                description={t("Guides and reference for connecting agents to your devices.")}
              />
              <Link className="secondary" to="/docs">
                {t("Return to documentation")}
              </Link>
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
