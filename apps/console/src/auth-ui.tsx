import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Cable, Github } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { LanguageSelector, translateError, useI18n, type Message } from "./i18n.tsx";

export type Request = (path: string, init?: RequestInit) => Promise<any>;
export interface User {
  id: string;
  name: string;
  email: string;
}
interface AuthConfig {
  registrationEnabled: boolean;
  passwordResetEnabled: boolean;
  requireEmailVerification: boolean;
  githubEnabled: boolean;
}
export async function apiRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      translateError(
        body.error?.message ?? body.message ?? body.error_description ?? `HTTP ${response.status}`
      )
    );
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body;
}
export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Agent Device Cloud">
      <Cable size={25} strokeWidth={1.5} aria-hidden="true" />
      <span>Agent Device Cloud</span>
    </Link>
  );
}
export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="auth-layout">
      <header className="public-header">
        <Brand />
        <LanguageSelector />
      </header>
      <main className={`login ${wide ? "consent" : ""}`}>{children}</main>
      <footer className="auth-footer">Agent Device Cloud</footer>
    </div>
  );
}
export function AuthPage({
  onLogin,
  currentUser
}: {
  onLogin: () => Promise<void>;
  currentUser: User | null;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const oauth = params.has("client_id") && params.has("sig");
  const oauthSearch = oauth
    ? `?${location.search
        .slice(1)
        .split("&")
        .filter((part) => !/^(error|error_description)=/.test(part))
        .join("&")}`
    : "";
  const mode =
    location.pathname === "/register"
      ? "register"
      : location.pathname === "/forgot-password"
        ? "forgot"
        : location.pathname === "/reset-password"
          ? "reset"
          : "login";
  const [config, setConfig] = useState<AuthConfig>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Message>();
  const [busy, setBusy] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  useEffect(() => {
    apiRequest("/api/v1/auth/config")
      .then(setConfig)
      .catch((error) => setError(error.message));
  }, []);
  useEffect(() => {
    setError("");
    setNotice(undefined);
    setVerificationEmail("");
  }, [location.pathname]);
  const callbackURL = `${window.location.origin}${oauth ? `/login${oauthSearch}` : "/app"}`;
  const continueOAuth = async (created = false) => {
    const result = await apiRequest("/api/auth/oauth2/continue", {
      method: "POST",
      body: JSON.stringify({
        oauth_query: oauthSearch.slice(1),
        postLogin: true,
        ...(created ? { created } : {})
      })
    });
    window.location.assign(result.url);
  };
  const action = async (run: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const social = () =>
    action(async () => {
      const result = await apiRequest("/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({
          provider: "github",
          callbackURL,
          newUserCallbackURL: callbackURL,
          errorCallbackURL: `${window.location.origin}/login${oauthSearch}`,
          disableRedirect: true
        })
      });
      window.location.assign(result.url);
    });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    setNotice(undefined);
    await action(async () => {
      if (mode === "forgot") {
        await apiRequest("/api/auth/request-password-reset", {
          method: "POST",
          body: JSON.stringify({ email, redirectTo: `${window.location.origin}/reset-password` })
        });
        setNotice("If this address has an account, a password reset link is on its way.");
      } else if (mode === "reset") {
        if (!params.get("token"))
          throw new Error(t("This reset link is missing its token. Request a new link."));
        await apiRequest("/api/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ token: params.get("token"), newPassword: password })
        });
        setNotice("Your password has been reset. Sign in with your new password.");
      } else {
        try {
          await apiRequest(
            mode === "register" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email",
            {
              method: "POST",
              body: JSON.stringify({
                email,
                password,
                callbackURL,
                ...(mode === "register" ? { name: data.get("name") } : {})
              })
            }
          );
        } catch (error) {
          if (config?.requireEmailVerification && mode === "login") setVerificationEmail(email);
          throw error;
        }
        if (mode === "register" && config?.requireEmailVerification) {
          setVerificationEmail(email);
          setNotice("Check your email to verify your address and finish signing in.");
        } else if (oauth) await continueOAuth(mode === "register");
        else await onLogin();
      }
    });
  };
  const disabled =
    !config ||
    (mode === "register" && !config.registrationEnabled) ||
    (mode === "forgot" && !config.passwordResetEnabled);
  const title: Record<typeof mode, Message> = {
    login: "Welcome back",
    register: "Create your account",
    forgot: "Reset your password",
    reset: "Choose a new password"
  };
  const buttons: Record<typeof mode, Message> = {
    login: "Sign in",
    register: "Create account",
    forgot: "Send reset link",
    reset: "Save password"
  };
  return (
    <AuthLayout>
      <h1>{t(title[mode])}</h1>
      <p className="description">{t("Your devices, connected to your agents.")}</p>
      {params.has("error") ? (
        <p className="form-error" role="alert">
          {t(
            params.get("error") === "signup_disabled"
              ? "New account registration is disabled. Existing users can still sign in."
              : mode === "login"
                ? "GitHub sign-in could not finish. Verify your GitHub email and try again. Existing email accounts can link GitHub from Account."
                : "This link is invalid or expired. Please try again."
          )}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      ) : null}
      {config && disabled ? (
        <p className="description">{t("This option is disabled on this installation.")}</p>
      ) : null}
      {currentUser && oauth ? (
        <button className="primary" disabled={busy} onClick={() => action(() => continueOAuth())}>
          {t("Continue as {name}", { name: currentUser.name })}
        </button>
      ) : (
        <>
          {(mode === "login" || mode === "register") && config?.githubEnabled ? (
            <>
              <button
                className="secondary social-button"
                disabled={busy || disabled}
                onClick={social}
              >
                <Github size={18} />
                {t("Continue with GitHub")}
              </button>
              <div className="auth-divider">
                <span>{t("or use email")}</span>
              </div>
            </>
          ) : null}
          <form className="connection-form" onSubmit={submit}>
            {mode === "register" ? (
              <label>
                {t("Name")}
                <input name="name" autoComplete="name" maxLength={128} required />
              </label>
            ) : null}
            {mode !== "reset" ? (
              <label>
                {t("Email")}
                <input name="email" type="email" autoComplete="email" required />
              </label>
            ) : null}
            {mode !== "forgot" ? (
              <label>
                {t("Password")}
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                />
                {mode !== "login" ? (
                  <span className="hint">{t("Use at least 12 characters.")}</span>
                ) : null}
              </label>
            ) : null}
            <button className="primary" type="submit" disabled={busy || disabled}>
              {t(busy ? "Please wait…" : buttons[mode])}
            </button>
          </form>
        </>
      )}
      {verificationEmail ? (
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            action(async () => {
              await apiRequest("/api/auth/send-verification-email", {
                method: "POST",
                body: JSON.stringify({ email: verificationEmail, callbackURL })
              });
              setNotice("Verification email requested. Check your inbox.");
            })
          }
        >
          {t("Resend verification email")}
        </button>
      ) : null}
      <div className="auth-links">
        {mode !== "login" ? <Link to={`/login${oauthSearch}`}>{t("Sign in")}</Link> : null}
        {mode === "login" && config?.registrationEnabled ? (
          <Link to={`/register${oauthSearch}`}>{t("Create account")}</Link>
        ) : null}
        {mode === "login" && config?.passwordResetEnabled ? (
          <Link to="/forgot-password">{t("Forgot password?")}</Link>
        ) : null}
      </div>
    </AuthLayout>
  );
}

