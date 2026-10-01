import { useState, type ReactNode } from "react";
import {
  Activity,
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
  Code2,
  GitPullRequest,
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
import { PublicHeader, repositoryUrl } from "./public-header.tsx";

export type DocsPageId =
  | "overview"
  | "quickstart"
  | "use-cases"
  | "concepts"
  | "architecture"
  | "connector"
  | "integrations"
  | "tools"
  | "api"
  | "security"
  | "self-hosting"
  | "operations"
  | "troubleshooting"
  | "roadmap"
  | "contributing"
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
  { id: "api", title: "API and errors", icon: Code2, group: "Build" },
  { id: "self-hosting", title: "Self-hosting", icon: Server, group: "Operate" },
  { id: "operations", title: "Operations guide", icon: Activity, group: "Operate" },
  { id: "troubleshooting", title: "Troubleshooting", icon: CircleHelp, group: "Operate" },
  { id: "roadmap", title: "Roadmap", icon: Milestone, group: "Project" },
  { id: "contributing", title: "Contributing", icon: GitPullRequest, group: "Project" },
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
  api: "Authentication, invocation and stable failures",
  "self-hosting": "Deploy with Docker Compose",
  operations: "Health, metrics, backup and upgrades",
  troubleshooting: "Device is offline",
  roadmap: "A clear boundary between available and planned.",
  contributing: "Build and review changes",
  changelog: "Version 0.1.0"
};

