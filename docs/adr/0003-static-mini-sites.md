# ADR 0003: Mini-sites are published as static files on a separate domain

Status: accepted (design.md D16).

**Context.** Ads run around the clock; if landing pages depend on the app, deploys and outages waste money.
User-written content must not share a domain with app sessions.

**Decision.** `PublishMiniSite`/`UpdateMiniSite` render HTML with the Metrika goals and upload it through the
`MiniSiteStore` port (S3-compatible storage + static hosting/CDN) on a separate registrable domain. Campaigns
enable Direct site monitoring so ads stop when a landing page is down.

**Consequences.** Mini-sites survive app outages; publishing is a worker side effect; rollback restores the
previous card and republishes.
