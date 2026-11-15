// Harness-only stub for next/link (the placement harness is a static
// esbuild bundle, not a Next.js app). Renders a plain anchor; the
// components under test only use it for navigation links.
import React from "react";

export default function Link({ href, children, ...props }) {
  const resolved = typeof href === "string" ? href : href?.pathname || "#";
  return (
    <a href={resolved} {...props}>
      {children}
    </a>
  );
}