export const documentedTools = [
  "device.list",
  "device.status",
  "device.battery.get",
  "device.network.get",
  "location.get",
  "notification.show",
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

function useDocCopy() {
  const { locale } = useI18n();
  return (en: string, zh: string) => (locale === "zh-CN" ? zh : en);
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
  const copy = useDocCopy();
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
            "The hosted preview requires an account and a supported macOS, glibc Linux or Windows device. Installed connectors include their own Node.js runtime; Node.js 22 is only required for source development."
          )}
        </p>
        <ul className="docs-checklist">
          <li>{copy("A reachable HTTPS ADC deployment.", "一个可访问的 HTTPS ADC 部署。")}</li>
          <li>
            {copy(
              "A macOS 13.5+ or glibc 2.28+ Linux device on arm64/x64, or Windows 10/11 on x64.",
              "一台 arm64/x64 的 macOS 13.5+ 或 glibc 2.28+ Linux 设备，或一台 x64 Windows 10/11 设备。"
            )}
          </li>
          <li>
            {copy(
              "Permission to run user-level startup and write to the current user's local application directories.",
              "具备启动用户级后台任务以及写入当前用户本地应用目录的权限。"
            )}
          </li>
        </ul>
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
                "Open Devices, select the target platform, create a pairing code, and run the generated command."
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
      <Section id="verify" title={copy("Verify the complete path", "验证完整链路")}>
        <p>
          {copy(
            "After pairing, use the management CLI to create one narrow authorization and connect it locally. Replace the example device and path with values returned by your deployment.",
            "配对后，使用管理 CLI 创建一份最小授权并在本地连接。请将示例设备和路径替换为当前部署返回的实际值。"
          )}
        </p>
        <CodeBlock label="Terminal">
          {`adc login --url https://devices.example.com
adc device list --json
adc access create \\
  --name first-agent \\
  --devices "Work Mac" \\
  --folders all \\
  --capabilities read \\
  --approval never \\
  --json
adc connect first-agent --json
adc invoke device.status --node node_example --args '{}' --json`}
        </CodeBlock>
      </Section>
      <Section id="success" title={copy("What success looks like", "成功状态应是什么样")}>
        <ul className="docs-checklist">
          <li>
            {copy(
              "The device is active and online in Devices.",
              "设备在「设备」页面显示为有效且在线。"
            )}
          </li>
          <li>
            {copy(
              "Agent access lists only the intended device, folders and tools.",
              "Agent 授权中只包含预期设备、目录和工具。"
            )}
          </li>
          <li>
            {copy(
              "The invocation reaches a terminal result and Activity contains its policy decision and receipt.",
              "调用进入终态，并且「活动记录」中存在对应策略决策与回执。"
            )}
          </li>
        </ul>
        <p className="docs-callout">
          {copy(
            "Start read-only. Add write or execution only after the read path works and the approval policy is understood.",
            "先从只读权限开始。确认读取链路和审批策略后，再增加写入或执行权限。"
          )}
        </p>
      </Section>
      <nav className="docs-inline-links" aria-label={copy("Next steps", "后续步骤")}>
        <Link to="/docs/connector">{copy("Operate the Connector", "运维 Connector")}</Link>
        <Link to="/docs/integrations">{copy("Connect MCP or CLI", "连接 MCP 或 CLI")}</Link>
        <Link to="/docs/security">{copy("Review the trust model", "查看信任模型")}</Link>
      </nav>
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
  const copy = useDocCopy();
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
      <Section id="resource-model" title={copy("Resource model", "资源模型")}>
        <dl className="docs-definitions">
          <div>
            <dt>Account</dt>
            <dd>
              {copy(
                "The ownership boundary for users, devices, authorizations, connections and history.",
                "用户、设备、授权、连接与历史记录的归属边界。"
              )}
            </dd>
          </div>
          <div>
            <dt>Device</dt>
            <dd>
              {copy(
                "A paired Connector identity with live capabilities and a cloud-side policy.",
                "一份已配对的 Connector 身份，包含实时能力与云端设备策略。"
              )}
            </dd>
          </div>
          <div>
            <dt>Agent access</dt>
            <dd>
              {copy(
                "A revocable grant defining which devices, folders and tools one Agent may use.",
                "一份可撤销授权，定义某个 Agent 可以使用哪些设备、目录与工具。"
              )}
            </dd>
          </div>
          <div>
            <dt>Connection</dt>
            <dd>
              {copy(
                "A scoped CLI credential or OAuth binding attached to one Agent authorization.",
                "绑定到一份 Agent 授权的 CLI 凭据或 OAuth 连接。"
              )}
            </dd>
          </div>
          <div>
            <dt>Invocation</dt>
            <dd>
              {copy(
                "A typed request with a target, deadline and stable idempotency identity.",
                "一条带目标、截止时间与稳定幂等标识的类型化请求。"
              )}
            </dd>
          </div>
          <div>
            <dt>Receipt</dt>
            <dd>
              {copy(
                "The durable device-side evidence used to reconcile retries and final state.",
                "设备端持久保存的执行证据，用于协调重试与最终状态。"
              )}
            </dd>
          </div>
        </dl>
      </Section>
      <Section id="revocation" title={copy("Changes and revocation", "变更与撤销")}>
        <p>
          {copy(
            "Saved policy changes apply to new work immediately and are checked again during ACK and lease renewal. Revoking an Agent invalidates its credentials and OAuth bindings. Removing device scope can cancel affected running work.",
            "已保存的策略会立即作用于新任务，并在 ACK 与租约续期时再次校验。撤销 Agent 会使其凭据和 OAuth 连接失效；收紧设备范围可以取消受影响的运行任务。"
          )}
        </p>
      </Section>
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
  const copy = useDocCopy();
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
      <CodeBlock label="Windows PowerShell">
        {`$p=Join-Path $env:TEMP 'adc-install.ps1'
Invoke-WebRequest -UseBasicParsing -Uri 'https://devices.example.com/install.ps1' -OutFile $p
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p \`
  -Url 'https://devices.example.com' -Code 'PAIRING_CODE'`}
      </CodeBlock>
      <Section id="pairing-sequence" title={copy("What pairing creates", "配对会创建什么")}>
        <ol className="docs-steps docs-steps-compact">
          <li>
            <span>01</span>
            <div>
              <h2>{copy("Verify the release", "校验发布包")}</h2>
              <p>
                {copy(
                  "The installer selects the platform archive and verifies its committed SHA-256 digest before extraction.",
                  "安装器选择当前平台安装包，并在解压前校验已发布的 SHA-256 摘要。"
                )}
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h2>{copy("Create a device identity", "创建设备身份")}</h2>
              <p>
                {copy(
                  "The Connector creates an Ed25519 key locally and exchanges the one-time pairing code for a device ID.",
                  "Connector 在本地生成 Ed25519 密钥，并用一次性配对码换取设备 ID。"
                )}
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h2>{copy("Start the user service", "启动用户级服务")}</h2>
              <p>
                {copy(
                  "launchd on macOS, systemd --user on Linux or a current-user Scheduled Task on Windows keeps the outbound connection available after terminal exit.",
                  "macOS 使用 launchd，Linux 使用 systemd --user，Windows 使用当前用户的计划任务，使终端退出后出站连接仍可运行。"
                )}
              </p>
            </div>
          </li>
        </ol>
      </Section>
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
                "Full device trust exposes the filesystem using the connector user's OS permissions. On Windows it covers the user's system drive."
              )}
            </span>
          </li>
        </ul>
        <p className="docs-callout">
          {copy(
            "Full access is not a sandbox. Prefer selected folders for ordinary Agent work and use a dedicated OS account for higher-risk automation.",
            "完整访问并不是沙箱。日常 Agent 工作应优先选择指定目录；高风险自动化应使用独立操作系统账号。"
          )}
        </p>
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
adc update --check
adc update
adc-node rotate-key
adc-node uninstall`}
        </CodeBlock>
        <p>
          {t(
            "Changes to access and folders reload automatically. Removing access cancels affected running work."
          )}
        </p>
      </Section>
      <Section id="service-behavior" title={copy("Connection and recovery", "连接与恢复")}>
        <p>
          {copy(
            "The Connector opens an authenticated outbound WebSocket for wake signals. A wake carries no task payload; it triggers the signed poll endpoint, which claims durable work from PostgreSQL. Reconnect performs an immediate poll and a 30-second fallback covers lost signals.",
            "Connector 会建立经过认证的出站 WebSocket 来接收唤醒信号。唤醒不携带任务内容，而是触发签名 poll 接口，从 PostgreSQL 领取持久任务。重连时会立即轮询，并通过 30 秒兜底轮询覆盖信号丢失。"
          )}
        </p>
        <ul className="docs-checklist">
          <li>
            {copy(
              "Sleep or network loss pauses availability; reconnect is automatic.",
              "休眠或断网会暂停可用性，恢复后自动重连。"
            )}
          </li>
          <li>
            {copy(
              "An active task renews a bounded lease and stops when authorization is lost.",
              "运行中的任务会续期有限租约，并在授权失效后停止。"
            )}
          </li>
          <li>
            {copy(
              "Capabilities and local configuration reload without re-pairing.",
              "能力与本地配置变更无需重新配对即可加载。"
            )}
          </li>
        </ul>
      </Section>
      <Section id="upgrade-remove" title={copy("Upgrade or retire a device", "升级或停用设备")}>
        <CodeBlock label="adc">
          {`adc update --check
adc update
adc-node status
adc-node unpair --confirm <NODE_ID>
adc-node uninstall`}
        </CodeBlock>
        <p>
          {copy(
            "Updates preserve pairing, exposed folders and durable receipts. Deleting a device in the console revokes its server identity; unpair locally before enrolling the same machine as a new device.",
            "升级会保留配对身份、开放目录和持久回执。在控制台删除设备会撤销服务端身份；如需把同一机器注册为新设备，应先在本地解除旧配对。"
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
  const origin = typeof window === "undefined" ? "__ADC_PUBLIC_ORIGIN__" : window.location.origin;
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
        <p>
          {t(
            "Run adc login once and confirm the code in your browser. GitHub and email accounts use the same flow."
          )}
        </p>
        <CodeBlock label="adc">
          {`adc login --url ${origin}
adc access list --json
adc connect ACCESS
adc node list --json
adc tool list --json
adc tool show file.read --json
adc invoke file.read --node node_example \\
  --args '{"path":"/Users/me/work/README.md"}' --json
