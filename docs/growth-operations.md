# Growth and operations

This document defines the first public growth system for Agent Device Cloud. It covers the official
website and hosted service. A source build or self-hosted installation remains analytics-free unless
its operator explicitly configures an analytics provider.

## Operating principles

1. Earn discovery with useful technical material before buying traffic.
2. Measure whether onboarding works, not what users do on their devices.
3. Keep analytics, account audit records and service-health metrics separate.
4. Publish only claims that can be verified in the current release.
5. Use one stable HTTPS origin for canonical URLs, OAuth, downloads and search indexing.

## Baseline delivered in the application

- Every public route has prerendered HTML, a canonical URL, route-specific metadata and JSON-LD.
- `/updates` lists product releases, engineering articles and use cases from one typed content source.
- `/robots.txt`, `/sitemap.xml`, `/feed.xml`, `/llms.txt` and `/llms-full.txt` are generated from the
  same route manifest.
- Login, OAuth and Console routes return an application shell with `noindex, nofollow`.
- The hosted service can opt into Plausible through server-only environment variables.
- The browser checks Global Privacy Control and Do Not Track before loading Plausible.
- Pageviews use normalized paths. Only allowlisted UTM/referrer campaign fields can be attached.
- Self-hosted deployments have no analytics endpoint, identifier, script request or event by default.

## Measurement model

The first release uses aggregate, privacy-focused analytics. It is intentionally not a user-level
behavior warehouse. Counts from different funnel steps show operational direction, not exact
person-by-person cohorts.

| Event                     | Trigger after success                                     | Allowed properties |
| ------------------------- | --------------------------------------------------------- | ------------------ |
| `Primary CTA Selected`    | Main landing-page CTA is selected                         | `placement`        |
| `Account Registered`      | Email registration succeeds                               | none               |
| `Account Signed In`       | Email sign-in succeeds                                    | none               |
| `GitHub Sign In Started`  | Server accepts the GitHub sign-in request                 | none               |
| `Pairing Code Created`    | A device installation code is created                     | none               |
| `Agent Access Created`    | An Agent authorization is created                         | none               |
| `Connection Created`      | A CLI credential or MCP OAuth binding is created          | none               |
| `Initial Setup Completed` | The browser first observes a device, grant and connection | none               |

Never add email addresses, account/user/device/grant identifiers, labels, repository names, file
paths, commands, tool arguments, results, prompts, tokens, private keys or artifact names. New events
require a documented decision, a bounded property list and a test proving that invocation endpoints
are not tracked.

The activation funnel is:

```text
public page -> primary CTA -> registration -> pairing code -> Agent grant
            -> client connection -> initial setup complete
```

Track weekly:

- Search impressions, indexed public pages and non-branded queries.
- Public-page visits by landing page and referring source.
- CTA-to-registration, registration-to-pairing and pairing-to-setup ratios.
- Median time between registration and the first successful setup, computed only from first-party
  hosted database timestamps when a future aggregate job is approved.
- Connector availability, dispatch latency and errors in Prometheus, never in product analytics.

## Search launch checklist

Technical readiness:

- Set `ADC_PUBLIC_URL` to a dedicated HTTPS domain without a non-standard port.
- Redirect every alternate hostname and HTTP URL to that canonical origin.
- Verify that the production response contains rendered copy without requiring JavaScript.
- Verify `/robots.txt`, `/sitemap.xml`, `/feed.xml`, `/llms.txt` and `/llms-full.txt`.
- Check that `/app`, `/login`, `/authorize`, `/cli-login` and API routes are not indexable.
- Add a real social preview image before broad link distribution.

External setup, performed by the domain/repository owner:

- Set the GitHub repository homepage to the canonical site and add focused topics such as
  `ai-agents`, `mcp`, `device-management`, `self-hosted` and `typescript`.
- Configure the final vulnerability-reporting address in `SECURITY.md`.
- Verify the domain in Google Search Console, submit `/sitemap.xml`, and request indexing for the
  home page, quickstart, architecture and first engineering article.
- Add the same site to Bing Webmaster Tools. Configure IndexNow only after the canonical domain is
  stable.
- Submit the site to Baidu Search Resource Platform if mainland-China discovery is a target.
- Check index coverage, canonical selection and crawl errors weekly for the first eight weeks.

The repository is public and licensed under Apache-2.0, but it was created only recently. Search
engines need crawl signals and time; changing metadata alone cannot guarantee immediate ranking.

## Brand and query strategy

Another established project already uses the exact phrase "Agent Device Cloud". Until a naming
decision is made, always pair the product name with the descriptor **secure device access for AI
agents**. Do not spend on the bare brand term.

Prioritize specific queries where the product has a defensible answer:

- AI agent access to a computer behind NAT
- secure local tools for AI agents
- MCP access to a local development environment
- AI agent device authorization and audit
- remote coding agent without inbound SSH

Before purchasing ads or choosing a long-lived domain, complete a naming, domain and trademark
review. If the product keeps its current name, add a stable organization qualifier across the site,
repository and social profiles.

## Content program

Publish from real product work:

- Every material release: one short update with behavior, failure model and operator impact.
- Twice per month: one technical article answering a concrete search question.
- Monthly: refresh quickstart, security boundaries, roadmap and comparison pages.
- Quarterly: review stale screenshots, claims, links, schema dates and installation commands.

Each article needs one primary query, a literal title, a concise answer in the opening paragraph,
links to relevant documentation, and a verifiable example. Avoid mass-generated pages, unsupported
benchmarks and generic AI commentary. RSS and `llms.txt` update automatically when content is added
to `public-content.ts`.

## GEO and citations

Large-model discovery depends more on clear facts and third-party references than on a special file.
Keep `/llms.txt` as a map, not a replacement for accessible HTML. Use consistent terminology,
explicit limitations, dated updates, source-linked architecture explanations and stable URLs.
Encourage independent integration guides and technical reviews only after installation is
repeatable from a clean machine.

## Distribution sequence

1. Canonical domain, indexing tools, GitHub metadata and security contact.
2. Announce the open-source repository with the quickstart and NAT architecture article.
3. Publish release notes through GitHub Releases, `/updates` and RSS from the same release facts.
4. Share focused technical posts in MCP, self-hosting and developer-tool communities where they
   directly answer an existing problem.
5. Build examples for named clients only after their integration has been verified.
6. Start small search-ad experiments only after organic pages are indexed and the activation funnel
   has enough traffic to reveal failures.

Do not install advertising pixels in the application. Paid links use standard UTM parameters; the
ADC adapter accepts only the documented campaign keys and strips all other query parameters from
reported page URLs.

## Release operation

For each public release:

1. Update implementation status and any affected docs.
2. Add a dated entry to `public-content.ts`.
3. Build and inspect one generated article, sitemap, feed and `llms-full` output.
4. Deploy, then verify health, canonical origin, index headers and analytics network policy.
5. Publish matching GitHub release notes and distribution posts.
6. Review search coverage and funnel ratios after 24 hours, 7 days and 28 days.

No release is promoted as production-ready while the site still uses the preview `nip.io` hostname,
the security contact is unset, or backup/restore and provider delivery checks remain incomplete.
