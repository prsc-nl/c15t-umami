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
};

const VISITOR_COOKIE = "umami_visitor";
const CAMPAIGN_COOKIE = "umami_campaign";
const BEFORE_SEND = "umamiBeforeSend";
const YEAR = 60 * 60 * 24 * 365;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/** For c15t's clearOnRevocation. */
export const umamiCookies = [VISITOR_COOKIE, CAMPAIGN_COOKIE];

type UmamiPayload = Record<string, unknown>;
type UmamiWindow = Window & {
  umami?: { identify: (id: string, data?: Record<string, string>) => void };
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

export function umami({
  websiteId,
  scriptUrl,
  recorderUrl,
  cookieDomain,
  category = "measurement",
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
    attributes: { "data-website-id": websiteId, "data-before-send": BEFORE_SEND },
    onBeforeLoad() {
      // The cookie only exists after consent, so this also marks the first pageview of someone
      // who accepted on an earlier visit.
      (window as UmamiWindow)[BEFORE_SEND] = (_type, payload) => {
        const id = readCookie(VISITOR_COOKIE);
        return id ? { ...payload, id } : payload;
      };
    },
    onLoad: identify,
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
