import type { Script } from "c15t";

// Umami as c15t scripts: cookie-free stats for everyone, and after consent a visitor ID, the
// landing campaign and optionally replays. Everything site-specific comes in through the options.
export type UmamiOptions = {
  websiteId: string;
  scriptUrl: string;
  /** Replays and heatmaps, behind consent. Leave out to skip them. */
  recorderUrl?: string;
  /** Share the cookies across subdomains, for example ".example.com". */
  cookieDomain?: string;
  /** The consent category for everything beyond the cookie-free stats. */
  category?: Script["category"];
  /** Also send load-speed measurements (Core Web Vitals) with each page. Off by default. */
  performance?: boolean;
  /** Count clicks on external links, file downloads and mailto/tel links as events. Off by default. */
  trackLinks?: boolean;
};

const VISITOR_COOKIE = "umami_visitor";
const CAMPAIGN_COOKIE = "umami_campaign";
const BEFORE_SEND = "umamiBeforeSend";
const DISABLED_KEY = "umami.disabled";
const MAX_QUEUED = 50;
const YEAR = 60 * 60 * 24 * 365;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/** For c15t's clearOnRevocation. */
export const umamiCookies = [VISITOR_COOKIE, CAMPAIGN_COOKIE];

export type UmamiEventData = Record<string, string | number | boolean>;

type UmamiPayload = Record<string, unknown>;
type UmamiWindow = Window & {
  umami?: {
    identify: (id: string, data?: Record<string, string>) => void;
    track: (name: string, data?: UmamiEventData) => void;
  };
  [BEFORE_SEND]?: (type: string, payload: UmamiPayload) => UmamiPayload;
};

function readCookie(name: string): string | undefined {
  const row = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return row ? decodeURIComponent(row.slice(name.length + 1)) : undefined;
}

