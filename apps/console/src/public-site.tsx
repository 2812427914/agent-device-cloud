import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clock3,
  History,
  Laptop,
  ShieldCheck
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useI18n, type Locale } from "./i18n.tsx";
import {
  listedPublicContent,
  localize,
  publicContentEntry,
  relatedPublicContent,
  type PublicContentEntry,
  type PublicContentKind
} from "./public-content.ts";
import { PublicFooter, PublicHeader } from "./public-header.tsx";

function kindLabel(kind: PublicContentKind, locale: Locale): string {
  if (locale === "en") return kind;
  return {
    "Product update": "产品动态",
    Engineering: "工程实践",
    Guide: "指南",
    "Use case": "使用场景",
    Policy: "政策"
  }[kind];
}

function kindIcon(kind: PublicContentKind) {
  if (kind === "Product update") return History;
  if (kind === "Use case") return Laptop;
  if (kind === "Policy") return ShieldCheck;
  return BookOpen;
}

function contentDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

function ContentRow({ entry }: { entry: PublicContentEntry }) {
  const { locale } = useI18n();
  const Icon = kindIcon(entry.kind);
  return (
    <Link className="content-row" to={entry.path}>
      <span className="content-row-icon">
        <Icon size={19} strokeWidth={1.5} />
      </span>
      <span className="content-row-copy">
        <span className="content-row-meta">
          {kindLabel(entry.kind, locale)}
          <i />
          <time dateTime={entry.publishedAt}>{contentDate(entry.publishedAt, locale)}</time>
        </span>
        <strong>{localize(entry.title, locale)}</strong>
        <small>{localize(entry.summary, locale)}</small>
      </span>
      <ArrowRight size={17} />
    </Link>
  );
}

