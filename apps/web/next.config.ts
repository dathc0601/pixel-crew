import type { NextConfig } from "next";
import withPWAInit, { runtimeCaching as defaultRuntimeCaching } from "@ducanh2912/next-pwa";
import path from "path";
import { readFileSync } from "fs";

// Workbox serializes runtime-caching plugins into sw.js with Function#toString, after
// Next has transpiled this file (and next-pwa) with SWC. next-pwa's own plugins are
// `async` functions, which come out calling `_async_to_generator`, a helper sw.js does
// not define: every call threw a ReferenceError (an uncaught rejection in the worker,
// and a network error page instead of the fallback). So these hooks are plain
// functions returning promises, and next-pwa skips its own when a route has one.
type SwGlobal = { fallback?: (req: Request) => Promise<Response | undefined> };

/** Failed fetch → precached fallback (offline.html for documents), else a plain network error. Never rejects. */
const offlineFallback = {
  handlerDidError: function (param: { request: Request }) {
    const sw = globalThis as unknown as SwGlobal;
    if (!sw.fallback) return Promise.resolve(Response.error());
    return sw.fallback(param.request).then(
      function (res) { return res || Response.error(); },
      function () { return Response.error(); },
    );
  },
};

type CacheEntry = (typeof defaultRuntimeCaching)[number];
const withFallback = (entry: CacheEntry): CacheEntry =>
  entry.options
    ? { ...entry, options: { ...entry.options, plugins: [...(entry.options.plugins ?? []), offlineFallback] } }
    : entry;

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  navigateFallbackDenylist: [/^\/preview-static/, /^\/preview-app/],
  // The "start-url" route next-pwa adds carries an async plugin (see above); "/" is
  // covered by the navigation route below instead.
  dynamicStartUrl: false,
  // Precached static page served when a navigation fails (gateway stopped or restarting)
  fallbacks: { document: "/offline.html" },
  // The defaults are listed below with the fallback hook added
  extendDefaultRuntimeCaching: false,
  workboxOptions: {
    runtimeCaching: [
      {
        // Preview proxy paths — never cache, always hit the gateway proxy
        urlPattern: ({ url }: { url: URL }) =>
          /^\/(preview-static|preview-app)(\/.*)?$/.test(url.pathname),
        handler: "NetworkOnly",
      },
      {
        // App pages need a live gateway: never serve a stale cached page, show
        // offline.html instead until the gateway answers again
        urlPattern: ({ request }: { request: Request }) => request.mode === "navigate",
        handler: "NetworkOnly",
        options: { cacheName: "navigations", plugins: [offlineFallback] },
      },
      ...defaultRuntimeCaching.map(withFallback),
    ],
  },
});

const isDev = process.env.NODE_ENV === "development";

/** Monorepo root (…/pixel-crew) — same `version` as shipped gateway bundles this `out/` */
const repoRoot = path.resolve(__dirname, "../..");
let appVersion = "0.0.0";
try {
  const raw = readFileSync(path.join(repoRoot, "package.json"), "utf8");
  appVersion = (JSON.parse(raw) as { version?: string }).version ?? appVersion;
} catch {
  /* keep default */
}

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_APP_BUILD_TIME: new Date().toISOString(),
  },
  devIndicators: false,
  // Lint runs once for the whole repo (root eslint.config.mjs, `pnpm lint`), not inside next build
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: true,
  // `PIXEL_CREW_SOURCE_MAPS=1 pnpm --filter web build` emits browser source maps for bundle analysis
  productionBrowserSourceMaps: process.env.PIXEL_CREW_SOURCE_MAPS === "1",
  transpilePackages: ["@pixel-crew/shared"],
  output: isDev ? undefined : "export",
  ...(isDev && {
    headers: async () => [
      {
        source: "/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ],
  }),
};

export default withPWA(nextConfig);
