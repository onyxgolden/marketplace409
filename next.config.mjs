/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Trim barrel imports (e.g. lucide-react's 40MB package surface) so
    // serverless functions only bundle the icons they actually use.
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