adc invocation status INVOCATION_ID --json`}
        </CodeBlock>
      </Section>
      <Section id="skill" title={t("Official Skill")}>
        <p>
          {t(
            "Install the complete official Skill directory with your Agent host. It discovers live tools and devices, follows approvals and task results, and never reads device credentials."
          )}
        </p>
        <CodeBlock label="Skill">
          {`skills/agent-device-cloud/
  SKILL.md
  references/
    account-and-device-management.md
    tool-invocation.md`}
        </CodeBlock>
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
      tools: ["device.battery.get", "device.network.get", "location.get"],
      risk: "Read",
      purpose: "Read live state exposed by an authorized mobile device."
    },
    {
      tools: ["notification.show"],
      risk: "Write",
      purpose: "Present an authorized notification on a mobile device."
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

function ApiReference() {
  const { t } = useI18n();
  const copy = useDocCopy();
  const endpoints = [
    [
      "GET",
      "/api/v1/me",
      copy("Owner or Agent", "账号用户或 Agent"),
      copy("Inspect the current identity and scope.", "查看当前身份与权限范围。")
    ],
    [
      "GET",
      "/api/v1/nodes",
      copy("Owner", "账号用户"),
      copy("List paired devices and effective capabilities.", "列出已配对设备与有效能力。")
    ],
    [
      "GET",
      "/api/v1/overview",
      copy("Owner", "账号用户"),
      copy("Read bounded console counts and recent activity.", "读取有界的控制台统计与近期活动。")
    ],
    [
      "GET",
      "/api/v1/projects?include=roots",
      copy("Owner", "账号用户"),
      copy("List projects and their roots in one request.", "在一次请求中列出项目及其目录。")
    ],
    [
      "POST",
      "/api/v1/pairing-codes",
      copy("Owner", "账号用户"),
      copy("Create a short-lived, one-time pairing code.", "创建短时有效的一次性配对码。")
    ],
    [
      "GET · POST",
      "/api/v1/grants",
      copy("Owner", "账号用户"),
      copy("List or create Agent authorizations.", "列出或创建 Agent 授权。")
    ],
    [
      "PATCH · DELETE",
      "/api/v1/grants/:grantId",
      copy("Owner", "账号用户"),
      copy("Update with a revision or delete an authorization.", "通过版本号更新或删除授权。")
    ],
    [
      "POST",
      "/api/v1/invocations",
      copy("Agent", "Agent"),
      copy("Submit a typed tool invocation.", "提交一条类型化工具调用。")
    ],
    [
      "GET",
      "/api/v1/invocations/:invocationId",
      copy("Owner or Agent", "账号用户或 Agent"),
      copy(
        "Resume an invocation across approval and dispatch.",
        "跨越审批和派发阶段继续跟踪一条调用。"
      )
    ],
    [
      "GET",
      "/api/v1/tasks/:jobId",
      copy("Agent", "Agent"),
      copy("Read the current task state or terminal result.", "读取当前任务状态或终态结果。")
    ],
    [
      "POST",
      "/api/v1/tasks/:jobId/cancel",
      copy("Agent", "Agent"),
      copy("Request cancellation for an active task.", "请求取消运行中的任务。")
    ],
    [
      "GET",
      "/api/v1/approvals",
      copy("Owner", "账号用户"),
      copy(
        "Page pending or resolved approvals with a cursor.",
        "使用游标分页读取待处理或已处理审批。"
      )
    ],
    [
      "GET",
      "/api/v1/audit",
      copy("Owner", "账号用户"),
      copy("Page and filter account-scoped activity records.", "分页并筛选账号范围内的活动记录。")
    ]
  ];
  const errors = [
    [
      "invalid_request",
      copy("No", "否"),
      copy("Fix the request schema or arguments.", "修正请求结构或参数。")
    ],
    [
      "expired",
      copy("No", "否"),
      copy("Create a new invocation with a new deadline.", "创建带有新截止时间的调用。")
    ],
    [
      "denied",
      copy("No", "否"),
      copy(
        "Review the grant, device policy and local scope.",
        "检查 Agent 授权、设备策略与本地范围。"
      )
    ],
    [
      "approval_required",
      copy("After approval", "审批后"),
      copy("Resolve the pending approval before it expires.", "在审批过期前处理待审批项。")
    ],
    [
      "offline",
      copy("Yes", "是"),
      copy("Wait for device presence, then retry.", "等待设备恢复在线后重试。")
    ],
    [
      "conflict",
      copy("Conditionally", "视情况"),
      copy("Refresh state; never overwrite a newer revision.", "刷新状态，不要覆盖较新的版本。")
    ],
    [
      "lease_expired",
      copy("Conditionally", "视情况"),
      copy("Read task state before creating more work.", "创建新任务前先读取原任务状态。")
    ],
    [
      "unknown_outcome",
      copy("No automatic retry", "不可自动重试"),
      copy("Reconcile the device effect and receipt first.", "先核对设备侧副作用与回执。")
    ],
    [
      "internal",
      copy("When retryable", "仅 retryable 为真时"),
      copy(
        "Use bounded backoff and retain the same request identity.",
        "有限退避，并保留相同请求身份。"
      )
    ]
  ];
  return (
    <>
      <PageIntro
        eyebrow={t("API and errors")}
        title={copy("One contract across every interface", "所有接入方式共用一份契约")}
        description={copy(
          "HTTP, CLI, MCP, the TypeScript client and the official Skill share the same invocation, policy and result semantics.",
          "HTTP、CLI、MCP、TypeScript Client 与官方 Skill 共用相同的调用、策略和结果语义。"
        )}
      />
      <Section id="authentication" title={copy("Authentication boundaries", "身份认证边界")}>
        <dl className="docs-definitions">
          <div>
            <dt>{copy("Owner session", "账号会话")}</dt>
            <dd>
              {copy(
                "A browser session or CLI management session administers devices, authorizations, approvals and account settings. State-changing requests require the deployment origin.",
                "浏览器会话或 CLI 管理会话用于管理设备、授权、审批和账号设置。修改状态的请求必须来自部署自身的 Origin。"
              )}
            </dd>
          </div>
          <div>
            <dt>{copy("Agent connection", "Agent 连接")}</dt>
            <dd>
              {copy(
                "A revocable Bearer credential can inspect only its bound authorization and invoke only the tools, folders and devices in that grant.",
                "可撤销的 Bearer 凭据只能查看其绑定授权，并且只能调用该授权内的工具、目录和设备。"
              )}
            </dd>
          </div>
          <div>
            <dt>{copy("Device identity", "设备身份")}</dt>
            <dd>
              {copy(
                "Connector routes use an Ed25519 signature, timestamp and one-time nonce. Device credentials are not accepted by owner or Agent routes.",
                "Connector 路由使用 Ed25519 签名、时间戳与一次性 nonce。设备凭据不能访问账号用户或 Agent 路由。"
              )}
            </dd>
          </div>
        </dl>
      </Section>
      <Section id="endpoints" title={copy("Core HTTP surface", "核心 HTTP 接口")}>
        <p>
          {copy(
            "The browser console and official clients use the same versioned API. The table highlights stable integration points; management clients should prefer the typed client rather than reconstructing response types.",
            "浏览器控制台和官方客户端使用相同的版本化 API。下表列出稳定接入点；管理端集成应优先使用类型化客户端，不应自行推测响应结构。"
          )}
        </p>
        <p>
          {copy(
            "Approvals and audit use newest-first cursor pagination. Pass limit (1–100) and the returned nextCursor as cursor; approvals accepts status=pending|resolved, while audit accepts category=dispatch|approval|task|node|grant|credential|oauth or an exact invocationId.",
            "审批与活动记录使用按时间倒序的游标分页。传入 limit（1–100），并将返回的 nextCursor 作为下一页 cursor；审批支持 status=pending|resolved，活动记录支持 category=dispatch|approval|task|node|grant|credential|oauth 或精确的 invocationId。"
          )}
        </p>
        <div className="table-wrap docs-table docs-api-table">
          <table>
            <thead>
              <tr>
                <th>{copy("Method", "方法")}</th>
                <th>{copy("Path", "路径")}</th>
                <th>{copy("Identity", "身份")}</th>
                <th>{copy("Purpose", "用途")}</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map(([method, path, identity, purpose]) => (
                <tr key={`${method}-${path}`}>
                  <td>
                    <code>{method}</code>
                  </td>
                  <td>
                    <code>{path}</code>
                  </td>
                  <td>{identity}</td>
                  <td>{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section id="invocation" title={copy("Invocation envelope", "调用信封")}>
        <p>
          {copy(
            "Identity fields are derived from the Agent connection by official clients. Targets and absolute paths must remain inside the current grant. Side-effecting tools also require an idempotency key.",
            "官方客户端会从 Agent 连接推导身份字段。目标和绝对路径必须位于当前授权内；有副作用的工具还必须提供幂等键。"
          )}
        </p>
        <CodeBlock label="JSON">
          {`{
  "schemaVersion": "0.1",
  "invocationId": "inv_example001",
  "attemptId": "att_example001",
  "accountId": "acct_example001",
  "actor": { "type": "agent", "id": "actor_example001" },
  "target": { "nodeId": "node_example001" },
  "authorization": {
    "grantId": "grant_example001",
    "rootIds": ["root_workspace001"]
  },
  "tool": "file.read",
  "args": { "path": "/Users/me/work/README.md" },
  "issuedAt": "2026-09-29T10:00:00.000Z",
  "expiresAt": "2026-09-29T10:05:00.000Z",
  "metadata": { "source": "sdk" }
}`}
        </CodeBlock>
      </Section>
      <Section id="results" title={copy("Results and task state", "结果与任务状态")}>
        <p>
          {copy(
            "A successful HTTP response can still carry a domain status such as denied, approval_required or offline. Track approval_required by invocationId; queued and running results include a jobId for task polling.",
            "HTTP 请求成功时，业务结果仍可能是 denied、approval_required 或 offline。使用 invocationId 跟踪待审批调用；queued 与 running 结果会包含用于轮询任务的 jobId。"
          )}
        </p>
        <CodeBlock label="JSON">
          {`{
  "schemaVersion": "0.1",
  "invocationId": "inv_example001",
  "attemptId": "att_example001",
  "status": "offline",
  "error": {
    "code": "offline",
    "message": "No authorized device is online.",
    "retryable": true
  }
}`}
        </CodeBlock>
      </Section>
      <Section id="errors" title={copy("Stable error semantics", "稳定错误语义")}>
        <div className="table-wrap docs-table docs-error-table">
          <table>
            <thead>
              <tr>
                <th>{copy("Code", "错误码")}</th>
                <th>{copy("Retry", "重试")}</th>
                <th>{copy("Required action", "处理方式")}</th>
              </tr>
            </thead>
            <tbody>
              {errors.map(([code, retry, action]) => (
                <tr key={code}>
                  <td>
                    <code>{code}</code>
                  </td>
                  <td>{retry}</td>
                  <td>{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="docs-warning">
          {copy(
            "Never turn unknown_outcome into an automatic retry. Reusing the exact idempotency key can recover a durable receipt; inventing a new key can repeat the side effect.",
            "绝不能把 unknown_outcome 直接转成自动重试。复用完全相同的幂等键可以恢复持久回执；创建新键则可能重复执行副作用。"
          )}
        </p>
      </Section>
      <nav className="docs-inline-links" aria-label={copy("Related documentation", "相关文档")}>
        <Link to="/docs/tools">{copy("Inspect tool contracts", "查看工具契约")}</Link>
        <Link to="/docs/concepts">{copy("Understand authorization", "理解授权模型")}</Link>
        <Link to="/docs/troubleshooting">{copy("Diagnose a failed call", "诊断失败调用")}</Link>
      </nav>
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
  const copy = useDocCopy();
  return (
    <>
      <PageIntro
        eyebrow={t("Self-hosting")}
        title={t("Deploy with Docker Compose")}
        description={t(
          "Production requires HTTPS, PostgreSQL, a stable auth secret and working SMTP when email verification is enabled."
        )}
      />
      <Section id="requirements" title={copy("Production baseline", "生产环境基线")}>
        <ul className="docs-checklist">
          <li>
            {copy(
              "Docker Compose 2.24.4+, a stable hostname and inbound TCP 80/443.",
              "Docker Compose 2.24.4+、稳定域名，以及开放 TCP 80/443。"
            )}
          </li>
          <li>
            {copy(
              "Persistent storage sized for PostgreSQL, audit records and artifacts.",
              "为 PostgreSQL、审计记录和产物准备足够的持久存储。"
            )}
          </li>
          <li>
            {copy(
              "A tested SMTP sender before email verification is required.",
              "启用强制邮箱验证前，先验证 SMTP 发件链路。"
            )}
          </li>
          <li>
            {copy(
              "An encrypted backup location for the database and deployment secrets.",
              "用于保存数据库与部署密钥的加密备份位置。"
            )}
          </li>
        </ul>
      </Section>
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
          <div>
            <dt>ADC_TRUSTED_PROXIES</dt>
            <dd>
              {copy(
                "Only the reverse-proxy addresses allowed to supply client IP headers.",
                "仅填写允许提供客户端 IP 请求头的反向代理地址。"
              )}
            </dd>
          </div>
          <div>
            <dt>ADC_ANALYTICS_*</dt>
            <dd>
              {copy(
                "Leave unset for the default zero-external-analytics self-hosted behavior.",
                "保持未设置，即使用自托管默认的零外部分析行为。"
              )}
            </dd>
          </div>
        </dl>
      </Section>
      <Section id="verify" title={copy("Verify the deployment", "验证部署")}>
        <CodeBlock label="Terminal">
          {`curl -fsS https://devices.example.com/health
