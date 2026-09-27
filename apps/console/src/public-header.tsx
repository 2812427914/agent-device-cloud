import { ArrowRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Brand } from "./auth-ui.tsx";
import { LanguageSelector, useI18n } from "./i18n.tsx";

const navigation = [
  { label: "Product", path: "/" },
  { label: "Docs", path: "/docs" }
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
          const active = item.path === "/docs" ? pathname.startsWith("/docs") : pathname === "/";
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
        <LanguageSelector />
        <Link className="secondary" to={start}>
          {t(signedIn ? "Open console" : "Sign in")}
          <ArrowRight size={16} />
        </Link>
      </div>
    </header>
  );
}
