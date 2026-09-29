import { ArrowRight, Github } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Brand } from "./auth-ui.tsx";
import { LanguageSelector, useI18n } from "./i18n.tsx";

export const repositoryUrl = "https://github.com/zionforge/agent-device-cloud";

const navigation = [
  { label: "Product", path: "/" },
  { label: "Docs", path: "/docs" },
  { label: "Updates", path: "/updates" }
] as const;

export function PublicHeader({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const location = useLocation();
  const pathname =
    location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname;
  const start = signedIn ? "/app" : "/login";

  return (
    <header className="public-header">
      <Brand />
      <nav aria-label={t("Product")}>
        {navigation.map((item) => {
          const active =
            item.path === "/"
              ? pathname === "/"
              : item.path === "/updates"
                ? pathname.startsWith("/updates") ||
                  pathname.startsWith("/articles") ||
                  pathname.startsWith("/guides") ||
                  pathname.startsWith("/use-cases")
                : pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              className={active ? "active" : undefined}
              to={item.path}
              aria-current={active ? "page" : undefined}
            >
              {t(item.label)}
            </Link>
          );
        })}
      </nav>
      <div className="row-actions">
        <a
          className="icon-button public-github-link"
          href={repositoryUrl}
          target="_blank"
          rel="noreferrer"
          title={t("GitHub repository")}
          aria-label={t("GitHub repository")}
        >
          <Github size={18} />
        </a>
        <LanguageSelector />
        <Link className="secondary" to={start}>
          {t(signedIn ? "Open console" : "Sign in")}
          <ArrowRight size={16} />
        </Link>
      </div>
    </header>
  );
}

export function PublicFooter() {
  const { t, locale } = useI18n();
  return (
    <footer className="public-footer">
      <Brand />
      <nav aria-label={t("Documentation")}>
        <Link to="/docs">{t("Docs")}</Link>
        <Link to="/updates">{locale === "zh-CN" ? "动态" : "Updates"}</Link>
        <Link to="/docs/security">{t("Security")}</Link>
        <Link to="/privacy">{locale === "zh-CN" ? "隐私" : "Privacy"}</Link>
        <Link to="/telemetry">{locale === "zh-CN" ? "遥测策略" : "Telemetry"}</Link>
        <a href={repositoryUrl} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
      <LanguageSelector />
    </footer>
  );
}
