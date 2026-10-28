import { TEAM_SEAT_PRICE_MONTHLY } from "./pricing";

export const SITE_URL = "https://hark.fyi";
export const SOCIAL_IMAGE_URL = `${SITE_URL}/ogimage.png`;
export const DEMO_POSTER_URL = `${SITE_URL}/notifications-demo-poster.jpg`;
export const DEMO_VIDEO_URL = `${SITE_URL}/notifications-demo.mp4`;

export type SeoPage =
  | "home"
  | "docs"
  | "pricing"
  | "launched"
  | "privacy"
  | "terms"
  | "dashboard"
  | "cliAuthorize";

export interface PageSeo {
  path: string;
  title: string;
  description: string;
  index: boolean;
  markdownAlternate?: string;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
}

export const PAGE_SEO: Record<SeoPage, PageSeo> = {
  home: {
    path: "/",
    title: "Hark — Webhooks to iPhone Notifications",
    description:
      "Turn webhooks from CI, coding agents, scripts, and monitors into source-branded iPhone notifications, approvals, replies, and Live Activities.",
    index: true,
  },
  docs: {
    path: "/docs",
    title: "Hark API Docs — Notifications, Approvals, and Live Activities",
    description:
      "Use the Hark webhook API and CLI to send iPhone notifications, request approvals or replies, and update Live Activities from agents and automation.",
    index: true,
    markdownAlternate: `${SITE_URL}/docs.md`,
  },
  pricing: {
    path: "/pricing",
    title: "Hark Pricing — Free for Personal Use, $5 per Team Seat",
    description:
      "Hark is free for personal use: notifications, approvals, replies and Live Activities on one iPhone. Teams with shared apps and on-call paging are $5 per seat per month.",
    index: true,
  },
  launched: {
    path: "/a/launched",
    title: "Hark Is Live on the App Store",
    description:
      "Install or update Hark for iPhone from the App Store, with direct support if anything goes wrong.",
    index: true,
    type: "article",
    publishedTime: "2026-08-01T12:00:00-04:00",
    modifiedTime: "2026-08-01T12:00:00-04:00",
  },
  privacy: {
    path: "/privacy",
    title: "Privacy Policy — Hark",
    description:
      "How Hark processes account, webhook, notification, device, interaction, Live Activity, and billing information.",
    index: true,
  },
  terms: {
    path: "/terms",
    title: "Terms of Service — Hark",
    description:
      "The terms governing Hark webhook notifications, agent interactions, and paid plans.",
    index: true,
  },
  dashboard: {
    path: "/dashboard",
    title: "Dashboard — Hark",
    description: "Manage your private Hark services, devices, activity, and agent connections.",
    index: false,
  },
  cliAuthorize: {
    path: "/cli/authorize",
    title: "Authorize Hark CLI",
    description: "Review and authorize a Hark CLI connection.",
    index: false,
  },
};

export const PUBLIC_SEO_PAGES = [
  "home",
  "docs",
  "pricing",
  "launched",
  "privacy",
  "terms",
] as const;
export const PRIVATE_SEO_PAGES = ["dashboard", "cliAuthorize"] as const;

export function absoluteUrl(path: string): string {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

export function seoPageForPath(pathname: string): SeoPage | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const [page, seo] of Object.entries(PAGE_SEO) as [SeoPage, PageSeo][]) {
    if (seo.path === normalized) return page;
  }
  return null;
}

const provider = {
  "@type": "Person",
  "@id": `${SITE_URL}/#provider`,
  name: "Ryan Vogel",
  url: "https://github.com/R44VC0RP",
};

/** Factual entities visible on the home page. Avoids ratings, reviews, and unsupported claims. */
export function homeStructuredData(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      provider,
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: "Hark",
        description: PAGE_SEO.home.description,
        inLanguage: "en-US",
        publisher: { "@id": `${SITE_URL}/#provider` },
      },
      {
        "@type": ["SoftwareApplication", "MobileApplication"],
        "@id": `${SITE_URL}/#app`,
        name: "Hark",
        alternateName: "Hark for iPhone",
        url: `${SITE_URL}/`,
        description: PAGE_SEO.home.description,
        applicationCategory: "CommunicationApplication",
        operatingSystem: "iOS",
        image: SOCIAL_IMAGE_URL,
        screenshot: DEMO_POSTER_URL,
        downloadUrl: "https://apps.apple.com/us/app/hark-developer-notifications/id6794121509",
        softwareHelp: `${SITE_URL}/docs`,
        provider: { "@id": `${SITE_URL}/#provider` },
        sameAs: ["https://github.com/R44VC0RP/hark", "https://skills.sh/r44vc0rp/hark/hark"],
        featureList: [
          "Webhook to iPhone notifications",
          "Agent approval and text reply requests",
          "Live Activities on the Lock Screen and Dynamic Island",
          "Scoped CLI access tokens",
        ],
        offers: [
          {
            "@type": "Offer",
            name: "Hark Free",
            price: "0",
            priceCurrency: "USD",
            url: `${SITE_URL}/pricing`,
          },
          {
            "@type": "Offer",
            name: "Hark Team",
            description: "Billed per team member, the owner included.",
            price: String(TEAM_SEAT_PRICE_MONTHLY),
            priceCurrency: "USD",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: String(TEAM_SEAT_PRICE_MONTHLY),
              priceCurrency: "USD",
              unitText: "seat per month",
              billingDuration: "P1M",
            },
            url: `${SITE_URL}/pricing`,
          },
        ],
      },
      {
        "@type": "VideoObject",
        "@id": `${SITE_URL}/#demo-video`,
        name: "Hark iPhone notification demo",
        description: "A demonstration of Hark delivering project notifications to an iPhone.",
        thumbnailUrl: DEMO_POSTER_URL,
        uploadDate: "2026-07-23T19:23:02-04:00",
        duration: "PT7.466S",
        contentUrl: DEMO_VIDEO_URL,
      },
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/#webpage`,
        url: `${SITE_URL}/`,
        name: PAGE_SEO.home.title,
        description: PAGE_SEO.home.description,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        mainEntity: { "@id": `${SITE_URL}/#app` },
        video: { "@id": `${SITE_URL}/#demo-video` },
        inLanguage: "en-US",
      },
    ],
  };
}

export function structuredDataForPage(page: SeoPage): Record<string, unknown> | null {
  if (page === "home") return homeStructuredData();

  const seo = PAGE_SEO[page];
  if (!seo.index) return null;
  const url = absoluteUrl(seo.path);
  const article = seo.type === "article";
  const graph: Record<string, unknown>[] = [];
  if (article) graph.push(provider);
  graph.push(
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: seo.title,
      description: seo.description,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      breadcrumb: { "@id": `${url}#breadcrumb` },
      ...(article ? { mainEntity: { "@id": `${url}#article` } } : {}),
      inLanguage: "en-US",
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Hark",
          item: `${SITE_URL}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: seo.title.replace(/\s+[—-]\s+Hark$/, ""),
          item: url,
        },
      ],
    },
  );
  if (article) {
    graph.push({
      "@type": "Article",
      "@id": `${url}#article`,
      headline: seo.title,
      description: seo.description,
      url,
      mainEntityOfPage: { "@id": `${url}#webpage` },
      image: SOCIAL_IMAGE_URL,
      author: { "@id": `${SITE_URL}/#provider` },
      publisher: { "@id": `${SITE_URL}/#provider` },
      datePublished: seo.publishedTime,
      dateModified: seo.modifiedTime ?? seo.publishedTime,
      inLanguage: "en-US",
    });
  }
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}