export function AccountSettings({
  user,
  request,
  onUpdate,
  onLogout
}: {
  user: User;
  request: Request;
  onUpdate: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const { t, date } = useI18n();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Message>();
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<AuthConfig>();
  const [accounts, setAccounts] = useState<{ providerId: string }[]>([]);
  const [sessions, setSessions] = useState<
    { token: string; userAgent?: string; updatedAt: string; expiresAt: string }[]
  >([]);
  const [currentToken, setCurrentToken] = useState("");
  const load = async () => {
    const [all, current, providers, settings] = await Promise.all([
      request("/api/auth/list-sessions"),
      request("/api/auth/get-session"),
      request("/api/auth/list-accounts"),
      request("/api/v1/auth/config")
    ]);
    setSessions(all);
    setCurrentToken(current?.session?.token ?? "");
    setAccounts(providers);
    setConfig(settings);
  };
  useEffect(() => {
    void load().catch((error) => setError(error.message));
  }, [request]);
  const action = async (run: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice(undefined);
    try {
      await run();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const update = async (event: FormEvent<HTMLFormElement>, password: boolean) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await action(async () => {
      await request(password ? "/api/auth/change-password" : "/api/auth/update-user", {
        method: "POST",
        body: JSON.stringify(
          password
            ? {
                currentPassword: data.get("currentPassword"),
                newPassword: data.get("newPassword"),
                revokeOtherSessions: true
              }
            : { name: data.get("name") }
        )
      });
      if (password) form.reset();
      await onUpdate();
      await load();
      setNotice(
        password ? "Password changed. Other sessions were signed out." : "Profile updated."
      );
    });
  };
  return (
    <section className="page">
      <div className="page-header">
        <h1>{t("Account")}</h1>
        <button className="secondary" disabled={busy} onClick={() => action(onLogout)}>
          {t("Sign out")}
        </button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      ) : null}
      <div className="settings-grid">
        <form className="card connection-form" onSubmit={(event) => update(event, false)}>
          <h2>{t("Profile")}</h2>
          <label>
            {t("Name")}
            <input name="name" defaultValue={user.name} maxLength={128} required />
          </label>
          <label>
            {t("Email")}
            <input value={user.email} readOnly />
          </label>
          <button className="primary" disabled={busy}>
            {t("Save changes")}
          </button>
        </form>
        {accounts.some((account) => account.providerId === "credential") ? (
          <form className="card connection-form" onSubmit={(event) => update(event, true)}>
            <h2>{t("Password")}</h2>
            <label>
              {t("Current password")}
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              {t("New password")}
              <input
                name="newPassword"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {t("Change password")}
            </button>
          </form>
        ) : (
          <div className="card">
            <h2>{t("Password")}</h2>
            <p className="description">{t("You sign in with GitHub.")}</p>
            {config?.passwordResetEnabled ? (
              <Link to="/forgot-password">{t("Use password reset to add an email password.")}</Link>
            ) : null}
          </div>
        )}
      </div>
      {config?.githubEnabled ? (
        <div className="card">
          <h2>{t("Sign-in methods")}</h2>
          <p className="description">
            {accounts.some((account) => account.providerId === "github")
              ? t("GitHub connected")
              : null}
          </p>
          {!accounts.some((account) => account.providerId === "github") ? (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const result = await request("/api/auth/link-social", {
                    method: "POST",
                    body: JSON.stringify({
                      provider: "github",
                      callbackURL: `${window.location.origin}/app/settings`,
                      errorCallbackURL: `${window.location.origin}/login`,
                      disableRedirect: true
                    })
                  });
                  window.location.assign(result.url);
                })
              }
            >
              <Github size={16} />
              {t("Connect GitHub")}
            </button>
          ) : null}
        </div>
      ) : null}
      <h2>{t("Signed-in sessions")}</h2>
      <div className="resource-list">
        {sessions.map((session) => (
          <div className="resource-row" key={session.token}>
            <div>
              <strong>
                {t(session.token === currentToken ? "This session" : "Other session")}
              </strong>
              <p className="hint">
                {session.userAgent || t("Command line")} ·{" "}
                {t("Active {date}", { date: date(session.updatedAt) })}
              </p>
            </div>
            {session.token !== currentToken ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await request("/api/auth/revoke-session", {
                      method: "POST",
                      body: JSON.stringify({ token: session.token })
                    });
                    await load();
                  })
                }
              >
                {t("Sign out")}
              </button>
            ) : (
              <span className="state active">{t("Current")}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
