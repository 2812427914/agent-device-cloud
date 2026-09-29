import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { NodeRecord } from "./main.tsx";
import type { Request } from "./auth-ui.tsx";
import { useI18n } from "./i18n.tsx";
import { Dialog } from "./dialog.tsx";

export function DeviceSettings({
  node,
  request,
  onClose,
  onSaved,
  onRevoke
}: {
  node: NodeRecord;
  request: Request;
  onClose: () => void;
  onSaved: () => void;
  onRevoke: () => void;
}) {
  const { t } = useI18n();
  const [policy, setPolicy] = useState({
    rootAccess: "all" as "all" | "selected",
    rootIds: [] as string[],
    readOnlyRootIds: [] as string[],
    allowExecution: true,
    ...node.accessPolicy,
    maxConcurrency: node.accessPolicy?.maxConcurrency ?? 6
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [grants, setGrants] = useState<
    { grantId: string; name: string; nodeIds: string[]; revokedAt?: string }[]
  >([]);
  const [folder, setFolder] = useState(""),
    [copied, setCopied] = useState(false);
  const roots = node.capability?.roots ?? [];
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command = folder.trim()
    ? `adc-node roots add ${quote(folder.trim())}`
    : 'adc-node roots add "$HOME/Desktop" --label Desktop';
  useEffect(() => {
    let active = true;
    request("/api/v1/grants")
      .then((data) => {
        if (active)
          setGrants(
            data.grants.filter(
              (grant: (typeof grants)[number]) =>
                !grant.revokedAt && grant.nodeIds.includes(node.nodeId)
            )
          );
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [request, node.nodeId]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await request(`/api/v1/nodes/${node.nodeId}`, {
        method: "PATCH",
        body: JSON.stringify({
          revision: node.revision ?? 1,
          label: data.get("label"),
          accessPolicy: policy
        })
      });
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={t("Manage device")} onClose={onClose} busy={busy} wide>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <form className="device-settings-form" onSubmit={submit}>
        <label className="field">
          {t("Device name")}
          <input name="label" defaultValue={node.label} maxLength={128} required />
        </label>
        <fieldset>
          <legend>{t("Device access")}</legend>
          <p className="hint">
            {t(
              "These limits apply to every agent on this device. Local permissions remain the upper limit."
            )}
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={policy.rootAccess === "all"}
              onChange={(event) =>
                setPolicy((p) => ({
                  ...p,
                  rootAccess: event.target.checked ? "all" : "selected",
                  rootIds: event.target.checked ? [] : roots.map((root) => root.rootId)
                }))
              }
            />
            {t("Include all current and future exposed folders")}
          </label>
          <div className="managed-roots">
            {roots.map((root) => (
              <div className="managed-root" key={root.rootId}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={policy.rootAccess === "all" || policy.rootIds.includes(root.rootId)}
                    disabled={policy.rootAccess === "all"}
                    onChange={(event) =>
                      setPolicy((p) => ({
                        ...p,
                        rootIds: event.target.checked
                          ? [...p.rootIds, root.rootId]
                          : p.rootIds.filter((id) => id !== root.rootId)
                      }))
                    }
                  />
                  <span>
                    {root.label}
                    <code className="subtle">{root.path ?? root.rootId}</code>
                  </span>
                </label>
                <select
                  aria-label={`${t("Access")} · ${root.label}`}
                  disabled={policy.rootAccess !== "all" && !policy.rootIds.includes(root.rootId)}
                  value={
                    !root.writable || policy.readOnlyRootIds.includes(root.rootId)
                      ? "read"
                      : "write"
                  }
                  onChange={(event) =>
                    setPolicy((p) => ({
                      ...p,
                      readOnlyRootIds:
                        event.target.value === "read"
                          ? [...new Set([...p.readOnlyRootIds, root.rootId])]
                          : p.readOnlyRootIds.filter((id) => id !== root.rootId)
                    }))
                  }
                >
                  <option value="read">{t("Read only")}</option>
                  <option value="write" disabled={!root.writable}>
                    {t("Read & write")}
                  </option>
                </select>
              </div>
            ))}
          </div>
          {!roots.length ? <p className="hint">{t("No folders exposed yet")}</p> : null}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={policy.allowExecution}
              onChange={(event) =>
                setPolicy((p) => ({ ...p, allowExecution: event.target.checked }))
              }
            />
            {t("Allow commands and tests")}
          </label>
          <label className="field concurrency-field">
            {t("Concurrent task limit")}
            <input
              type="number"
              min={1}
              max={32}
              step={1}
              required
              value={policy.maxConcurrency}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isInteger(value))
                  setPolicy((current) => ({ ...current, maxConcurrency: value }));
              }}
            />
          </label>
        </fieldset>
        <div className="affected-agents">
          <strong>{t("Affected agents")}</strong>
          <p className="hint">
            {grants.length
              ? grants.map((grant) => grant.name).join(" · ")
              : t("No agents authorized yet")}
          </p>
          <Link to="/app/agents" onClick={onClose}>
            {t("Manage agent access")}
          </Link>
        </div>
        <p className="hint">
          {t(
            "New calls use saved limits immediately. Running tasks are checked again on their next lease renewal."
          )}
        </p>
        <div className="row-actions dialog-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </button>
          <button className="primary" disabled={busy}>
            {t(busy ? "Please wait…" : "Save changes")}
          </button>
        </div>
      </form>
      <details className="local-folder-setup">
        <summary>{t("Add or change local folders")}</summary>
        <p className="hint">
          {t(
            "Run the command on this device. The folder appears here automatically; no pairing is needed."
          )}
        </p>
        <label className="field">
          {t("Local folder path")}
          <input
            value={folder}
            placeholder="/path/to/folder"
            onChange={(event) => {
              setFolder(event.target.value);
              setCopied(false);
            }}
          />
        </label>
        <pre>
          <code>{command}</code>
        </pre>
        <button
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
            } catch {
              setError(t("Could not copy. Select and copy the command above."));
            }
          }}
        >
          {t(copied ? "Copied" : "Copy command")}
        </button>
        <p className="hint">
          {t(
            "To use your home folder or full device trust, run adc-node access home or adc-node access full locally."
          )}
        </p>
      </details>
      <div className="danger-zone">
        <div>
          <strong>{t("Revoke device")}</strong>
          <p className="hint">
            {t(
              "Revoke stops access and keeps the device listed. Delete also removes it from your device list."
            )}
          </p>
        </div>
        <button className="secondary danger" disabled={busy} onClick={onRevoke}>
          {t("Revoke")}
        </button>
      </div>
    </Dialog>
  );
}