docker compose --env-file .env -f deploy/compose.yaml ps
docker compose --env-file .env -f deploy/compose.yaml logs --tail=100 control-plane`}
        </CodeBlock>
        <p>
          {copy(
            "Then create one account, pair a device and complete one read-only invocation. Infrastructure health alone does not prove that authentication, WebSocket upgrades and dispatch all work.",
            "然后创建一个账号、配对一台设备，并完成一次只读调用。仅检查基础设施健康状态，并不能证明认证、WebSocket 升级和任务调度均正常。"
          )}
        </p>
      </Section>
      <Section id="data" title={copy("Data and trust boundary", "数据与信任边界")}>
        <p>
          {copy(
            "PostgreSQL stores accounts, sessions, authorizations, dispatches, audit records, receipts and current artifact blobs. Device private keys and local Provider secrets must remain on each device.",
            "PostgreSQL 保存账号、会话、授权、调度、审计、回执及当前产物数据。设备私钥和本地 Provider 密钥必须保留在各自设备上。"
          )}
        </p>
        <p>
          {copy(
            "Back up PostgreSQL and the stable auth secret together. A database restore can resurrect credentials revoked after the backup, so rotate affected access during incident recovery.",
            "应同时备份 PostgreSQL 与稳定的认证密钥。恢复数据库可能使备份后已撤销的凭据重新出现，因此安全事件恢复后需要轮换相关访问凭据。"
          )}
        </p>
      </Section>
      <nav className="docs-inline-links" aria-label={copy("Next steps", "后续步骤")}>
        <Link to="/docs/operations">{copy("Run production operations", "执行生产运维")}</Link>
        <Link to="/docs/security">{copy("Review security limits", "查看安全限制")}</Link>
        <Link to="/telemetry">{copy("Review telemetry defaults", "查看遥测默认值")}</Link>
      </nav>
    </>
  );
}

function OperationsGuide() {
  const { t } = useI18n();
  const copy = useDocCopy();
  const metrics = [
    [
      "adc_node_wake_connections",
      copy("Current authenticated Connector wake sockets.", "当前已认证的 Connector 唤醒连接数。")
    ],
    [
      "adc_node_wake_total",
      copy(
        "Wake attempts and work queued while a device was offline.",
        "唤醒尝试，以及设备离线时入队的任务。"
      )
    ],
    [
      "adc_node_poll_total",
      copy(
        "Dispatched, idle and denied Connector polls.",
        "已调度、空闲及被拒绝的 Connector 轮询。"
      )
    ],
    [
      "adc_invocation_total",
      copy(
        "Policy and terminal outcomes by built-in or custom tool.",
        "按内置或自定义工具统计策略与终态结果。"
      )
    ]
  ];
  const incidents = [
    [
      copy("Health returns 503", "健康检查返回 503"),
      copy(
        "Stop writes, inspect PostgreSQL availability and disk space, then restore database connectivity before restarting the application.",
        "停止写入，检查 PostgreSQL 可用性与磁盘空间；恢复数据库连接后再重启应用。"
      )
    ],
    [
      copy("Wake connections fall", "唤醒连接数下降"),
      copy(
        "Check reverse-proxy WebSocket upgrades and Connector logs. Durable work remains in PostgreSQL and the 30-second fallback poll still applies.",
        "检查反向代理的 WebSocket 升级和 Connector 日志。持久任务仍保留在 PostgreSQL 中，30 秒兜底轮询仍然有效。"
      )
    ],
    [
      copy("Unknown outcomes rise", "未知结果增加"),
      copy(
        "Pause automatic retries, preserve invocation IDs and reconcile local receipts before resuming side effects.",
        "暂停自动重试，保留调用 ID，并在恢复副作用操作前核对本地回执。"
      )
    ],
    [
      copy("Database storage grows", "数据库空间持续增长"),
      copy(
        "Inspect artifact volume and audit growth. The current release has no automatic quota, retention job or external object store.",
        "检查产物体积与审计增长。当前版本没有自动配额、保留策略任务或外部对象存储。"
      )
    ]
  ];
  return (
    <>
      <PageIntro
        eyebrow={t("Operations guide")}
        title={copy("Operate the control plane with evidence", "用可验证证据运维控制面")}
        description={copy(
          "Monitor availability and dispatch, verify backups by restoring them, and treat upgrades as database changes rather than stateless redeploys.",
          "监控可用性与调度，通过实际恢复验证备份，并将升级视为数据库变更而非无状态重部署。"
        )}
      />
      <Section id="daily" title={copy("Operational baseline", "日常运维基线")}>
        <ul className="docs-checklist">
          <li>
            {copy(
              "Probe /health from outside the host and alert on non-200 responses.",
              "从主机外部探测 /health，并对非 200 响应告警。"
            )}
          </li>
          <li>
            {copy(
              "Collect authenticated /metrics without exposing it to the public internet.",
              "采集需要认证的 /metrics，且不要将其暴露到公网。"
            )}
          </li>
          <li>
            {copy(
              "Alert on disk capacity, PostgreSQL availability and repeated process restarts.",
              "为磁盘容量、PostgreSQL 可用性和进程反复重启配置告警。"
            )}
          </li>
          <li>
            {copy(
              "Keep JSON logs, but never add authorization headers or request bodies upstream.",
              "保留 JSON 日志，但不要在上游记录 Authorization 请求头或请求正文。"
            )}
          </li>
        </ul>
        <CodeBlock label="Health check">{`curl -fsS https://devices.example.com/health
