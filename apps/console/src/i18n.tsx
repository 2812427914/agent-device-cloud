import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Languages } from "lucide-react";

export const zh = {
  Manage: "管理",
  Edit: "编辑",
  Delete: "删除",
  Access: "访问权限",
  Active: "有效",
  All: "全部",
  Unavailable: "暂不可用",
  "Manage device": "管理设备",
  "Device name": "设备名称",
  "Search devices": "搜索设备",
  "No matching devices": "没有符合条件的设备",
  "Device updated.": "设备设置已保存。",
  "Device deleted.": "设备已移除。",
  "Device revoked.": "设备访问已撤销。",
  "Delete device {name}?": "删除设备「{name}」？",
  "Revoke device {name}?": "撤销设备「{name}」？",
  "The device will be removed and its access stopped. Local files and execution history are kept. Before pairing again, run adc-node unpair --confirm {nodeId} on that device.":
    "设备将从列表移除并停止访问，本地文件和执行历史会保留。重新配对前，请在该设备运行 adc-node unpair --confirm {nodeId}。",
  "Agents will lose access to this device. The device stays listed for your records.":
    "Agent 将无法再访问这台设备。设备会保留在已撤销列表中。",
  "These limits apply to every agent on this device. Local permissions remain the upper limit.":
    "这些限制对使用此设备的所有 Agent 生效。实际权限始终以设备本地开放范围为上限。",
  "Include all current and future exposed folders": "包含设备当前及以后开放的全部目录",
  "Allow commands and tests": "允许执行命令和测试",
  "Affected agents": "使用此设备的 Agent",
  "Manage agent access": "管理 Agent 授权",
  "New calls use saved limits immediately. Running tasks are checked again on their next lease renewal.":
    "保存后新请求立即使用新限制，运行中的任务会在下次续租时重新检查权限。",
  "Add or change local folders": "添加或更改本地目录",
  "Run the command on this device. The folder appears here automatically; no pairing is needed.":
    "在这台设备上运行命令，目录会自动出现在此处，无需重新配对。",
  "Local folder path": "本地目录路径",
  "To use your home folder or full device trust, run adc-node access home or adc-node access full locally.":
    "开放主目录或完全信任设备，可在本机运行 adc-node access home 或 adc-node access full。",
  "Revoke stops access and keeps the device listed. Delete also removes it from your device list.":
    "撤销会停止访问并保留设备记录；删除还会将设备从列表移除。",
  "Edit authorization": "编辑 Agent 授权",
  "Search authorizations": "搜索 Agent 授权",
  "No matching authorizations": "没有符合条件的授权",
  "Changes apply to existing tokens and MCP connections. No new token is needed.":
    "保存后现有 Token 和 MCP 连接使用新的权限，无需重新生成 Token。客户端的工具列表如有缓存，重新连接即可刷新。",
  "Changes apply to existing connections. No reconnection is needed.":
    "保存后现有连接立即使用新的权限，无需重新连接。",
  "Authorization updated. Existing tokens use the saved permissions.":
    "授权已更新，现有 Token 将使用保存后的权限。",
  "Authorization updated. Existing connections use the saved permissions.":
    "授权已更新，现有连接将使用保存后的权限。",
  "Agent authorized.": "Agent 已授权。",
  "Authorization deleted.": "授权已删除，相关 Token 和 MCP 连接已失效。",
  "Authorization revoked.": "授权已撤销，相关 Token 和 MCP 连接已失效。",
  "Delete authorization {name}?": "删除授权「{name}」？",
  "Revoke authorization {name}?": "撤销授权「{name}」？",
  "This authorization and its tokens will be removed from the list. All associated tokens and MCP connections stop working. Execution history is kept.":
    "此授权及相关 Token 将从列表移除，所有关联 Token 和 MCP 连接会停止工作。执行历史会保留。",
  "This authorization and its connections will be removed from the list. Execution history is kept.":
    "此授权及相关连接将从列表移除并停止工作，执行历史会保留。",
  "All tokens and MCP connections for this authorization stop working. You can still view or delete the revoked authorization.":
    "此授权的所有 Token 和 MCP 连接会停止工作。你仍可以查看或删除已撤销的授权。",
  "All connections for this authorization stop working. You can still view or delete the revoked authorization.":
    "此授权的所有连接都会停止工作，你仍可以查看或删除已撤销的授权。",
  "No folders selected: device discovery and task tools only.":
    "未选择目录时，仅可使用设备发现和任务管理工具。",
  "Device changed. Refresh and try again.": "设备已被其他操作修改，请关闭编辑窗口并刷新后重试。",
  "Authorization changed. Refresh and try again.":
    "授权已被其他操作修改，请关闭编辑窗口并刷新后重试。",
  "A device with this name already exists.": "已有同名设备，请使用其他名称。",
  "Choose folders already exposed by this device.": "请选择设备已开放的目录。",
  "Grant resources must belong to this account and the selected devices.":
    "授权目录必须属于当前账户及所选设备，请检查设备与目录选择。",
  "Your agents. Your devices.": "你的 Agent，你的设备。",
  "Connected, on your terms.": "连接起来，由你掌控。",
  "A private connection between AI agents and the computers you trust. Bring your files, tools and workflows to any agent — with access you control.":
    "将 AI Agent 连接到你信任的电脑。让文件、工具和工作流为 Agent 所用，每一份访问权限都由你决定。",
  "Start connecting": "开始连接",
  "Explore how it works": "了解工作方式",
  Product: "产品",
  "Use cases": "使用场景",
  Architecture: "架构",
  Roadmap: "路线图",
  "Private device infrastructure for AI agents": "面向 AI Agent 的私有设备基础设施",
  "Public preview · Private device infrastructure for AI agents":
    "公网预览 · 面向 AI Agent 的私有设备基础设施",
  "Give any AI agent controlled access to the files, tools and environments already on your devices.":
    "让任何 AI Agent 在你的控制下，使用设备上已有的文件、工具和环境。",
  "Agents keep using MCP, CLI or SDK. ADC authorizes and routes each call; the selected Mac or Linux device runs the tool.":
    "Agent 继续使用 MCP、CLI 或 SDK；ADC 负责授权和路由，由选定的 Mac 或 Linux 设备执行工具。",
  "Connect a device": "连接设备",
  "Read the architecture": "了解架构",
  "Live control plane": "实时控制面",
  "Agent request": "Agent 请求",
  "Call a local MCP tool": "调用本地 MCP 工具",
  "Authorized tool call": "已授权的工具调用",
  "Policy check": "策略检查",
  "Identity verified": "身份已验证",
  "Agent grant matched": "Agent 授权已匹配",
  "Device policy allowed": "设备策略已允许",
  "Approval satisfied": "审批条件已满足",
  "Folder allowed": "目录已授权",
  "Execution approved": "执行已许可",
  "Policy and placement": "策略与任务路由",
  "Audit ledger": "审计账本",
  "Signed lease": "签名租约",
  "Built-in tools + MCP Providers": "内置工具 + MCP Provider",
  Connected: "已连接",
  "Provider credentials stay local": "Provider 凭据留在本地",
  "Completed on device": "已在设备上完成",
  "Receipt recorded": "回执已记录",
  "Invocation lifecycle": "调用生命周期",
  Authorized: "已授权",
  Queued: "已入队",
  Claimed: "已领取",
  Running: "执行中",
  Succeeded: "已成功",
  "Runs on your device": "在你的设备上执行",
  "Only requested results travel back.": "仅返回请求产生的结果。",
  "Outbound connection": "仅出站连接",
  "No inbound port on the device.": "设备无需开放入站端口。",
  "Explicit access": "显式授权",
  "Each Agent gets its own grant.": "每个 Agent 使用独立授权。",
  "Auditable effects": "副作用可审计",
  "Every side effect gets a receipt.": "每次副作用操作都有回执。",
  "Why Agent Device Cloud": "为什么需要 Agent Device Cloud",
  "The context agents need is not in the cloud.": "Agent 所需的真实上下文，并不都在云端。",
  "Your code, tools, credentials and private services already live on machines you control.":
    "代码、工具、凭据和私有服务，本来就存在于你掌控的设备上。",
  "Cloud agents are useful, but copying an entire working environment into every agent is slow, fragile and difficult to govern.":
    "云端 Agent 很有价值，但把完整工作环境复制给每个 Agent，既缓慢脆弱，也难以治理。",
  "Agent Device Cloud connects the two without turning your device into an unaudited remote shell.":
    "Agent Device Cloud 在两者之间建立受控连接，而不是把设备变成无法审计的远程 Shell。",
  "Built first for developers and self-hosters": "首先为开发者与自部署用户打造",
  "Real work, on the machine that is ready for it.": "让真实工作发生在已经准备好的设备上。",
  "Continue local development": "延续本地开发",
  "Let an agent inspect a repository, apply focused edits and run existing tests without rebuilding the environment elsewhere.":
    "让 Agent 检查代码仓库、完成精准修改并运行现有测试，无需在别处重建开发环境。",
  "Connect existing MCP tools": "接入已有 MCP 工具",
  "Register local stdio or Streamable HTTP MCP servers without moving Provider credentials to the control plane.":
    "注册本地 stdio 或 Streamable HTTP MCP 服务，无需将 Provider 凭据上传至控制面。",
  "Move work across interfaces": "跨入口延续工作",
  "Start from an MCP client, terminal, Skill or SDK and route the same governed work to the intended device.":
    "从 MCP 客户端、终端、Skill 或 SDK 发起任务，并将同一套受控工作路由到目标设备。",
  "Automate with boundaries": "在边界内自动化",
  "Use explicit templates, writable folders and approval rules for repeatable work instead of sharing unrestricted access.":
    "通过明确的命令模板、可写目录和审批规则完成重复工作，而不是共享无限制权限。",
  "Developer Mac": "开发者 Mac",
  "Mac, Linux or NAS": "Mac、Linux 或 NAS",
  "Selected device": "指定设备",
  "Approved device": "获批设备",
  Work: "工作任务",
  "Governed route": "受治理链路",
  "Execution target": "执行目标",
  "One control plane. Execution remains local.": "一个控制面，执行始终留在本地。",
  "Use familiar Agent interfaces. ADC applies authorization and routing centrally; the selected device validates and executes each tool locally.":
    "继续使用熟悉的 Agent 接口；ADC 在控制面完成授权与路由，由选定设备在本地校验并执行工具。",
  "Agent interface": "Agent 接入层",
  "Use MCP, CLI, Skill or SDK to call authorized tools on the selected device.":
    "通过 MCP、CLI、Skill 或 SDK 调用选定设备上的授权工具。",
  "MCP client": "MCP 客户端",
  CLI: "CLI",
  SDK: "SDK",
  "Control plane": "控制面",
  "Authenticates, authorizes, routes and records. It does not execute your tools.":
    "负责身份、授权、路由和记录，但不执行你的本地工具。",
  Identity: "身份认证",
  Authorization: "权限决策",
  Placement: "设备选择",
  "Outbound poll": "出站轮询",
  "Built-in tools": "内置工具",
  "Signed requests": "签名请求",
  "Lease and ACK": "租约与确认",
  "Path validation": "路径校验",
  "Tool execution": "工具执行",
  "Receipt ledger": "回执账本",
  "Outbound dispatch": "出站任务派发",
  "Local execution": "本地执行",
  "Dispatch state": "派发状态",
  "Makes an outbound connection, advertises built-in and local MCP tools, and maintains the lease.":
    "建立出站连接，上报内置工具与本地 MCP 工具，并维护任务租约。",
  "Local runtime": "本地运行时",
  "Revalidates local policy, runs built-in tools or calls the selected MCP Provider, and persists a receipt.":
    "再次校验本地策略，执行内置工具或调用选定的 MCP Provider，并持久化回执。",
  "Authorized request": "已授权请求",
  "Control plane records": "控制面记录",
  "Accounts, disclosed path metadata, grants, invocation state, requested results, artifacts and receipts.":
    "账户、已公开的路径元数据、授权、调用状态、请求返回结果、产物和回执。",
  "Device retains": "设备本地保留",
  "The private device key, unrequested files and the local environment. Only an authorized operation can return content.":
    "设备私钥、未被请求的文件和本地环境；只有获得授权的操作才能返回内容。",
  "Explore the system design": "深入了解系统设计",
  "Trust is designed into every transition.": "信任建立在每一次状态流转中。",
  "Permission is the smallest shared intersection.": "最终权限，是所有边界共同允许的最小交集。",
  "Account boundary": "账户边界",
  "Same account owner": "同一账户所有者",
  "Agent grant": "Agent 授权",
  "Device and tool selected": "已选择设备与工具",
  "Device policy": "设备策略",
  "Writes and execution enabled": "允许写入与执行",
  "Exposed folder": "本地开放目录",
  "Live capability": "实时设备能力",
  "file.patch advertised": "设备已声明 file.patch",
  "Effective permission": "最终生效权限",
  "Allowed only when every layer agrees.": "只有每一层都同意，请求才会执行。",
  "Cancellation is checked during lease renewal. An unprovable side effect becomes unknown_outcome, never a silent retry.":
    "任务会在租约续期时重新检查取消状态；无法证明结果的副作用会进入 unknown_outcome，绝不会静默重试。",
  "Separate identities": "身份相互隔离",
  "User sessions manage the account, Agent credentials use one grant, and every device owns a separate key.":
    "用户会话管理账户，Agent 凭据绑定单一授权，每台设备拥有独立密钥。",
  "Intersect permissions": "权限逐层求交",
  "Account, Agent, device, folder and capability rules must all allow the same operation.":
    "账户、Agent、设备、目录和能力规则必须同时允许同一操作。",
  "Keep local authority": "设备保留最终决定权",
  "The device validates paths and permissions again. Cloud policy can narrow local access, never expand it.":
    "设备会再次验证路径和权限；云端策略只能收紧本地权限，不能扩大它。",
  "Record side effects": "记录每次副作用",
  "Idempotency, leases and durable receipts make retries and uncertain outcomes explicit.":
    "通过幂等、租约和持久回执，明确表达重试与不确定结果。",
  "Security boundary, stated plainly": "坦诚说明安全边界",
  "Restricted process mode reduces common mistakes; it is not an OS sandbox. Full device trust uses the connector user's actual permissions.":
    "受限进程模式用于减少常见误操作，并不是操作系统沙箱；完全信任模式会使用连接器用户的实际系统权限。",
  "Read the security model": "阅读安全模型",
  "Familiar interfaces, one policy": "熟悉的接口，统一的策略",
  "Bring your own Agent.": "使用你选择的 Agent。",
  "Use MCP, CLI, Skill or SDK. ADC applies the same authorization, device selection and audit trail behind each interface.":
    "使用 MCP、CLI、Skill 或 SDK；ADC 在每种接口背后应用相同的授权、设备选择和审计链路。",
  "Integration guides": "集成指南",
  "A clear boundary between available and planned.": "清楚区分已经可用与仍在规划的能力。",
  "Available now": "当前可用",
  "A complete personal device loop": "完整的个人设备闭环",
  "Accounts, macOS/Linux connectors, local MCP Providers, scoped grants, approvals, audit, MCP OAuth, CLI, Skill and self-hosting.":
    "账户、macOS/Linux 连接器、本地 MCP Provider、范围授权、审批、审计、MCP OAuth、CLI、Skill 与自部署。",
  "Production hardening": "生产级加固",
  "Signed releases, automatic updates, keychain storage, quotas, retention and external artifact storage.":
    "签名发布、自动升级、安全密钥存储、配额、保留策略和外部产物存储。",
  Later: "长期",
  "Teams and broader capabilities": "团队与更广泛的设备能力",
  "Container isolation, team roles, SSO, SIEM export, Windows and additional local executors.":
    "容器隔离、团队角色、SSO、SIEM 导出、Windows 与更多本地执行器。",
  "See the roadmap": "查看路线图",
  "Hosted or self-hosted": "托管或自部署",
  "One product, the same trust model.": "同一个产品，同一套信任模型。",
  "Self-hosting is not a reduced edition. It uses the same accounts, authorization, approvals, audit and device software.":
    "自部署不是功能缩水版，它使用相同的账户、授权、审批、审计和设备软件。",
  "Use the hosted preview now, or deploy the same application on your own infrastructure. Both use the same accounts, authorization, approvals, audit and device software.":
    "现在即可使用托管预览，也可以在自己的基础设施上部署同一应用；两者使用相同的账户、授权、审批、审计和设备软件。",
  "Deploy it yourself": "自行部署",
  "Self-hosting guide": "自部署指南",
  "Questions that should have clear answers.": "重要问题，应该有明确答案。",
  "Does the control plane copy my device?": "控制面会复制我的设备数据吗？",
  "No. It does not crawl or mirror your filesystem. Authorized requests and their returned results pass through the control plane and are recorded for audit.":
    "不会。它不会扫描或镜像你的文件系统；获得授权的请求及其返回结果会经过控制面，并为审计而记录。",
  "Is full device trust sandboxed?": "完全信任模式有沙箱吗？",
  "No. It deliberately uses the connector user's OS permissions. Use selected folders and narrow tool grants when that level of trust is unnecessary.":
    "没有。它会明确使用连接器用户的系统权限；不需要这种信任级别时，请使用指定目录并缩小工具授权。",
  "What happens when my device sleeps?": "设备休眠后会发生什么？",
  "New calls report the device as offline. The connector reconnects automatically after the device wakes.":
    "新调用会报告设备离线；设备唤醒后，连接器会自动重新连接。",
  "Do I need to reinstall after changing folders?": "修改目录后需要重新安装吗？",
  "No. Local folder and access changes reload automatically and immediately narrow affected running work.":
    "不需要。本地目录和访问模式会自动重新加载，并立即收紧受影响的运行任务。",
  "Do MCP Provider credentials leave my device?": "MCP Provider 凭据会离开我的设备吗？",
  "No. Provider environment variables and HTTP headers stay in the local Connector configuration. The control plane receives tool descriptions and requested results, not Provider credentials.":
    "不会。Provider 环境变量和 HTTP Header 保存在本地 Connector 配置中；控制面只接收工具描述和请求返回结果，不接收 Provider 凭据。",
  "Connect the tools and environment you already trust.": "连接你已经信任的工具与工作环境。",
  "Start with one device, one folder and one Agent authorization.":
    "从一台设备、一个目录和一份 Agent 授权开始。",
  "Read the docs": "阅读文档",
  Start: "开始",
  Understand: "理解",
  Build: "接入与构建",
  Operate: "部署与运维",
  Project: "项目",
  "Choose the narrowest workflow that gives an Agent the context it needs. Expand access only when the work requires it.":
    "从满足任务所需的最小工作流开始，只在确有需要时扩大访问范围。",
  "Typical access": "典型能力",
  "Expected outcome": "预期结果",
  "The existing repository, dependencies and toolchain stay on the selected machine.":
    "现有代码仓库、依赖和工具链都保留在所选设备上。",
  "The Agent receives only requested results rather than a copy of the whole environment.":
    "Agent 只获得请求产生的结果，而不是整个环境的副本。",
  "Every interface uses the same authorization, error semantics and audit trail.":
    "所有入口使用相同的授权、错误语义和审计链路。",
  "Sensitive actions remain reviewable and retries have explicit idempotency semantics.":
    "敏感操作始终可供审查，重试具有明确的幂等语义。",
  "Agent Device Cloud is not a public compute marketplace, a general RPA product or a hosted shell.":
    "Agent Device Cloud 不是公共算力市场、通用 RPA 产品或云端 Shell。",
  "Request lifecycle": "请求生命周期",
  "Current request path": "当前请求链路",
  "Control plane boundary": "控制面边界",
  "Device boundary": "设备边界",
  "The client creates a typed invocation from its current Agent authorization.":
    "客户端根据当前 Agent 授权创建类型明确的调用。",
  "The control plane resolves the device and evaluates every policy layer.":
    "控制面选择目标设备并逐层评估策略。",
  "Approval-sensitive work waits without occupying a device lease.":
    "需要审批的任务在等待期间不会占用设备租约。",
  "The device claims, acknowledges and renews a bounded execution lease.":
    "设备领取任务、确认接收，并续订有明确期限的执行租约。",
  "The local runtime validates the resource again before executing.":
    "本地运行时在执行前再次验证目标资源。",
  "The terminal result, receipt and optional artifact return to the control plane.":
    "最终结果、回执和可选产物会返回控制面。",
  "Effective authorization": "最终生效权限",
  "An operation proceeds only when every independent boundary permits it; no layer can expand a narrower one.":
    "只有每个独立边界都明确允许时，操作才会继续；任何一层都不能扩大更窄的权限。",
  "Delivery semantics": "投递语义",
  "Dispatch is at-least-once. Side effects require an actor-scoped idempotency key and are recorded in a local durable ledger before execution.":
    "任务采用至少一次投递；副作用操作必须提供调用方范围的幂等键，并在执行前写入本地持久账本。",
  "If execution may have happened but no terminal receipt can be proven, the result is unknown_outcome and is never silently retried.":
    "如果操作可能已执行但无法证明存在最终回执，结果会明确标记为 unknown_outcome，且不会静默重试。",
  "No terminal receipt can be proven": "无法证明存在最终回执",
  "Data boundaries": "数据边界",
  "Roadmap items describe direction, not shipped capability. Current behavior is always documented separately from future work.":
    "路线图描述的是方向，而不是已经交付的能力；当前行为始终与未来规划分开说明。",
  "Personal accounts, email and GitHub sign-in": "个人账户、邮箱与 GitHub 登录",
  "macOS and glibc Linux connectors for arm64 and x64":
    "支持 arm64 与 x64 的 macOS 和 glibc Linux 连接器",
  "Scoped Agent grants, approvals, audit and durable receipts":
    "范围明确的 Agent 授权、审批、审计与持久回执",
  "MCP OAuth, Agent tokens, CLI, SDK and official Skill":
    "MCP OAuth、Agent Token、CLI、SDK 与官方 Skill",
  "MCP OAuth, CLI connections, SDK and official Skill": "MCP OAuth、CLI 连接、SDK 与官方 Skill",
  "The same application for hosted and self-hosted deployment": "托管与自部署使用同一个完整应用",
  "Hosted public preview and the same application for self-hosted deployment":
    "托管公网预览与自部署使用同一个完整应用",
  "Signed release packages and unattended updates": "签名发布包与无人值守升级",
  "Keychain and keyring-backed device identity": "由 Keychain 或 keyring 保护的设备身份",
  "External artifact storage, quotas and retention": "外部产物存储、配额与保留策略",
  "Operational doctor, backup and restore automation": "运维诊断与备份恢复自动化",
  "Interoperability validation with named MCP clients": "与主流 MCP 客户端完成互操作认证",
  "Linux container isolation for higher-risk execution": "面向高风险执行的 Linux 容器隔离",
  "Team roles, shared device pools and approval workflows": "团队角色、共享设备池与审批工作流",
  "Enterprise SSO, SCIM and SIEM export": "企业 SSO、SCIM 与 SIEM 导出",
  "Windows connector and additional local executors": "Windows 连接器与更多本地执行器",
  "Tool plugin and community Skill ecosystem": "工具插件与社区 Skill 生态",
  "What will not change": "长期不变的原则",
  "Device-side policy remains the final authority.": "设备侧策略始终拥有最终决定权。",
  "Hosted and self-hosted deployments keep the same core product.":
    "托管与自部署始终共享同一个核心产品。",
  "Protocol, policy and receipts remain independent from any single Agent.":
    "协议、策略和回执始终独立于任何单一 Agent。",
  "What the control plane can see": "控制面可以看到什么",
  "The control plane stores exposed path names, invocation arguments, returned results, artifacts and audit metadata.":
    "控制面会保存已开放的路径名称、调用参数、返回结果、产物和审计元数据。",
  "It does not hold the device private key or proactively crawl the filesystem. An authorized result may still contain sensitive data.":
    "它不持有设备私钥，也不会主动扫描文件系统；但获得授权后返回的结果仍可能包含敏感数据。",
  "Threats and controls": "威胁与控制措施",
  Threat: "威胁",
  Control: "控制措施",
  "Residual risk": "剩余风险",
  "Stolen Agent token": "Agent Token 被盗",
  "Tokens are hashed, expire and bind to one revocable authorization.":
    "Token 以哈希保存、具有有效期，并绑定到一份可撤销授权。",
  "A copied bearer token remains usable until it expires or is revoked.":
    "被复制的 Bearer Token 在到期或撤销前仍然可用。",
  "Stolen access key": "访问密钥被盗",
  "Access keys are hashed, expire and bind to one revocable authorization.":
    "访问密钥以哈希保存、具有有效期，并绑定到一份可撤销授权。",
  "A copied access key remains usable until it expires or is revoked.":
    "被复制的访问密钥在到期或撤销前仍然可用。",
  "Compromised device key": "设备密钥泄露",
  "Every request uses an Ed25519 signature, timestamp and durable one-time nonce.":
    "每个请求都使用 Ed25519 签名、时间戳和持久化一次性随机数。",
  "A stolen private key remains valid until the device is revoked.":
    "被盗私钥在设备撤销前仍然有效。",
  "Path escape": "路径逃逸",
  "Canonical paths, realpath, no-follow opens and descriptor identity checks are enforced locally.":
    "设备本地执行规范路径、realpath、禁止跟随链接和文件描述符身份检查。",
  "Portable APIs cannot eliminate every hostile parent-directory race or hard-link alias.":
    "可移植 API 无法消除所有恶意父目录竞争或硬链接别名风险。",
  "Duplicate side effect": "副作用重复执行",
  "Stable idempotency keys and a fsynced local ledger prevent automatic duplicate execution.":
    "稳定幂等键和经过 fsync 的本地账本用于阻止自动重复执行。",
  "A crash after the effect but before its receipt is reported as unknown_outcome.":
    "如果副作用发生后、回执写入前崩溃，系统会报告 unknown_outcome。",
  "Sensitive output": "敏感输出",
  "Protected paths, bounded output and common secret patterns are filtered in restricted mode.":
    "受限模式会过滤受保护路径、限制输出大小并识别常见密钥模式。",
  "Redaction is best effort and cannot prove arbitrary authorized content is safe.":
    "脱敏属于尽力防护，无法保证任意已授权内容都不包含敏感信息。",
  "Current assurance": "当前验证范围",
  "Verified in automation": "已通过自动化验证",
  "Verified in automation and preview": "已通过自动化与公网预览验证",
  "Protocol schemas, policy decisions and adapter parity": "协议 Schema、策略决策与适配器一致性",
  "Real PostgreSQL migrations, locking, restart and account isolation":
    "真实 PostgreSQL 迁移、锁、重启与账户隔离",
  "Path traversal, symlink escape, cancellation and idempotency recovery":
    "路径穿越、符号链接逃逸、取消与幂等恢复",
  "macOS arm64 installation, upgrade, reconnect and uninstall":
    "macOS arm64 安装、升级、重连与卸载",
  "Public HTTPS deployment, database readiness and restart recovery":
    "公网 HTTPS 部署、数据库就绪检查与重启恢复",
  "Not yet certified": "尚未完成认证",
  "External penetration testing and signed release provenance": "外部渗透测试与签名发布溯源",
  "Production SMTP, real GitHub consent and public TLS deployment":
    "生产 SMTP、真实 GitHub 授权与公网 TLS 部署",
  "Production SMTP and real GitHub consent flows": "生产 SMTP 与真实 GitHub 授权流程",
  "Linux systemd and every generated cross-platform archive":
    "Linux systemd 与全部跨平台安装包实机验证",
  "Hard filesystem, network and process isolation": "文件系统、网络与进程级硬隔离",
  Docs: "文档",
  Documentation: "文档中心",
  "Search docs": "搜索文档",
  "No matching documentation": "没有匹配的文档",
  "Guides and reference for connecting agents to your devices.":
    "连接 Agent 与设备所需的指南和参考资料。",
  "Understand where the product fits, how its trust model works and how to connect your first governed device workflow.":
    "了解产品适用场景、信任模型，以及如何连接第一个受治理的设备工作流。",
  "Get started": "快速开始",
  "Core concepts": "核心概念",
  "Device connector": "设备连接器",
  Integrations: "集成",
  "Tool reference": "工具参考",
  "{count} tools": "{count} 个工具",
  "{count} built-in tools": "{count} 个内置工具",
  Security: "安全",
  "Self-hosting": "自托管",
  Troubleshooting: "故障排查",
  "Diagnose device presence, local scope, approvals and uncertain execution without weakening access.":
    "在不放宽权限的前提下，诊断设备在线状态、本地范围、审批和不确定执行结果。",
  Changelog: "更新日志",
  "On this page": "本页目录",
  Previous: "上一页",
  Next: "下一页",
  "Page not found": "页面不存在",
  "Return to documentation": "返回文档中心",
  "Connect your first device": "连接你的第一台设备",
  "Go from account creation to a first tool call without weakening the device's local boundary.":
    "从创建账户到完成第一次工具调用，同时保持设备本地权限边界。",
  "Before you begin": "开始之前",
  "Source development requires Node.js 22 or newer. Installed connectors include their own Node.js runtime.":
    "源码开发需要 Node.js 22 或更高版本；安装版连接器已自带 Node.js 运行时。",
  "The hosted preview requires an account and a supported macOS or glibc Linux device. Installed connectors include their own Node.js runtime; Node.js 22 is only required for source development.":
    "使用托管预览只需要一个账户和受支持的 macOS 或 glibc Linux 设备。安装版连接器已自带 Node.js 运行时；只有源码开发需要 Node.js 22。",
  "Create an account": "创建账户",
  "Open the console and sign in with email or GitHub.": "打开控制台，通过邮箱或 GitHub 登录。",
  "Open the console and use one of the sign-in methods enabled by this deployment.":
    "打开控制台，并使用当前部署已启用的登录方式。",
  "Open Devices, create a pairing code, and run the generated command on macOS or glibc Linux.":
    "打开「设备」，生成配对码，然后在 macOS 或 glibc Linux 上运行生成的命令。",
  "Choose devices, folders, tools and an approval policy. Projects are optional.":
    "选择设备、目录、工具和审批策略；项目不是必选项。",
  "Connect a client": "连接客户端",
  "Use OAuth MCP when available, or create an expiring Agent token for CLI and SDK access.":
    "优先使用 OAuth MCP，也可以创建有有效期的 Agent Token，供 CLI 和 SDK 使用。",
  "Use OAuth MCP when available, or run adc connect after signing in to the CLI.":
    "优先使用 OAuth MCP；使用 CLI 时，登录后运行 adc connect 即可。",
  "Verify access": "验证访问",
  "Start with device.list or file.list, then inspect Activity for the policy decision and receipt.":
    "先调用 device.list 或 file.list，再到「活动记录」检查策略决策和回执。",
  "How authorization works": "授权如何生效",
  "Every operation is limited by the intersection of local device scope, device policy, Agent authorization and approval policy.":
    "每次操作都受设备本地范围、设备策略、Agent 授权和审批策略的共同限制。",
  "Local device scope": "设备本地范围",
  "The device owner exposes no folders, selected folders, the home directory or the full filesystem.":
    "设备所有者可选择不开放目录、开放指定目录、用户主目录或完整文件系统。",
  "Cloud device policy": "云端设备策略",
  "Account owners can narrow folders, make them read-only and disable execution for every Agent.":
    "账户所有者可进一步缩小目录范围、设为只读，或对所有 Agent 禁用执行。",
  "An Agent grant selects devices, folders and tools. Existing tokens always use the latest saved grant.":
    "Agent 授权选择设备、目录和工具；现有 Token 始终使用最新保存的授权。",
  "Agent access selects devices, folders and tools. Existing connections always use the latest saved settings.":
    "Agent 访问权限选择设备、目录和工具；现有连接始终使用最新保存的设置。",
  "Approvals are independent from capability. They can apply to writes, execution or every device operation.":
    "审批与能力授权相互独立，可作用于写入、执行或每一次设备操作。",
  "Projects are optional groups for legacy or multi-device workflows; they are not a security boundary.":
    "项目用于组织旧流程或多设备工作流，不构成独立安全边界。",
  "Install and pair": "安装与配对",
  "The installer verifies a platform archive, preserves existing identity during upgrades and starts a user service.":
    "安装器会校验平台安装包，在升级时保留现有身份，并启动用户级后台服务。",
  "Access modes": "访问模式",
  "No access exposes no folders.": "不开放访问时不会暴露任何目录。",
  "Selected folders exposes only explicitly added paths.": "指定目录模式只开放明确添加的路径。",
  "Home directory exposes the connector user's home.": "用户主目录模式开放连接器用户的主目录。",
  "Full device trust exposes the filesystem using the connector user's OS permissions.":
    "完全信任模式使用连接器用户的系统权限开放文件系统。",
  "Lifecycle commands": "生命周期命令",
  "Changes to access and folders reload automatically. Removing access cancels affected running work.":
    "访问模式和目录变更会自动加载；移除权限会取消受影响的运行任务。",
  "Connect an MCP client": "连接 MCP 客户端",
  "OAuth MCP clients use the server's /mcp endpoint and let the user choose an existing Agent authorization.":
    "OAuth MCP 客户端连接服务端的 /mcp 端点，并由用户选择已有的 Agent 授权。",
  "Each logical tool appears once. Its target list contains only authorized devices that advertise that tool, and device execution requires the Agent to select one of those targets.":
    "每个逻辑工具只出现一次；目标列表只包含已授权且声明该工具的设备，执行设备工具时 Agent 必须从中明确选择一台。",
  "Token-based MCP": "Token 模式 MCP",
  "Access-key MCP": "访问密钥模式 MCP",
  "Official Skill": "官方 Skill",
  "The official Skill orchestrates the same adc CLI and never reads device credentials.":
    "官方 Skill 调用同一套 adc CLI，且不会读取设备凭据。",
  "Tools use the same schemas and policy path across HTTP, CLI, MCP, SDK and Skill.":
    "HTTP、CLI、MCP、SDK 和 Skill 共用相同的工具 Schema 与策略链路。",
  "Read tools": "读取工具",
  "Write tools": "写入工具",
  "Execution tools": "执行工具",
  "Task tools": "任务工具",
  "MCP Provider tools": "MCP Provider 工具",
  "{provider} · {count} devices · High risk": "{provider} · {count} 台设备 · 高风险",
  "Unavailable on selected devices": "所选设备当前不可用",
  "Local MCP Providers": "本地 MCP Provider",
  "The Connector can discover tools from local stdio or Streamable HTTP MCP servers. Provider credentials remain in the local device configuration; registering a Provider does not grant Agent access.":
    "Connector 可以发现本机 stdio 或 Streamable HTTP MCP 服务提供的工具。Provider 凭据只保存在设备本地配置中；注册 Provider 不会自动授予 Agent 访问权限。",
  "Use the same Provider ID on multiple devices to aggregate an identical tool. Schema changes create a new tool ID, and every dynamic tool requires explicit authorization, a target device and an idempotency key.":
    "在多台设备上使用相同 Provider ID，可将契约一致的工具聚合为一个工具。Schema 变化会生成新的工具 ID；每个动态工具都需要显式授权、目标设备和幂等键。",
  "Devices may also register namespaced MCP Provider tools. Their original input schema is exposed to the Agent, they default to execution risk, and they appear only after explicit authorization.":
    "设备也可注册带命名空间的 MCP Provider 工具。原始输入 Schema 会暴露给 Agent；这些工具默认视为执行风险，并且只有显式授权后才会出现。",
  "Side-effecting calls require a stable idempotency key. Reuse it only for an exact retry.":
    "有副作用的调用必须提供稳定的幂等键，且只能在完全相同的重试中复用。",
  Purpose: "用途",
  Risk: "风险",
  "Discover devices and inspect their current capability.": "发现设备并查看其实时能力。",
  "List, read and search files inside authorized folders.": "在授权目录中列出、读取和搜索文件。",
  "Create, replace, edit or patch files atomically.": "以原子方式创建、替换、编辑或修补文件。",
  "Run shell commands or locally configured command templates and tests.":
    "运行 shell 命令，或执行本地配置的命令模板和测试。",
  "Inspect or cancel asynchronous work.": "查看或取消异步任务。",
  "Trust model": "信任模型",
  "Management sessions administer an account. Agent credentials can only use their bound authorization.":
    "管理会话用于管理账户；Agent 凭据只能使用它绑定的授权。",
  "Device requests are signed with a local Ed25519 key, timestamp and one-time nonce.":
    "设备请求使用本地 Ed25519 密钥、时间戳和一次性随机数签名。",
  "Filesystem operations validate canonical paths and symlink boundaries again on the device.":
    "文件系统操作会在设备端再次校验规范路径和符号链接边界。",
  "Important limitation": "重要限制",
  "Restricted process mode is a guardrail, not a sandbox. Full device trust disables command and protected-path filters.":
    "受限进程模式只是防护栏，并非沙箱。完全信任模式会关闭命令和受保护路径过滤。",
  "Credential storage": "凭据存储",
  "Device private keys currently use a mode-0600 file. Keychain and keyring support is not implemented.":
    "设备私钥目前保存在权限为 0600 的文件中，尚未接入 Keychain 或 keyring。",
  "Deploy with Docker Compose": "使用 Docker Compose 部署",
  "Production requires HTTPS, PostgreSQL, a stable auth secret and working SMTP when email verification is enabled.":
    "生产环境需要 HTTPS、PostgreSQL、稳定的认证密钥；启用邮箱验证时还需要可用的 SMTP。",
  "Required configuration": "必要配置",
  "HTTPS origin": "HTTPS 站点地址",
  "Stable secret, 32+ characters": "至少 32 个字符的稳定密钥",
  "PostgreSQL password": "PostgreSQL 密码",
  "Required when email verification is enabled": "启用邮箱验证时必须配置",
  Operations: "运维",
  "Back up PostgreSQL and the auth secret together. Check /health and authenticated /metrics after upgrades.":
    "应同时备份 PostgreSQL 和认证密钥；升级后检查 /health 与需登录访问的 /metrics。",
  "Device is offline": "设备离线",
  "Check adc-node status and adc-node logs, then restart the user service.":
    "检查 adc-node status 和 adc-node logs，然后重启用户级服务。",
  "No folders are visible": "看不到目录",
  "Run adc-node roots list and add a folder or select home/full access locally.":
    "运行 adc-node roots list，并在本地添加目录或切换为 home/full 访问。",
  "Approval is waiting": "审批仍在等待",
  "Open Approvals before the request expires. A changed or revoked grant cannot be approved.":
    "请在请求过期前打开「审批」处理；已变更或撤销的授权不能继续批准。",
  "Unknown outcome": "结果未知",
  "Do not retry with a new idempotency key until audit and local effects have been reconciled.":
    "在核对审计记录和本地副作用前，不要使用新的幂等键重试。",
  "Tool is denied": "工具调用被拒绝",
  "Check the Agent tool list, device policy, writable folder and local access mode.":
    "检查 Agent 工具列表、设备策略、目录写权限和本地访问模式。",
  "Version 0.1.0": "版本 0.1.0",
  "Initial pre-release": "首个预发布版本",
  "Account isolation, device pairing, direct grants, approvals, receipts, MCP OAuth, CLI, Skill and installable connectors.":
    "提供账户隔离、设备配对、直接授权、审批、回执、MCP OAuth、CLI、Skill 和可安装连接器。",
  "Known limits": "已知限制",
  "Windows, hard process isolation, signed packages, automatic updates, quotas and external artifact storage are not available yet.":
    "暂不支持 Windows、进程硬隔离、签名安装包、自动更新、配额和外部产物存储。",
  "Release notes describe behavior changes and required operator actions before upgrading.":
    "升级前请阅读发布说明，确认行为变化和必要的运维操作。",
  "How it works": "如何使用",
  Connect: "接入",
  "Open console": "打开控制台",
  "One connection. More possibilities.": "一次连接，更多可能。",
  "Work where your work lives.": "让 Agent 在你的工作现场工作。",
  "Your laptop, a home server, a remote machine. Give your agent a way to work with the tools and files already there.":
    "笔记本、家庭服务器或远程主机。让 Agent 使用设备上已有的工具和文件，接着你的工作继续。",
  "Access that fits.": "权限，恰到好处。",
  "Choose a few folders, your home directory, or full device trust. Decide separately what an agent can do and when to ask you.":
    "选择几个目录、用户主目录，或完全信任设备。再单独决定 Agent 能做什么，以及什么时候需要你的审批。",
  "A record you can follow.": "每次操作，都有迹可循。",
  "See approvals and execution history in one place. Revoke an agent or disconnect a device whenever you need.":
    "在同一处查看审批和执行记录。随时撤销 Agent 授权，或断开设备连接。",
  "From your device to your agent.": "从你的设备，到你的 Agent。",
  "Pair your device": "配对设备",
  "Sign in, create a pairing code, and run one install command. macOS and Linux are supported; Node.js is included.":
    "登录后生成配对码，运行一条安装命令。支持 macOS 和 Linux，安装包自带 Node.js。",
  "Choose your access": "选择访问范围",
  "Choose folders locally, or decide later. The website uses the folders you already exposed. No repeated paths.":
    "在本地选择目录，也可以稍后设置。网站直接使用设备已开放的目录，无需重复填写路径。",
  "Use your favorite agent": "接入常用 Agent",
  "Authorize a device, choose capabilities and approvals, then connect using MCP, CLI or a Skill. Projects are optional.":
    "为 Agent 选择设备、操作能力和审批策略，通过 MCP、CLI 或 Skill 接入。项目按需使用。",
  "Fits the way you build.": "融入你的工作方式。",
  "One authorization across MCP, CLI and Skills.": "MCP、CLI 和 Skill，共用一份授权。",
  "MCP description":
    "将此地址添加到支持 OAuth 的 MCP 客户端。登录后选择授权；也可以使用 Agent Token 连接。",
  "CLI description": "在终端登录后直接调用。单设备授权自动选择设备，多设备时指定目标。",
  "Skill description":
    "让 Agent 加载官方 Skill，使用 CLI 发现设备、读取文件和运行任务，沿用相同的权限与执行记录。",
  "Ready when you are.": "随时，开始连接。",
  "Give your agent a place to do real work.": "让 Agent 在你的设备上，完成真实的工作。",
  "Private devices. Shared possibilities.": "私有设备，无限可能。",
  Illustration: "连接示意",
  "AI agent": "AI Agent",
  "Your device": "你的设备",
  "Your files & tools": "你的文件与工具",
  "Your access rules": "你的访问规则",
  "Back to home": "返回首页",
  Overview: "总览",
  "Everything connected at a glance.": "连接状态，一目了然。",
  "Follow setup progress, review pending decisions and see recent account activity.":
    "查看接入进度、待处理审批与近期账户活动。",
  "Connected devices": "已连接设备",
  "Online now": "当前在线",
  "Active agents": "有效 Agent",
  "Pending approvals": "待处理审批",
  "Client connections": "客户端连接",
  "Setup progress": "接入进度",
  "Device connected": "设备已连接",
  "Pair and configure a device.": "配对并配置一台设备。",
  "Agent authorized": "Agent 已授权",
  "Define an agent's devices and capabilities.": "配置 Agent 可使用的设备和能力。",
  "Client connected": "客户端已连接",
  "Create a token or connect an MCP client.": "创建 Token 或连接 MCP 客户端。",
  "Connect the CLI or an MCP client.": "连接 CLI 或 MCP 客户端。",
  Complete: "已完成",
  "Review approvals": "查看审批",
  "Recent activity": "近期活动",
  "No recent activity.": "暂无近期活动。",
  "Review all activity": "查看全部活动",
  "Attention needed": "需要关注",
  "{count} devices are offline.": "{count} 台设备当前离线。",
  "All connected devices are online.": "所有已连接设备均在线。",
  Language: "语言",
  Devices: "设备",
  Projects: "项目",
  Agents: "Agent",
  Approvals: "审批",
  Activity: "活动记录",
  Account: "账户",
  Refresh: "刷新",
  Dismiss: "关闭",
  Retry: "重试",
  "Loading your account…": "正在加载账户…",
  "Loading…": "正在加载…",
  "Sign in": "登录",
  "Sign out": "退出登录",
  "Create account": "创建账户",
  "Welcome back": "欢迎回来",
  "Create your account": "创建你的账户",
  "Reset your password": "重置密码",
  "Choose a new password": "设置新密码",
  "Your devices, connected to your agents.": "将你的设备，连接到你的 Agent。",
  "Continue with GitHub": "使用 GitHub 继续",
  "Connecting to GitHub…": "正在连接 GitHub…",
  "Connect GitHub": "关联 GitHub",
  "GitHub connected": "已关联 GitHub",
  "or use email": "或使用邮箱",
  "Continue as {name}": "以 {name} 的身份继续",
  Name: "名称",
  Email: "邮箱",
  Password: "密码",
  "Use at least 12 characters.": "请使用至少 12 个字符。",
  "Please wait…": "请稍候…",
  "Send reset link": "发送重置链接",
  "Save password": "保存密码",
  "Resend verification email": "重新发送验证邮件",
  "Forgot password?": "忘记密码？",
  "If this address has an account, a password reset link is on its way.":
    "如果此邮箱已注册，密码重置链接将发送到你的邮箱。",
  "This reset link is missing its token. Request a new link.": "重置链接不完整，请重新申请。",
  "Your password has been reset. Sign in with your new password.": "密码已重置，请使用新密码登录。",
  "Check your email to verify your address and finish signing in.":
    "请查看邮箱，验证邮箱地址后完成登录。",
  "Verification email requested. Check your inbox.": "已申请发送验证邮件，请查看收件箱。",
  "This link is invalid or expired. Please try again.": "此链接无效或已过期，请重试。",
  "GitHub sign-in could not finish. Verify your GitHub email and try again. Existing email accounts can link GitHub from Account.":
    "GitHub 登录未完成。请确认 GitHub 邮箱已验证后重试；已有邮箱账户可先登录，再前往「账户」关联 GitHub。",
  "This option is disabled on this installation.": "此站点暂未开放这项功能。",
  Profile: "个人资料",
  "Save changes": "保存更改",
  "Current password": "当前密码",
  "New password": "新密码",
  "Change password": "修改密码",
  "Password changed. Other sessions were signed out.": "密码已修改，其他登录会话已退出。",
  "Profile updated.": "个人资料已更新。",
  "Sign-in methods": "登录方式",
  "You sign in with GitHub.": "你正在使用 GitHub 登录。",
  "Use password reset to add an email password.": "可通过重置密码，为邮箱设置登录密码。",
  "Signed-in sessions": "登录会话",
  "This session": "当前会话",
  "Other session": "其他会话",
  "Command line": "命令行",
  "Active {date}": "最近活跃 {date}",
  Current: "当前",
  "Pair a device": "配对设备",
  "Pair device": "配对设备",
  "Connect this device": "连接这台设备",
  "Expires {date}": "到期时间 {date}",
  Close: "关闭",
  "Run this command in a terminal on your Mac or Linux device. Choose access during setup, or leave folders for later.":
    "在 Mac 或 Linux 设备的终端运行此命令。安装时可选择访问范围，也可以稍后再设置目录。",
  "Installs the connector and starts it in the background. Your device will appear below automatically.":
    "安装连接器并在后台启动，设备会自动出现在下方。",
  "Device downloads are not available yet. Contact the installation administrator.":
    "设备安装包暂不可用，请联系站点管理员。",
  "Could not copy. Select and copy the command above.": "复制失败，请手动选择并复制上方命令。",
  "Code expired": "配对码已过期",
  Copied: "已复制",
  "Copy command": "复制命令",
  Device: "设备",
  Status: "状态",
  Platform: "平台",
  Capabilities: "操作能力",
  "Custom capabilities": "自定义能力",
  "New account registration is disabled. Existing users can still sign in.":
    "此站点已关闭新账户注册，已有用户仍可登录。",
  "Last seen": "最近在线",
  Actions: "操作",
  Never: "尚未连接",
  "Revoke device": "撤销设备",
  "Revoke this device? Its agents will lose access.": "撤销这台设备？Agent 将无法再访问它。",
  "No devices": "还没有连接设备",
  "Pair a device to bring its tools and files to your agents.":
    "配对一台设备，让 Agent 使用其中的工具与文件。",
  "Device access": "设备访问范围",
  "Folders are managed on the device and update here automatically.":
    "目录在设备本地管理，更改后会自动同步到这里。",
  "Manage local access": "管理本地访问范围",
  "Run on the device. Changes take effect without restarting the connector.":
    "在设备上运行，更改后无需重启连接器。",
  "No folders exposed yet": "尚未开放目录",
  "Selected folders": "指定目录",
  "Home directory": "用户主目录",
  "Full device trust": "完全信任设备",
  "No access": "尚未开放访问",
  "Full trust uses the connector user's OS permissions, without ADC command or protected-file filters.":
    "完全信任模式使用连接器运行用户的系统权限，不启用 ADC 的命令与受保护文件过滤。",
  "Projects & folders": "项目与目录",
  "Optional groups for existing workflows. Authorize devices directly from Agent access.":
    "项目用于按需组织工作流。你也可以直接在 Agent 授权中选择设备。",
  "New project": "新建项目",
  "Project name": "项目名称",
  Create: "创建",
  Cancel: "取消",
  Add: "添加",
  "Add authorized root": "添加已开放目录",
  "Device folder": "设备目录",
  "Advertised device folder": "设备已开放的目录",
  "Folder label": "目录名称",
  Writable: "可写",
  Write: "可写",
  Read: "只读",
  Execute: "执行",
  Varies: "视操作而定",
  "No projects": "暂无项目",
  Requested: "申请时间",
  Tool: "工具",
  Agent: "Agent",
  Path: "路径",
  "Requested arguments": "请求参数",
  Approve: "批准",
  Deny: "拒绝",
  "No approvals": "暂无审批",
  Time: "时间",
  Event: "事件",
  Invocation: "调用",
  "Decision / Status": "决策 / 状态",
  "No activity yet": "暂无活动记录",
  "Agent access": "Agent 授权",
  "Authorize agent": "授权 Agent",
  "Choose devices, capabilities and approvals. Use the same access through MCP, CLI, Skills or SDK.":
    "选择设备、操作能力与审批策略。通过 MCP、CLI、Skill 或 SDK 使用同一份授权。",
  "Revoke this access? Existing connections using it will stop working.":
    "撤销此授权？使用它的现有连接将停止工作。",
  "Connect CLI": "连接 CLI",
  "Sign in once in your terminal, then connect this access without copying a token.":
    "在终端登录一次，然后直接连接这份访问权限，无需复制 Token。",
  "Copy your access key": "复制访问密钥",
  "Dismiss access key": "关闭访问密钥",
  "This access key is shown once. Store it with your application's secrets.":
    "访问密钥仅展示一次，请保存在应用的密钥配置中。",
  "Copy access key": "复制访问密钥",
  "Copy failed. Select and copy the access key manually.": "复制失败，请手动选择并复制访问密钥。",
  "Paste the access key when prompted.": "按提示粘贴访问密钥。",
  "Advanced access keys": "高级访问密钥",
  "Access keys are only needed for SDKs and clients that cannot use OAuth or adc connect.":
    "访问密钥仅用于无法使用 OAuth 或 adc connect 的 SDK 和客户端。",
  "SDK integration": "SDK 集成",
  "Create access key": "创建访问密钥",
  "No access keys created": "尚未创建访问密钥",
  "Copy your token": "复制你的 Token",
  "Dismiss token": "关闭 Token",
  "This token is shown once. Store it with your agent's secrets.":
    "Token 仅展示一次，请妥善保存在 Agent 的凭据配置中。",
  "Copy token": "复制 Token",
  "Copy failed. Select and copy the token manually.": "复制失败，请手动选择并复制 Token。",
  "Paste the token when prompted.": "按提示粘贴 Token。",
  "Tool permissions": "工具权限",
  "Create token": "创建 Token",
  Revoke: "撤销",
  "No agents authorized yet": "尚未授权 Agent",
  "Create agent token": "创建 Agent Token",
  "My coding agent": "我的编程 Agent",
  "Expires in": "有效期",
  "{days} days": "{days} 天",
  "1 year": "1 年",
  Tokens: "Token",
  "Last used {date}": "最近使用 {date}",
  "Never used": "尚未使用",
  "No tokens created": "尚未创建 Token",
  "MCP connections": "MCP 连接",
  "Add this URL in an MCP client that supports OAuth, then sign in and choose an authorization.":
    "在支持 OAuth 的 MCP 客户端中添加此地址，登录并选择授权即可。",
  "For clients using a token, add this MCP configuration.":
    "使用 Token 的客户端，可添加以下 MCP 配置。",
  "For clients using an access key, add this MCP configuration.":
    "使用访问密钥的客户端，可添加以下 MCP 配置。",
  Disconnect: "断开连接",
  "Agent name": "Agent 名称",
  "Coding assistant": "编程助手",
  "Project (optional)": "项目（可选）",
  "Direct device access": "直接访问设备",
  "Read only": "只读",
  "Read & write": "读写",
  "Read, write & run": "读写与执行",
  "Approved templates only": "仅预设命令",
  "Approval policy": "审批策略",
  "No approval": "无需审批",
  "Before changes or execution": "修改或执行前审批",
  "Before execution": "执行前审批",
  "Every device operation": "每次设备操作均审批",
  "Legacy policy": "原有审批策略",
  "Commands run with the connector user's OS permissions. Choose execution for agents you trust.":
    "命令以连接器用户的系统权限运行。请为你信任的 Agent 开放执行能力。",
  Folders: "目录",
  "All exposed folders": "设备开放的全部目录",
  "Includes folders you expose later on these devices. Local access remains the upper limit.":
    "包含以后在这些设备上开放的目录。实际访问始终以设备本地开放范围为上限。",
  "Choose folders": "选择目录",
  "Select devices to see their exposed folders.": "选择设备后，可看到设备已开放的目录。",
  "Choose one or more devices.": "请选择至少一台设备。",
  "Choose at least one folder.": "请选择至少一个目录。",
  "No tools": "未授权工具",
  None: "无",
  "{count} devices": "{count} 台设备",
  "{count} folders": "{count} 个目录",
  "Connect {name}": "连接 {name}",
  "Choose the access this application will receive. You can disconnect it at any time.":
    "选择此应用可获得的访问权限。你可以随时断开连接。",
  "Agent authorization": "Agent 授权",
  "Choose an authorization": "选择一份授权",
  "This authorization permits running commands on the selected devices.":
    "此授权允许在所选设备上运行命令。",
  "Authorize an agent": "授权一个 Agent",
  "in a new tab, then reload this page.": "请在新标签页完成，然后刷新此页。",
  "Allow access": "允许访问",
  "Application ID": "应用 ID",
  online: "在线",
  offline: "离线",
  active: "有效",
  revoked: "已撤销",
  Revoked: "已撤销",
  Expired: "已过期",
  expired: "已过期",
  pending: "待审批",
  approved: "已批准",
  denied: "已拒绝",
  succeeded: "已完成",
  failed: "失败",
  queued: "排队中",
  running: "运行中",
  cancelled: "已取消",
  "Request failed. Please try again.": "请求失败，请重试。",
  "Invalid email or password": "邮箱或密码不正确",
  "Email not verified": "邮箱尚未验证",
  "User already exists. Use another email.": "此邮箱已注册，请直接登录。",
  "Too many requests. Please try again later.": "请求过于频繁，请稍后重试。"
} as const;

