const BASE_URL = "https://www.409marketplace.online";

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep auth-gated and app-internal surfaces out of crawlers.
        disallow: ["/auth", "/forge", "/my-listings", "/api/", "/admin"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
