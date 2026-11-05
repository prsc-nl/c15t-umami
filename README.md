# @prsc-nl/c15t-umami

[Umami](https://umami.is) as [c15t](https://c15t.com) scripts, for a self-hosted or cloud Umami:

- **Everyone:** Umami's cookie-free stats, without waiting for consent.
- **After consent:** a random visitor ID and the landing page's UTMs in first-party cookies, so repeat visits and campaigns connect. Optionally replays and heatmaps.
- **After withdrawal:** the cookies go, and c15t's reload stops the rest.

URLs reach Umami with only their UTMs. Umami would otherwise store the query string and click IDs such as `gclid` and `fbclid`, also for visitors who declined.

## Add it to a site

1. Set up [c15t](https://c15t.com) in the site, with a consent banner and a `c15t.config.ts`.
2. Create the website in Umami and copy its website ID.
3. Install this package and add it to the config, as below. Only call `umami()` on your live domain, so previews and localhost stay out of the stats.
4. Mention Umami in the site's privacy policy.
5. Open the live site and check the pageview in Umami's dashboard.

## Use

```ts
// c15t.config.ts
import { umami, umamiCookies } from "@prsc-nl/c15t-umami";
import { defineConsentConfig } from "c15t/next";

// Keeps previews and localhost out of the stats. The helper has no domain check of its own.
const onLiveDomain =
  typeof window !== "undefined" && ["example.com", "www.example.com"].includes(window.location.hostname);

export default defineConsentConfig({
  scripts: [
    ...(onLiveDomain
      ? umami({
          websiteId: "your-website-id",
          scriptUrl: "https://umami.example.com/script.js",
          recorderUrl: "https://umami.example.com/recorder.js", // optional
          cookieDomain: ".example.com", // optional
        })
      : []),
  ],
  clearOnRevocation: {
    measurement: { cookies: [...umamiCookies] },
  },
});
```

## Custom events

For clicks you don't need this package. Umami's tracker picks up the attributes:

```tsx
<a href="/plan.pdf" data-umami-event="download" data-umami-event-type="plus">Download</a>
```

From code, use `track`. It waits for the tracker if it hasn't loaded yet, and does nothing on the server or if it never loads:

```ts
import { track } from "@prsc-nl/c15t-umami";

track("video-finished", { video: "intro" });
```

To catch typos at build time, pass your event names:

```ts
type SiteEvent = "video-finished" | "map-opened";

track<SiteEvent>("video-finished");
```

Events also fire for visitors who haven't given consent, so keep them anonymous: no names, email addresses or form input.

### 404 pages

To see which URLs people land on that don't exist, call `track` from your not-found page:

```tsx
"use client";

import { track } from "@prsc-nl/c15t-umami";
import { useEffect } from "react";

export function NotFoundEvent() {
  useEffect(() => track("404", { path: location.pathname }), []);
  return null;
}
```

## Leaving out your own visits

Open any page with `?notrack` to stop counting this browser in Umami, and with `?track` to count it again. It only affects Umami, in that browser, and needs doing once per browser and domain.

## Options

| Option | Required | What it does |
| --- | --- | --- |
| `websiteId` | Yes | The website ID from Umami. |
| `scriptUrl` | Yes | Where your Umami tracker lives. Events go to the same host. |
| `recorderUrl` | No | Umami's recorder script. Left out, there are no replays or heatmaps. |
| `cookieDomain` | No | Shares the cookies across subdomains. |
| `performance` | No | Also sends load-speed measurements (Core Web Vitals) with each page. Off by default. |
| `category` | No | The c15t consent category for everything beyond the stats. Defaults to `measurement`. |

Whether the cookie-free stats may run without consent is your call and depends on your jurisdiction. Replays and heatmaps always wait for consent here. This isn't legal advice.

## Releasing

Bump `version` in `package.json` and push to `main`. GitHub Actions publishes it to npm; pushes that don't change the version publish nothing.
