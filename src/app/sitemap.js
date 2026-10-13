// Public-route sitemap for 409marketplace.online.
// Only non-auth-gated routes are listed; auth-gated and app-internal
// routes (e.g. /forge, /my-listings, /auth) are intentionally excluded.
const BASE_URL = "https://www.409marketplace.online";

const ROUTES = [
  { path: "/", changeFrequency: "daily", priority: 1.0 },
  { path: "/market", changeFrequency: "daily", priority: 0.9 },
  { path: "/browse", changeFrequency: "hourly", priority: 0.9 },
  { path: "/pets", changeFrequency: "daily", priority: 0.7 },
  { path: "/jobs", changeFrequency: "daily", priority: 0.7 },
  { path: "/businesses", changeFrequency: "daily", priority: 0.7 },
  { path: "/investors", changeFrequency: "weekly", priority: 0.6 },
  { path: "/community", changeFrequency: "weekly", priority: 0.6 },
  { path: "/post", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap() {
  const lastModified = new Date();
  return ROUTES.map((route) => ({
    url: `${BASE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
