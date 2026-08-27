// Next.js App Router convention: src/app/api/workspace/members/route.js -> /api/workspace/members.
// Dynamic segments keep their bracket syntax (`[id]` stays `[id]`) since that's the literal route
// pattern, not a resolved URL.
export function deriveApiRoutePath(filePath) {
  const match = filePath.match(/^src\/app\/(.*)\/route\.(js|jsx|ts|tsx)$/);
  if (!match) return null;
  return `/${match[1]}`;
}