export type Message = keyof typeof zh;
export type Locale = "zh-CN" | "en";
export const catalogs: Record<Locale, Record<Message, string>> = {
  "zh-CN": zh,
  en: {
    ...(Object.fromEntries(Object.keys(zh).map((key) => [key, key])) as Record<Message, string>),
    "MCP description":
      "Add this URL to an MCP client with OAuth support. Sign in and choose an authorization, or connect with an Agent token.",
    "CLI description":
      "Sign in from your terminal and call tools directly. A single authorized device is selected automatically; specify a target for multiple devices.",
    "Skill description":
      "Load the official Skill so your agent can discover devices, read files and run tasks through the CLI, with the same permissions and receipts."
  }
};
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem("adc.locale");
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {
    /* Storage is optional in private contexts. */
  }
  return typeof navigator !== "undefined" && navigator.language.startsWith("zh") ? "zh-CN" : "en";
}
let activeLocale = initialLocale();
export function translate(
  key: Message,
  values: Record<string, string | number> = {},
  locale = activeLocale
) {
  return catalogs[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    String(values[name] ?? match)
  );
}
export function translateError(message: string) {
  return message in zh ? translate(message as Message) : message;
}
const LocaleContext = createContext({
  locale: activeLocale,
  setLocale: (locale: Locale) => {
    void locale;
  }
});
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(activeLocale);
  activeLocale = locale;
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === "zh-CN"
        ? "Agent Device Cloud · AI Agent 私有设备基础设施"
        : "Agent Device Cloud · Private device infrastructure for AI agents";
    try {
      localStorage.setItem("adc.locale", locale);
    } catch {
      /* Keep in-memory preference. */
    }
  }, [locale]);
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}
export function useI18n() {
  const { locale } = useContext(LocaleContext);
  return {
    t: (key: Message, values?: Record<string, string | number>) => translate(key, values, locale),
    term: (value: string) => (value in zh ? translate(value as Message, {}, locale) : value),
    date: (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value)
      )
  };
}
export function LanguageSelector() {
  const { locale, setLocale } = useContext(LocaleContext);
  const { t } = useI18n();
  return (
    <label className="language-selector">
      <Languages size={16} aria-hidden="true" />
      <select
        aria-label={t("Language")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