function writeCookie(name: string, value: string, cookieDomain?: string) {
  const domain = cookieDomain ? `; domain=${cookieDomain}` : "";
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${YEAR}; samesite=lax${domain}${secure}`;
}

// Umami stores the query string and click IDs (gclid, fbclid, ...) it finds in a URL, also for
// visitors who declined. So only the UTMs reach it, which also keeps one page from splitting
// into many entries.
function keepUtms(url: string): string {
  const start = url.indexOf("?");
  if (start === -1) return url;
  const hashAt = url.indexOf("#", start);
  const end = hashAt === -1 ? url.length : hashAt;
  const params = new URLSearchParams(url.slice(start + 1, end));
  for (const key of [...params.keys()]) if (!UTM_KEYS.includes(key)) params.delete(key);
  const query = params.toString();
  return url.slice(0, start) + (query ? `?${query}` : "") + url.slice(end);
}

// ?notrack switches this browser off in Umami's stats, ?track on again, for staff and clients.
function applyTrackingSwitch() {
  const params = new URLSearchParams(location.search);
  try {
    if (params.has("notrack")) localStorage.setItem(DISABLED_KEY, "1");
    if (params.has("track")) localStorage.removeItem(DISABLED_KEY);
  } catch {
    // Storage can be blocked. Then the switch just doesn't stick.
  }
}

// The UTMs of the landing page, held in memory until someone accepts, which can be a page later.
// Click IDs (gclid, fbclid) stay out: they point at one person.
function readLandingCampaign(): Record<string, string> {
  const params = new URLSearchParams(location.search);
  return Object.fromEntries(
    UTM_KEYS.flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value]] : [];
    }),
  );
}

// The first campaign seen stays.
function campaign(landing: Record<string, string>, cookieDomain?: string): Record<string, string> {
  const stored = readCookie(CAMPAIGN_COOKIE);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return {};
    }
  }
  if (Object.keys(landing).length === 0) return {};
  writeCookie(CAMPAIGN_COOKIE, JSON.stringify(landing), cookieDomain);
  return landing;
}

// Events from before the tracker loaded. A 404 page, say, fires its event straight away.
const queued: Array<[string, UmamiEventData | undefined]> = [];

function flushQueue() {
  const tracker = (window as UmamiWindow).umami;
  if (tracker) for (const [name, data] of queued.splice(0)) tracker.track(name, data);
}

/**
 * Records a custom event from code. Waits for the tracker if it hasn't loaded yet, and does
 * nothing on the server or if it never loads. Pass a union as `Name` to have typos in event
 * names caught at build time.
 */
export function track<Name extends string = string>(name: Name, data?: UmamiEventData): void {
  if (typeof window === "undefined") return;
  const tracker = (window as UmamiWindow).umami;
  if (tracker) tracker.track(name, data);
  else if (queued.length < MAX_QUEUED) queued.push([name, data]);
}

const DOWNLOAD = /\.(pdf|zip|docx?|xlsx?|pptx?|csv|dwg|ics)$/i;
let watchingLinks = false;

// Fires as the click happens. Umami sends with keepalive, so leaving the page doesn't lose it.
function trackLink(event: MouseEvent) {
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("data-umami-event")) return;
  const { protocol, hostname, pathname } = link;
  if (protocol === "mailto:" || protocol === "tel:") {
    track("contact-click", { type: protocol.slice(0, -1), to: link.href.slice(protocol.length).split("?")[0] });
  } else if (protocol !== "http:" && protocol !== "https:") {
    return;
  } else if (link.hasAttribute("download") || DOWNLOAD.test(pathname)) {
    track("file-download", { file: decodeURIComponent(pathname.split("/").pop() ?? pathname) });
  } else if (hostname !== location.hostname) {
    track("outbound-link", { url: hostname + pathname });
  }
}

function watchLinks() {
  if (watchingLinks) return;
  watchingLinks = true;
  document.addEventListener("click", trackLink, { capture: true });
}

export function umami({
  websiteId,
  scriptUrl,
  recorderUrl,
  cookieDomain,
  category = "measurement",
  performance = false,
  trackLinks = false,
}: UmamiOptions): Script[] {
  if (typeof window === "undefined") return [];

  const landing = readLandingCampaign();

  const identify = ({ hasConsent }: { hasConsent: boolean }) => {
    if (!hasConsent) return;
    const id = readCookie(VISITOR_COOKIE) ?? crypto.randomUUID();
    writeCookie(VISITOR_COOKIE, id, cookieDomain);
    (window as UmamiWindow).umami?.identify(id, campaign(landing, cookieDomain));
  };

  const tracker: Script = {
    id: "umami",
    category,
    src: scriptUrl,
    alwaysLoad: true, // the stats are cookie-free, so they don't wait for consent
    attributes: {
      "data-website-id": websiteId,
      "data-before-send": BEFORE_SEND,
      ...(performance ? { "data-performance": "true" } : {}),
    },
    onBeforeLoad() {
      applyTrackingSwitch();
      (window as UmamiWindow)[BEFORE_SEND] = (_type, payload) => {
        const cleaned = { ...payload };
        for (const key of ["url", "referrer"]) {
          const value = cleaned[key];
          if (typeof value === "string") cleaned[key] = keepUtms(value);
        }
        // The cookie only exists after consent, so this also marks the first pageview of
        // someone who accepted on an earlier visit.
        const id = readCookie(VISITOR_COOKIE);
        return id ? { ...cleaned, id } : cleaned;
      };
    },
    onLoad(info) {
      identify(info);
      flushQueue();
      if (trackLinks) watchLinks();
    },
    onConsentChange: identify,
  };

  const recorder: Script | undefined = recorderUrl
    ? {
        id: "umami-recorder",
        category,
        src: recorderUrl,
        defer: true,
        attributes: { "data-website-id": websiteId },
      }
    : undefined;

  return recorder ? [tracker, recorder] : [tracker];
}