export function LatestUpdates() {
  const { locale } = useI18n();
  return (
    <section className="landing-band latest-band" data-reveal>
      <div className="landing-band-inner latest-layout">
        <div className="latest-heading">
          <p className="eyebrow">{locale === "zh-CN" ? "最新内容" : "Latest"}</p>
          <h2>
            {locale === "zh-CN"
              ? "产品进展与工程实践。"
              : "Product progress and engineering notes."}
          </h2>
          <Link className="text-link" to="/updates">
            {locale === "zh-CN" ? "查看全部动态" : "View all updates"}
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="content-list">
          {listedPublicContent.slice(0, 3).map((entry) => (
            <ContentRow key={entry.path} entry={entry} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function UpdatesPage({ signedIn }: { signedIn: boolean }) {
  const { locale } = useI18n();
  const filters: Array<PublicContentKind | "All"> = [
    "All",
    "Product update",
    "Engineering",
    "Guide",
    "Use case"
  ];
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const visibleEntries =
    filter === "All"
      ? listedPublicContent
      : listedPublicContent.filter((entry) => entry.kind === filter);
  return (
    <div className="public-content-site">
      <PublicHeader signedIn={signedIn} />
      <main className="content-index">
        <header className="content-index-intro">
          <p className="eyebrow">AGENT DEVICE CLOUD</p>
          <h1>{locale === "zh-CN" ? "动态与文章" : "Updates and articles"}</h1>
          <p>
            {locale === "zh-CN"
              ? "产品发布、工程决策和真实使用方式。每篇内容都对应当前可验证的产品行为。"
              : "Product releases, engineering decisions and concrete ways to use ADC. Every article maps to verifiable product behavior."}
          </p>
        </header>
        <div className="content-index-rule">
          <span>
            {filter === "All"
              ? locale === "zh-CN"
                ? "全部内容"
                : "All published content"
              : kindLabel(filter, locale)}
          </span>
          <span>
            {locale === "zh-CN"
              ? `${visibleEntries.length} 篇`
              : `${visibleEntries.length} ${visibleEntries.length === 1 ? "entry" : "entries"}`}
          </span>
        </div>
        <div
          className="content-filters"
          role="group"
          aria-label={locale === "zh-CN" ? "内容分类" : "Content categories"}
        >
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item === "All" ? (locale === "zh-CN" ? "全部" : "All") : kindLabel(item, locale)}
            </button>
          ))}
        </div>
        <div className="content-list content-list-large">
          {visibleEntries.map((entry) => (
            <ContentRow key={entry.path} entry={entry} />
          ))}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

export function PublicArticle({
  entry,
  signedIn
}: {
  entry: PublicContentEntry;
  signedIn: boolean;
}) {
  const { locale } = useI18n();
  const start = signedIn ? "/app" : "/login";
  const related = relatedPublicContent(entry);
  return (
    <div className="public-content-site">
      <PublicHeader signedIn={signedIn} />
      <main className="article-layout">
        <article className="article">
          <header className="article-header">
            <Link to="/updates" className="article-kind">
              {kindLabel(entry.kind, locale)}
            </Link>
            <h1>{localize(entry.title, locale)}</h1>
            <p>{localize(entry.summary, locale)}</p>
            <div className="article-meta">
              <span>
                <CalendarDays size={14} />
                <time dateTime={entry.publishedAt}>{contentDate(entry.publishedAt, locale)}</time>
              </span>
              <span>
                <Clock3 size={14} />
                {locale === "zh-CN"
                  ? `${entry.readingMinutes} 分钟阅读`
                  : `${entry.readingMinutes} min read`}
              </span>
            </div>
          </header>

          <div className="article-body">
            {entry.sections.map((section) => (
              <section id={section.id} key={section.id}>
                <h2>{localize(section.title, locale)}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph.en}>{localize(paragraph, locale)}</p>
                ))}
                {section.bullets ? (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet.en}>{localize(bullet, locale)}</li>
                    ))}
                  </ul>
                ) : null}
                {section.code ? (
                  <pre>
                    <code>{section.code}</code>
                  </pre>
                ) : null}
              </section>
            ))}
          </div>

          {entry.kind !== "Policy" ? (
            <>
              <section className="article-related" aria-labelledby="related-content-title">
                <div>
                  <h2 id="related-content-title">
                    {locale === "zh-CN" ? "继续阅读" : "Continue reading"}
                  </h2>
                  <Link to="/updates">
                    {locale === "zh-CN" ? "全部内容" : "All updates"}
                    <ArrowRight size={15} />
                  </Link>
                </div>
                <div className="content-list">
                  {related.map((relatedEntry) => (
                    <ContentRow key={relatedEntry.path} entry={relatedEntry} />
                  ))}
                </div>
              </section>
              <footer className="article-cta">
                <div>
                  <strong>
                    {locale === "zh-CN"
                      ? "从一台设备和一份最小权限开始。"
                      : "Start with one device and the smallest useful grant."}
                  </strong>
                  <span>
                    {locale === "zh-CN"
                      ? "使用托管预览，或部署同一套开源服务。"
                      : "Use the hosted preview or deploy the same open-source service."}
                  </span>
                </div>
                <Link className="primary" to={start}>
                  {signedIn
                    ? locale === "zh-CN"
                      ? "打开控制台"
                      : "Open console"
                    : locale === "zh-CN"
                      ? "创建账号"
                      : "Create an account"}
                  <ArrowRight size={16} />
                </Link>
              </footer>
            </>
          ) : null}
        </article>

        <aside
          className="article-toc"
          aria-label={locale === "zh-CN" ? "本文目录" : "On this page"}
        >
          <span>{locale === "zh-CN" ? "本文目录" : "On this page"}</span>
          {entry.sections.map((section) => (
            <a href={`#${section.id}`} key={section.id}>
              {localize(section.title, locale)}
            </a>
          ))}
        </aside>
      </main>
      <PublicFooter />
    </div>
  );
}

export function PublicContentRoute({ signedIn }: { signedIn: boolean }) {
  const location = useLocation();
  if (location.pathname === "/updates" || location.pathname === "/updates/")
    return <UpdatesPage signedIn={signedIn} />;
  const entry = publicContentEntry(location.pathname);
  return entry ? <PublicArticle entry={entry} signedIn={signedIn} /> : null;
}
