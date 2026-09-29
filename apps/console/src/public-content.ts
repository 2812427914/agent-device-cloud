import type { Locale } from "./i18n.tsx";

export interface LocalizedText {
  en: string;
  "zh-CN": string;
}

export interface PublicContentSection {
  id: string;
  title: LocalizedText;
  paragraphs: LocalizedText[];
  bullets?: LocalizedText[];
  code?: string;
}

export type PublicContentKind = "Product update" | "Engineering" | "Guide" | "Use case" | "Policy";

export interface PublicContentEntry {
  path: string;
  kind: PublicContentKind;
  title: LocalizedText;
  summary: LocalizedText;
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  sections: PublicContentSection[];
  keywords: string[];
  listed: boolean;
}

const text = (en: string, zh: string): LocalizedText => ({ en, "zh-CN": zh });

export function localize(value: LocalizedText, locale: Locale): string {
  return value[locale];
}

export const publicContent: PublicContentEntry[] = [
  {
    path: "/updates/websocket-task-wakeups",
    kind: "Product update",
    title: text(
      "Faster task delivery with outbound WebSocket wakeups",
      "使用出站 WebSocket 唤醒加快任务领取"
    ),
    summary: text(
      "Connectors now receive a minimal wake signal and claim durable work through the existing signed dispatch path.",
      "Connector 现在通过最小化唤醒信号获知新任务，再通过现有签名调度链路领取持久任务。"
    ),
    publishedAt: "2026-09-29",
    updatedAt: "2026-09-29",
    readingMinutes: 4,
    keywords: [
      "AI agent WebSocket",
      "durable task queue",
      "device connector",
      "outbound connection"
    ],
    listed: true,
    sections: [
      {
        id: "what-changed",
        title: text("What changed", "本次变化"),
        paragraphs: [
          text(
            "The Connector no longer relies on a one-second idle poll to discover work. It maintains an authenticated outbound WebSocket and receives a dispatch.available signal when the control plane has durable work for that device.",
            "Connector 不再依赖每秒一次的空闲轮询发现任务。它会维持一条经过身份认证的出站 WebSocket；当控制面存在该设备的持久任务时，只发送 dispatch.available 信号。"
          ),
          text(
            "The signal contains no invocation, path, credential or authorization decision. The Connector still calls the signed poll endpoint, where the control plane revalidates policy and PostgreSQL atomically claims the dispatch.",
            "该信号不包含调用内容、路径、凭据或授权结论。Connector 仍会调用签名 poll 接口，由控制面重新校验策略，并由 PostgreSQL 原子领取任务。"
          )
        ]
      },
      {
        id: "failure-model",
        title: text("Wake is fast; the queue is durable", "唤醒负责速度，队列负责可靠"),
        paragraphs: [
          text(
            "WebSocket delivery is intentionally best effort. A reconnect triggers an immediate poll, and a 30-second fallback poll recovers work after a lost signal, proxy restart or temporary network failure.",
            "WebSocket 唤醒被明确设计为尽力而为。重连会立即触发一次轮询，30 秒兜底轮询则负责在信号丢失、代理重启或临时网络故障后恢复任务。"
          )
        ],
        bullets: [
          text(
            "Outbound-only connection for NAT and firewall compatibility.",
            "仅建立出站连接，兼容 NAT 与防火墙。"
          ),
          text(
            "One active connection per device in a single control-plane instance.",
            "单个控制面实例内，每台设备只保留一条活跃连接。"
          ),
          text("Exponential reconnect backoff with jitter.", "使用带抖动的指数退避重连。"),
          text(
            "PostgreSQL remains the only source of truth for task state.",
            "PostgreSQL 仍然是任务状态的唯一事实来源。"
          )
        ]
      },
      {
        id: "operations",
        title: text("Operations and compatibility", "运维与兼容性"),
        paragraphs: [
          text(
            "Heartbeat presence updates are batched instead of writing capability data on every signed request. Older Connectors can continue polling, and their lease traffic still keeps long-running work visible as online.",
            "心跳在线状态采用批量更新，不再在每个签名请求中重复写入能力数据。旧版 Connector 仍可继续轮询，长任务的租约请求也会维持在线状态。"
          )
        ],
        code: `adc_node_wake_connections
adc_node_wake_total{outcome="sent|offline"}
adc_node_poll_total{outcome="dispatched|idle|denied"}`
      }
    ]
  },
  {
    path: "/articles/ai-agent-behind-nat",
    kind: "Engineering",
    title: text(
      "How an AI agent reaches a computer behind NAT without opening an inbound port",
      "AI Agent 如何在不开放入站端口的情况下访问 NAT 后的电脑"
    ),
    summary: text(
      "A practical architecture for outbound connectivity, durable dispatch and device-side authorization.",
      "一种结合出站连接、持久调度与设备侧授权的实用架构。"
    ),
    publishedAt: "2026-09-29",
    updatedAt: "2026-09-29",
    readingMinutes: 7,
    keywords: [
      "AI agent behind NAT",
      "remote AI agent",
      "secure device access",
      "outbound WebSocket"
    ],
    listed: true,
    sections: [
      {
        id: "problem",
        title: text("The connectivity problem", "连接问题"),
        paragraphs: [
          text(
            "Developer machines, home servers and office workstations usually sit behind NAT or a firewall. A cloud agent cannot safely dial those machines directly, and exposing SSH or a custom inbound API creates a new public attack surface.",
            "开发者电脑、家庭服务器和办公室工作站通常位于 NAT 或防火墙之后。云端 Agent 无法安全地直接连接这些设备，而公开 SSH 或自定义入站 API 又会增加新的公网攻击面。"
          ),
          text(
            "The useful direction is reversed: a small Connector on the device establishes an outbound TLS connection to a known control plane. Outbound traffic is already compatible with most networks, and the device keeps its private identity locally.",
            "更合理的方向是反过来：设备上的轻量 Connector 主动向已知控制面建立出站 TLS 连接。多数网络允许出站流量，同时设备私钥始终保留在本地。"
          )
        ]
      },
      {
        id: "separate-signal-state",
        title: text("Separate notification from state", "把通知和状态分开"),
        paragraphs: [
          text(
            "A WebSocket should not become the task database. It only says that work may be available. The durable invocation, authorization decision, lease and receipt remain in PostgreSQL and are retrieved through signed HTTPS requests.",
            "WebSocket 不应成为任务数据库。它只表示可能有任务可领取。持久调用、授权结论、租约与回执仍保存在 PostgreSQL 中，并通过签名 HTTPS 请求读取。"
          )
        ],
        bullets: [
          text("A lost wake does not lose the task.", "唤醒丢失不会导致任务丢失。"),
          text(
            "A reconnect can safely ask for pending work again.",
            "重连后可以安全地再次查询待处理任务。"
          ),
          text(
            "Multiple signals collapse into the same atomic claim.",
            "多个信号最终归并到同一次原子领取。"
          ),
          text(
            "Horizontal scaling can later replace the in-memory wake bus without changing dispatch semantics.",
            "未来横向扩容时可替换内存唤醒总线，而无需改变调度语义。"
          )
        ]
      },
      {
        id: "authorization",
        title: text("Connectivity is not authorization", "连接并不等于授权"),
        paragraphs: [
          text(
            "An online device is not automatically available to every agent. The control plane intersects account ownership, the Agent grant, device policy, exposed folders and the device's live capability before work is queued.",
            "设备在线并不代表所有 Agent 都能使用它。控制面会在任务入队前求取账号归属、Agent 授权、设备策略、开放目录和设备实时能力的权限交集。"
          ),
          text(
            "The device then validates the path and permission again immediately before execution. This preserves a local trust boundary even when cloud policy is stale or misconfigured.",
            "设备会在执行前再次校验路径和权限。即使云端策略过期或配置错误，本地信任边界仍然存在。"
          )
        ]
      },
      {
        id: "recovery",
        title: text("Design for sleep, restart and packet loss", "为休眠、重启和丢包而设计"),
        paragraphs: [
          text(
            "Laptops sleep, reverse proxies reload and mobile networks change. A production Connector needs bounded reconnect backoff, an immediate catch-up poll after reconnect and a slower fallback poll while no wake is received.",
            "笔记本会休眠，反向代理会重载，移动网络也会变化。生产级 Connector 需要有上限的重连退避、重连后的立即补偿轮询，以及未收到唤醒时的低频兜底轮询。"
          )
        ]
      }
    ]
  },
  {
    path: "/articles/not-remote-ssh",
    kind: "Guide",
    title: text(
      "Why Agent Device Cloud is not remote SSH",
      "为什么 Agent Device Cloud 不是远程 SSH"
    ),
    summary: text(
      "Remote shell access and governed tool execution solve different problems and create different security boundaries.",
      "远程 Shell 与受治理的工具执行解决的是不同问题，也形成不同的安全边界。"
    ),
    publishedAt: "2026-09-29",
    updatedAt: "2026-09-29",
    readingMinutes: 6,
    keywords: ["AI agent SSH alternative", "agent access control", "MCP security", "device audit"],
    listed: true,
    sections: [
      {
        id: "different-contract",
        title: text("A different contract", "不同的执行契约"),
        paragraphs: [
          text(
            "SSH gives a remote principal an interactive operating-system session. That is appropriate when a trusted human administrator needs a shell. An AI agent usually needs a narrower contract: read this file, apply this patch, run this approved command or call this local MCP tool.",
            "SSH 为远程主体提供交互式操作系统会话，适合可信管理员使用 Shell。AI Agent 通常需要更窄的契约：读取某个文件、应用补丁、运行已批准命令，或调用某个本地 MCP 工具。"
          )
        ]
      },
      {
        id: "policy",
        title: text("Authorization before execution", "先授权，再执行"),
        paragraphs: [
          text(
            "ADC evaluates a typed invocation against an Agent-specific grant and device-local limits. The request has an identity, target, bounded lifetime and explicit tool arguments. The result is recorded against the same invocation.",
            "ADC 会用 Agent 专属授权和设备本地限制校验类型化调用。每个请求都有身份、目标、有效期和明确的工具参数，结果也会记录在同一个调用之下。"
          )
        ],
        bullets: [
          text(
            "Different agents can receive different tools and folders.",
            "不同 Agent 可以获得不同工具与目录。"
          ),
          text("Writes or execution can require approval.", "写入或执行可以要求人工审批。"),
          text(
            "Revocation applies without redistributing SSH keys.",
            "撤销权限不需要重新分发 SSH 密钥。"
          ),
          text(
            "Side effects produce durable receipts for retry decisions.",
            "副作用会生成持久回执，用于判断是否可以重试。"
          )
        ]
      },
      {
        id: "when-ssh",
        title: text("When SSH is still the right tool", "什么时候仍应使用 SSH"),
        paragraphs: [
          text(
            "ADC does not replace emergency administration, arbitrary interactive debugging or mature SSH infrastructure operated by trusted engineers. It is intended for repeatable Agent actions where explicit scope, approval and audit matter more than unrestricted shell flexibility.",
            "ADC 不替代紧急运维、任意交互调试，也不替代由可信工程师维护的成熟 SSH 基础设施。它面向可重复的 Agent 操作，此时明确范围、审批和审计比无限制 Shell 灵活性更重要。"
          )
        ]
      }
    ]
  },
  {
    path: "/use-cases/remote-local-development",
    kind: "Use case",
    title: text(
      "Continue local development from a remote AI agent",
      "让远程 AI Agent 继续本地开发工作"
    ),
    summary: text(
      "Use the repository, dependencies and test environment already configured on a developer machine.",
      "直接使用开发者电脑上已经配置好的仓库、依赖和测试环境。"
    ),
    publishedAt: "2026-09-29",
    updatedAt: "2026-09-29",
    readingMinutes: 5,
    keywords: [
      "remote coding agent",
      "AI agent local repository",
      "Claude Code remote device",
      "MCP local files"
    ],
    listed: true,
    sections: [
      {
        id: "scenario",
        title: text("The scenario", "使用场景"),
        paragraphs: [
          text(
            "A repository already builds on a developer Mac or Linux workstation. It has the right SDKs, caches, test data and local services. Recreating that environment in a cloud sandbox adds delay and often changes the behavior being investigated.",
            "一个仓库已经可以在开发者的 Mac 或 Linux 工作站上构建。正确的 SDK、缓存、测试数据和本地服务都已就绪。把环境重新复制到云端沙箱既耗时，也可能改变正在排查的问题。"
          )
        ]
      },
      {
        id: "workflow",
        title: text("A bounded workflow", "受约束的工作流"),
        paragraphs: [
          text(
            "Expose one repository folder, authorize one Agent for the required tools and connect the preferred MCP client or CLI. The Agent can inspect files, apply a focused patch and run the existing test command without receiving general access to the rest of the device.",
            "开放一个仓库目录，为一个 Agent 授予所需工具，再连接常用的 MCP 客户端或 CLI。Agent 可以读取文件、应用小范围补丁并运行现有测试命令，而不获得设备其他区域的通用访问权。"
          )
        ],
        code: `adc login --url https://your-adc.example
adc connect ACCESS
adc invoke file.read --node node_example \\
  --args '{"path":"/Users/me/work/README.md"}' --json`
      },
      {
        id: "controls",
        title: text("Controls that remain in place", "仍然有效的控制"),
        paragraphs: [
          text(
            "The device keeps the final decision. Removing the folder or narrowing local access is reflected by the Connector and can cancel affected running work. Every completed side effect retains a receipt for later review.",
            "设备仍然拥有最终决定权。移除目录或收紧本地权限后，Connector 会同步变化，并可取消受影响的运行中任务。每个已完成的副作用都会留下可供复核的回执。"
          )
        ]
      }
    ]
  },
  {
    path: "/privacy",
    kind: "Policy",
    title: text("Privacy", "隐私说明"),
    summary: text(
      "What the hosted service processes, what stays on the device and how public-site analytics are bounded.",
      "说明托管服务处理哪些数据、哪些数据保留在设备，以及公开站点分析的边界。"
    ),
    publishedAt: "2026-09-29",
    updatedAt: "2026-09-29",
    readingMinutes: 5,
    keywords: ["Agent Device Cloud privacy", "AI agent privacy", "self-hosted telemetry"],
    listed: false,
    sections: [
      {
        id: "product-data",
        title: text("Product data", "产品数据"),
        paragraphs: [
          text(
            "The control plane stores account and authorization records, disclosed device capability metadata, invocation state, requested results, artifacts and receipts required to operate the service. It does not crawl or mirror a connected filesystem.",
            "控制面会保存运行服务所需的账号与授权记录、设备主动披露的能力元数据、调用状态、请求返回的结果、产物和回执。它不会抓取或镜像已连接设备的文件系统。"
          ),
          text(
            "Device private keys, unrequested files and local MCP Provider credentials remain on the device.",
            "设备私钥、未请求的文件以及本地 MCP Provider 凭据始终保留在设备上。"
          )
        ]
      },
      {
        id: "hosted-analytics",
        title: text("Official hosted analytics", "官方托管版分析"),
        paragraphs: [
          text(
            "The official hosted website may enable a privacy-focused analytics provider to measure page visits, referrers, campaign parameters and a small set of named product-funnel events. Event payloads exclude file paths, commands, tool arguments, results, device names, account names and credentials.",
            "官方托管网站可以启用隐私友好的分析服务，用于统计页面访问、来源、活动参数和少量具名产品漏斗事件。事件载荷不包含文件路径、命令、工具参数、执行结果、设备名称、账号名称或凭据。"
          )
        ]
      },
      {
        id: "self-hosting",
        title: text("Self-hosted installations", "自托管部署"),
        paragraphs: [
          text(
            "A source build or self-hosted installation does not send analytics to the Agent Device Cloud project by default. Analytics code remains inert unless the installation operator explicitly configures a provider endpoint and site identifier.",
            "源码构建或自托管实例默认不会向 Agent Device Cloud 项目发送分析数据。只有部署管理员显式配置分析服务地址和站点标识后，相关代码才会启用。"
          )
        ]
      },
      {
        id: "controls",
        title: text("Operator controls", "部署管理员控制"),
        paragraphs: [
          text(
            "Removing the analytics environment variables disables script injection and all browser analytics calls. The product also honors the browser's Global Privacy Control and Do Not Track preferences.",
            "移除分析环境变量后，系统不会注入分析脚本，也不会发起浏览器分析请求。产品同时尊重浏览器的 Global Privacy Control 与 Do Not Track 偏好。"
          )
        ]
      }
    ]
  },
  {
    path: "/telemetry",
    kind: "Policy",
    title: text("Telemetry policy", "遥测策略"),
    summary: text(
      "The open-source and self-hosted defaults, the hosted event catalog and the data that is never collected.",
      "说明开源与自托管默认值、托管版事件目录，以及永不采集的数据。"
    ),
    publishedAt: "2026-09-29",
    updatedAt: "2026-09-29",
    readingMinutes: 6,
    keywords: ["Agent Device Cloud telemetry", "open source analytics policy", "ADC analytics"],
    listed: false,
    sections: [
      {
        id: "default",
        title: text("Default: no external telemetry", "默认：不向外发送遥测"),
        paragraphs: [
          text(
            "The repository ships without an analytics endpoint, tracking identifier or advertising pixel. Building and running the project from source does not contact an ADC analytics service.",
            "仓库默认不包含分析端点、跟踪标识或广告像素。从源码构建并运行项目时，不会联系 ADC 分析服务。"
          )
        ]
      },
      {
        id: "hosted-events",
        title: text("Hosted event catalog", "托管版事件目录"),
        paragraphs: [
          text(
            "An official deployment may record route views and the following coarse conversion events. They answer whether onboarding works; they are not an execution audit trail.",
            "官方部署可以记录路由访问和以下粗粒度转化事件。它们用于判断接入流程是否顺畅，不属于执行审计日志。"
          )
        ],
        bullets: [
          text("Primary call-to-action selected.", "点击主要行动入口。"),
          text("Email registration or sign-in completed.", "完成邮箱注册或登录。"),
          text("GitHub sign-in started.", "开始 GitHub 登录。"),
          text("Device pairing code created.", "创建设备配对码。"),
          text("Agent authorization created.", "创建 Agent 授权。"),
          text("CLI or MCP connection created.", "创建 CLI 或 MCP 连接。"),
          text("Initial account setup completed.", "完成账号首次配置。")
        ]
      },
      {
        id: "never",
        title: text("Never included", "永不包含"),
        paragraphs: [
          text(
            "Analytics events never include invocation arguments or outputs. In particular, ADC excludes file paths, file contents, shell commands, MCP request bodies, prompts, tokens, private keys, email addresses, device labels and repository names.",
            "分析事件绝不包含调用参数或执行输出，尤其不包含文件路径、文件内容、Shell 命令、MCP 请求体、Prompt、Token、私钥、邮箱地址、设备标签或仓库名称。"
          )
        ]
      },
      {
        id: "audit-separation",
        title: text("Analytics is separate from audit", "分析与审计相互独立"),
        paragraphs: [
          text(
            "Product analytics measures adoption. The account audit ledger records authorized product actions for the account owner. Prometheus metrics describe service health. These systems have different schemas, access rules and retention policies.",
            "产品分析用于衡量使用情况；账号审计账本记录授权后的产品操作，供账号用户查看；Prometheus 指标描述服务健康状态。三者使用不同的数据结构、访问规则和保留策略。"
          )
        ]
      }
    ]
  }
];

export const listedPublicContent = publicContent.filter((entry) => entry.listed);

export function publicContentEntry(pathname: string): PublicContentEntry | undefined {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return publicContent.find((entry) => entry.path === normalized);
}