# {"ok":true,"schemaVersion":"0.1"}`}</CodeBlock>
      </Section>
      <Section id="metrics" title={copy("Signals to watch", "需要关注的指标")}>
        <div className="table-wrap docs-table">
          <table>
            <thead>
              <tr>
                <th>{copy("Metric", "指标")}</th>
                <th>{copy("Interpretation", "含义")}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(([name, detail]) => (
                <tr key={name}>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td>{detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="docs-callout">
          {copy(
            "Product analytics is not service monitoring. Use Prometheus for service health, the account audit ledger for authorized actions and optional analytics only for coarse adoption signals.",
            "产品分析不是服务监控。服务健康使用 Prometheus，授权操作使用账号审计账本，可选分析仅用于粗粒度产品使用信号。"
          )}
        </p>
      </Section>
      <Section id="backup" title={copy("Back up and prove restore", "备份并验证可恢复性")}>
        <CodeBlock label="Backup">
          {`docker compose --env-file .env -f deploy/compose.yaml exec -T postgres \\
  pg_dump -U adc -d adc -Fc > adc-backup.dump

docker compose --env-file .env -f deploy/compose.yaml exec -T postgres \\
  pg_restore --list < adc-backup.dump`}
        </CodeBlock>
        <CodeBlock label="Isolated restore check">
          {`docker compose --env-file .env -f deploy/compose.yaml exec -T postgres \\
  createdb -U adc adc_restore_check
docker compose --env-file .env -f deploy/compose.yaml exec -T postgres \\
  pg_restore -U adc -d adc_restore_check --exit-on-error < adc-backup.dump`}
        </CodeBlock>
        <p>
          {copy(
            "Store the dump and .env in an encrypted location with separate access controls. Verify row counts and sign-in, grants and audit against an isolated application before accepting the backup.",
            "将备份文件与 .env 存放在具备独立访问控制的加密位置。应在隔离应用中核对行数、登录、授权与审计后，才把该备份视为有效。"
          )}
        </p>
      </Section>
      <Section id="upgrade" title={copy("Upgrade procedure", "升级流程")}>
        <ol className="docs-numbered">
          <li>
            {copy(
              "Record the running source revision or image digest and create a verified database backup.",
              "记录当前源码版本或镜像摘要，并创建经过验证的数据库备份。"
            )}
          </li>
          <li>
            {copy(
              "Build the new image and recreate the control plane. Database migrations acquire advisory locks before HTTP starts.",
              "构建新镜像并重建控制面。数据库迁移会在 HTTP 服务启动前获取 advisory lock。"
            )}
          </li>
          <li>
            {copy(
              "Verify /health, sign-in, device presence, the wake connection metric and one permitted read.",
              "验证 /health、登录、设备在线状态、唤醒连接指标，以及一次允许的只读调用。"
            )}
          </li>
          <li>
            {copy(
              "Retain the previous image and backup until verification is complete. A schema rollback may require restoring the pre-upgrade database.",
              "验证完成前保留旧镜像与备份。数据库结构回滚可能需要恢复升级前的数据库。"
            )}
          </li>
        </ol>
      </Section>
      <Section id="incidents" title={copy("First response by symptom", "按症状进行初步响应")}>
        <div className="troubleshooting-list">
          {incidents.map(([title, description]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{description}</p>
            </section>
          ))}
        </div>
      </Section>
    </>
  );
}

function Troubleshooting() {
  const { t } = useI18n();
  const copy = useDocCopy();
  const items: Array<[string, string, string]> = [
    [
      t("Device is offline"),
      copy(
        "Check whether the service is running and can reach the configured HTTPS origin. A sleeping laptop is expected to be offline; it reconnects and polls immediately after waking.",
        "检查服务是否运行，以及能否访问配置的 HTTPS 地址。休眠中的笔记本离线是预期行为；唤醒后会自动重连并立即轮询。"
      ),
      "adc-node status\nadc-node logs\nadc-node restart"
    ],
    [
      t("No folders are visible"),
      copy(
        "Confirm the local access mode first. Then compare exposed folders with the device policy and the Agent authorization; every layer can narrow the previous one.",
        "先确认本地访问模式，再对比开放目录、设备策略与 Agent 授权；每一层都可以继续收窄上一层。"
      ),
      'adc-node status\nadc-node roots list\nadc-node roots add "/path/to/workspace" --label Workspace'
    ],
    [
      t("Approval is waiting"),
      copy(
        "Open Approvals before the invocation expires. Confirm the Agent, device, tool and path. A changed, deleted or revoked authorization cannot be approved.",
        "在调用过期前打开「审批」。核对 Agent、设备、工具与路径。已变更、删除或撤销的授权不能再被批准。"
      ),
      "adc approval list --json\nadc approval approve APPROVAL_ID --json"
    ],
    [
      t("Unknown outcome"),
      copy(
        "The side effect may have happened, but a terminal receipt cannot be proven. Inspect Activity and the target resource; retry only with the original idempotency key after reconciliation.",
        "副作用可能已经发生，但无法证明存在终态回执。检查「活动记录」与目标资源；完成核对后，只能使用原幂等键重试。"
      ),
      "adc audit show INVOCATION_ID --json\nadc task result JOB_ID --json"
    ],
    [
      t("Tool is denied"),
      copy(
        "Read the returned reason before broadening access. Check the Agent tool list, device execution switch, writable-folder policy and Connector access mode.",
        "扩大权限前先读取返回的原因。检查 Agent 工具列表、设备执行开关、可写目录策略与 Connector 访问模式。"
      ),
      "adc access show ACCESS --json\nadc device show DEVICE --json"
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
        {items.map(([title, description, command]) => (
          <section key={title}>
            <h2>{title}</h2>
            <p>{description}</p>
            <pre>
              <code>{command}</code>
            </pre>
          </section>
        ))}
      </div>
      <Section
        id="evidence"
        title={copy("Collect evidence before changing policy", "修改策略前先收集证据")}
      >
        <ul className="docs-checklist">
          <li>
            {copy("The exact error code and retryable value.", "准确的错误码与 retryable 值。")}
          </li>
          <li>
            {copy(
              "Invocation ID, job ID and approximate timestamp.",
              "调用 ID、任务 ID 与大致时间。"
            )}
          </li>
          <li>
            {copy(
              "Connector status and relevant structured log lines.",
              "Connector 状态及相关结构化日志。"
            )}
          </li>
          <li>
            {copy(
              "Current device and Agent authorization summaries without credentials or file content.",
              "当前设备与 Agent 授权摘要，不包含凭据或文件内容。"
            )}
          </li>
        </ul>
      </Section>
      <p className="docs-warning">
        {copy(
          "Do not paste access keys, session cookies, device private keys, file content or production URLs into a public issue.",
          "不要把访问密钥、会话 Cookie、设备私钥、文件内容或生产地址粘贴到公开 Issue。"
        )}
      </p>
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

function ContributingGuide() {
  const { t } = useI18n();
  const copy = useDocCopy();
  const areas = [
    [
      "packages/protocol",
      copy(
        "Versioned invocation, result, capability and receipt schemas.",
        "版本化调用、结果、能力与回执结构。"
      )
    ],
    [
      "packages/policy",
      copy(
        "Authorization intersection and explainable policy decisions.",
        "权限交集与可解释策略决策。"
      )
    ],
    [
      "apps/control-plane",
      copy(
        "Identity, management APIs, dispatch, audit and the public server.",
        "身份、管理 API、任务调度、审计与公开服务。"
      )
    ],
    [
      "apps/node",
      copy(
        "Local enforcement, tool execution, receipts and service lifecycle.",
        "本地强制校验、工具执行、回执与服务生命周期。"
      )
    ],
    [
      "apps/console",
      copy(
        "Public website, documentation and account management UI.",
        "公开网站、文档与账号管理界面。"
      )
    ],
    [
      "tests",
      copy(
        "Cross-boundary integration, PostgreSQL and installation behavior.",
        "跨边界集成、PostgreSQL 与安装行为。"
      )
    ]
  ];
  return (
    <>
      <PageIntro
        eyebrow={t("Contributing")}
        title={copy("Make a change the system can defend", "提交一项系统能够证明正确的变更")}
        description={copy(
          "ADC welcomes focused fixes, tests, documentation and integrations. Changes that affect trust or delivery need evidence across the boundary they modify.",
          "ADC 欢迎聚焦的修复、测试、文档和集成。涉及信任或任务交付的变更，需要提供覆盖其边界的验证证据。"
        )}
      />
      <Section id="before-code" title={copy("Before writing code", "开始编码之前")}>
        <ol className="docs-numbered">
          <li>
            {copy(
              "Search existing issues and documentation. Open a focused issue for behavior changes or new public contracts.",
              "先检索现有 Issue 与文档。行为变更或新增公开契约应先创建聚焦的 Issue。"
            )}
          </li>
          <li>
            {copy(
              "State the user problem, affected trust boundary and acceptance evidence. Avoid combining unrelated refactors.",
              "说明用户问题、受影响的信任边界与验收证据，不要混入无关重构。"
            )}
          </li>
          <li>
            {copy(
              "Keep protocol, policy and receipt behavior independent of MCP, CLI and other adapters.",
              "保持协议、策略与回执行为独立于 MCP、CLI 和其他适配器。"
            )}
          </li>
        </ol>
        <nav className="docs-inline-links" aria-label={copy("Repository links", "仓库链接")}>
          <a href={`${repositoryUrl}/issues`} target="_blank" rel="noreferrer">
            {copy("Browse issues", "查看 Issues")}
          </a>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            {copy("Open repository", "打开仓库")}
          </a>
        </nav>
      </Section>
      <Section id="repository" title={copy("Repository map", "仓库结构")}>
        <dl className="docs-definitions docs-source-map">
          {areas.map(([path, description]) => (
            <div key={path}>
              <dt>{path}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section id="development" title={copy("Develop locally", "本地开发")}>
        <p>
          {copy(
            "Use Node.js 22+ and pnpm 9+. Configure a reachable PostgreSQL 16+ database and a stable ADC_AUTH_SECRET; disable required email verification for local work without SMTP.",
            "使用 Node.js 22+ 与 pnpm 9+。配置可访问的 PostgreSQL 16+ 数据库和稳定的 ADC_AUTH_SECRET；本地没有 SMTP 时关闭强制邮箱验证。"
          )}
        </p>
        <CodeBlock label="Terminal">
          {`pnpm install --frozen-lockfile
pnpm build:node
pnpm dev`}
        </CodeBlock>
      </Section>
      <Section id="quality" title={copy("Required verification", "必须完成的验证")}>
        <CodeBlock label="Terminal">
          {`pnpm schema:check
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm audit --prod`}
        </CodeBlock>
        <ul className="docs-checklist">
          <li>
            {copy(
              "Protocol changes update committed JSON Schema and compatibility vectors.",
              "协议变更需同步更新已提交的 JSON Schema 与兼容性向量。"
            )}
          </li>
          <li>
            {copy(
              "Trust-boundary or delivery changes include an architecture decision record.",
              "信任边界或任务交付语义变更需增加架构决策记录。"
            )}
          </li>
          <li>
            {copy(
              "New side-effecting tools include durable idempotency and terminal receipt tests.",
              "新增有副作用工具需包含持久幂等与终态回执测试。"
            )}
          </li>
          <li>
            {copy(
              "User-visible behavior includes concise English and Simplified Chinese copy.",
              "用户可见行为需提供简洁的英文与简体中文文案。"
            )}
          </li>
        </ul>
      </Section>
      <Section
        id="security-reports"
        title={copy("Report security issues privately", "私下报告安全问题")}
      >
        <p>
          {copy(
            "Do not open a public issue for a suspected vulnerability. Use the repository's private security reporting channel and include affected versions, impact, reproduction and known mitigations without real credentials or private data.",
            "不要为疑似漏洞创建公开 Issue。请使用仓库的私密安全报告渠道，提供受影响版本、影响范围、复现步骤和已知缓解措施，但不要附带真实凭据或私有数据。"
          )}
        </p>
        <a
          className="docs-text-link"
          href={`${repositoryUrl}/security`}
          target="_blank"
          rel="noreferrer"
        >
          {copy("Open repository security policy", "打开仓库安全策略")}
        </a>
      </Section>
    </>
  );
}

function Changelog() {
  const { t } = useI18n();
  const copy = useDocCopy();
  return (
    <>
      <PageIntro
        eyebrow={t("Changelog")}
        title={copy("0.1 pre-release history", "0.1 预发布版本记录")}
        description={copy(
          "Behavior changes, verification status and operator actions for the public preview and self-hosted source release.",
          "记录公开预览与自托管源码版本的行为变化、验证状态和运维操作。"
        )}
      />
      <Section
        id="2026-09-29-wake"
        title={copy("2026-09-29 · WebSocket task wakeups", "2026-09-29 · WebSocket 任务唤醒")}
      >
        <ul className="docs-checklist">
          <li>
            {copy(
              "Connectors maintain an authenticated outbound WebSocket for dispatch.available signals.",
              "Connector 通过经过认证的出站 WebSocket 接收 dispatch.available 信号。"
            )}
          </li>
          <li>
            {copy(
              "PostgreSQL remains the durable queue; signed poll atomically claims work.",
              "PostgreSQL 仍是持久任务队列；签名 poll 负责原子领取任务。"
            )}
          </li>
          <li>
            {copy(
              "Reconnect triggers an immediate poll and a 30-second fallback covers lost wake signals.",
              "重连后立即轮询，并以 30 秒兜底轮询覆盖唤醒信号丢失。"
            )}
          </li>
        </ul>
        <p className="docs-callout">
          {copy(
            "Operator action: allow WebSocket upgrades on /api/v1/nodes/:nodeId/events and monitor adc_node_wake_connections.",
            "运维操作：允许 /api/v1/nodes/:nodeId/events 的 WebSocket 升级，并监控 adc_node_wake_connections。"
          )}
        </p>
      </Section>
      <Section
        id="2026-09-29-public-site"
        title={copy("2026-09-29 · Public knowledge base", "2026-09-29 · 公开知识库")}
      >
        <p>
          {copy(
            "Added route-level prerendering, canonical metadata, structured data, sitemap, RSS, robots policy, llms discovery files, public articles and an explicit telemetry policy.",
            "新增路由级预渲染、canonical 元数据、结构化数据、Sitemap、RSS、robots 策略、llms 发现文件、公开文章与明确的遥测策略。"
          )}
        </p>
        <p>
          {copy(
            "Self-hosted builds continue to send no external analytics unless the operator configures both analytics settings.",
            "自托管构建仍默认不发送外部分析数据，只有部署管理员同时配置两项分析设置后才会启用。"
          )}
        </p>
      </Section>
      <Section id="initial-release" title={copy("Initial 0.1 product loop", "最初的 0.1 产品闭环")}>
        <p>
          {t(
            "Account isolation, device pairing, direct grants, approvals, receipts, MCP OAuth, CLI, Skill and installable connectors."
          )}
        </p>
        <p>
          {copy(
            "The pre-release supports macOS and glibc Linux on arm64 and x64. Production claims remain bounded by the verification published in Security and the implementation status.",
            "预发布版本支持 arm64 与 x64 的 macOS 和 glibc Linux。生产能力声明以「安全」页面和实现状态中公开的验证范围为准。"
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
      <nav className="docs-inline-links" aria-label={copy("Release resources", "发布资源")}>
        <Link to="/updates/websocket-task-wakeups">
          {copy("Read the wakeup design", "阅读唤醒设计")}
        </Link>
        <Link to="/docs/operations">{copy("Review upgrade procedure", "查看升级流程")}</Link>
        <Link to="/docs/roadmap">{copy("See planned work", "查看后续计划")}</Link>
      </nav>
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
  if (page === "api") return <ApiReference />;
  if (page === "security") return <Security />;
  if (page === "self-hosting") return <SelfHosting />;
  if (page === "operations") return <OperationsGuide />;
  if (page === "troubleshooting") return <Troubleshooting />;
  if (page === "roadmap") return <Roadmap />;
  if (page === "contributing") return <ContributingGuide />;
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
