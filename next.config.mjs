/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Hero imagery is served from the Unsplash CDN.
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  experimental: {
    // Trim barrel imports (e.g. lucide-react's 40MB package surface) so
    // serverless functions only bundle the icons they actually use.
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
