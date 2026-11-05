# @prsc-nl/c15t-umami

[Umami](https://umami.is) as [c15t](https://c15t.com) scripts, for a self-hosted or cloud Umami:

- **Everyone:** Umami's cookie-free stats, without waiting for consent.
- **After consent:** a random visitor ID and the landing page's UTMs in first-party cookies, so repeat visits and campaigns connect. Optionally replays and heatmaps.
- **After withdrawal:** the cookies go, and c15t's reload stops the rest.

Click IDs such as `gclid` and `fbclid` are never stored.

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

## Options

| Option | Required | What it does |
| --- | --- | --- |
| `websiteId` | Yes | The website ID from Umami. |
| `scriptUrl` | Yes | Where your Umami tracker lives. Events go to the same host. |
| `recorderUrl` | No | Umami's recorder script. Left out, there are no replays or heatmaps. |
| `cookieDomain` | No | Shares the cookies across subdomains. |
| `category` | No | The c15t consent category for everything beyond the stats. Defaults to `measurement`. |

Whether the cookie-free stats may run without consent is your call and depends on your jurisdiction. Replays and heatmaps always wait for consent here. This isn't legal advice.
