# Tool Invocation

Load this reference before the first ADC tool call in a workflow.

## Discover The Live Contract

Always discover from the current Agent connection:

```bash
adc node list --json
adc tool list --json
adc tool show file.read --json
```

`adc node list` supplies the authorized devices, online state, exposed absolute paths and current
capabilities. `adc tool list` omits device tools that no authorized device currently advertises.

In `adc tool show` output:

- `inputSchema.properties.args` is the JSON passed to `--args`.
- `inputSchema.properties.target.properties.nodeId.enum` lists valid `--node` values.
- `inputSchema.required` shows whether a target and idempotency key are required.

Use the advertised schema for dynamic `mcp.*` tools. Never infer their arguments from the source
tool name. Dynamic MCP tools are side effects in protocol 0.1 and require an explicit node and
idempotency key.

## Built-In Tool Arguments

The live schema is authoritative. These examples show the protocol 0.1 shapes:

| Tool                    | `--args` JSON                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `device.list`           | `{}`                                                                                          |
| `device.status`         | `{"nodeId":"node_example"}`                                                                   |
| `device.battery.get`    | `{}`                                                                                          |
| `device.network.get`    | `{}`                                                                                          |
| `location.get`          | `{"desiredAccuracy":"balanced","maxAgeMs":15000,"timeoutMs":10000}`                           |
| `notification.show`     | `{"title":"ADC","body":"Task completed"}`                                                     |
| `file.list`             | `{"path":"/absolute/folder","glob":"**/*.ts","maxEntries":1000}`                              |
| `file.read`             | `{"path":"/absolute/file","encoding":"utf8","maxBytes":1048576}`                              |
| `file.search`           | `{"path":"/absolute/folder","query":"needle","glob":"**/*.ts","maxMatches":1000}`             |
| `file.write`            | `{"path":"/absolute/file","content":"...","createOnly":true}`                                 |
| `file.edit`             | `{"path":"/absolute/file","oldText":"exact text","newText":"replacement","replaceAll":false}` |
| `file.patch`            | `{"path":"/absolute/file","patch":"unified diff"}`                                            |
| `shell.exec`            | `{"cwd":"/absolute/folder","command":"pnpm test","timeoutMs":120000,"env":{}}`                |
| `command.template.list` | `{}` or `{"projectId":"proj_example"}`                                                        |
| `command.template.run`  | `{"cwd":"/absolute/folder","templateId":"build","parameters":{}}`                             |
| `test.run`              | `{"cwd":"/absolute/folder","templateId":"test","timeoutMs":300000}`                           |
| `task.status`           | `{"jobId":"job_example"}`                                                                     |
| `task.result`           | `{"jobId":"job_example"}`                                                                     |
| `task.cancel`           | `{"jobId":"job_example"}`                                                                     |

Optional fields may be omitted. Do not send undocumented fields because tool arguments are strict.
Use `--args @/absolute/input.json` when shell quoting would make a large JSON value unsafe or
ambiguous, and remove temporary inputs that contain sensitive data.

## Read Before Mutation

List or search before reading:

```bash
adc invoke file.list \
  --node node_example \
  --args '{"path":"/Users/example/work/project","maxEntries":200}' \
  --source skill \
  --json
```

Read the exact file before an edit. Use:

- `file.write` to create a file or replace its complete contents.
- `file.edit` only when `oldText` is known and uniquely identifies the intended text.
- `file.patch` for a reviewed unified diff.
- `command.template.run` or `test.run` for a configured command.
- `shell.exec` only when no narrower tool expresses the operation.

Discover templates before use:

```bash
adc invoke command.template.list \
  --node node_example \
  --args '{}' \
  --source skill \
  --json
```

## Idempotency

Every write, execution, cancellation and dynamic MCP call needs a key:

```bash
adc invoke file.edit \
  --node node_example \
  --args '{"path":"/Users/example/work/project/README.md","oldText":"old","newText":"new"}' \
  --idempotency-key workflow-42-edit-readme-1 \
  --source skill \
  --json
```

Keep the key in task state before invoking. A retry of identical intent, tool, node and arguments
uses the same key. Any changed argument or distinct side effect uses a new key. Never use one global
key for multiple operations.

## Invocation Lifecycle

For `queued` or `running`, save the `jobId` and poll:

```bash
adc task status JOB_ID --json
```

Poll after 2 seconds, then 5 seconds, then at most every 10 seconds. Stop at the user-visible or
tool timeout. If local waiting stops, retain the `jobId`; do not submit the operation again.

For `approval_required`, save `invocationId`, `error.details.approvalId`, and
`error.details.expiresAt`. Ask the user to decide independently. After the user confirms:

```bash
adc invocation status INVOCATION_ID --json
```

- Another `approval_required` means the decision is still pending.
- `denied` with error code `denied` or `expired` is terminal.
- `queued` or `running` supplies the `jobId`; continue task polling.
- A terminal result can be reported directly.

Do not re-run the original invocation merely to discover the approval result.

## Results And Artifacts

Treat only `succeeded` as success. Report `failed`, `denied`, `offline`, `cancelled`, and
`unknown_outcome` distinctly. Preserve `error.code`, `error.message`, `invocationId`, `jobId`, and
`receipt.receiptId` in the final summary when present.

If `output.truncated` is true and `receipt.artifactRefs` contains an ID, download only when the
content is needed:

```bash
adc artifact get ARTIFACT_ID --output /user/approved/new/path.log --json
```

The output path is local to the Agent host and is overwritten by the CLI. Confirm that it is an
appropriate new or disposable path first.

`adc audit show INVOCATION_ID --json` requires an owner login. It is optional verification for a
user-authorized management session, not part of the normal scoped Agent workflow.
