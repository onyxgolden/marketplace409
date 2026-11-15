// Harness-only stub for next/navigation (the placement harness is a
// static esbuild bundle, not a Next.js app). The components under test
// only use the router for refresh/push after a mutation and the search
// params for page scope; all are no-ops here.
export function useRouter() {
  return {
    refresh: () => {},
    push: () => {},
    replace: () => {},
    back: () => {},
    prefetch: async () => {},
  };
}

export function usePathname() {
  return "/forge/work";
}

export function useSearchParams() {
  return new URLSearchParams("");
}
