export const businessRules = [
  {
    id: "UI_NO_SUPABASE",
    severity: "BLOCK",
    match: ({ file, code }) =>
      file.includes("/app/businesses") &&
      code.includes("supabase.from(\"business")
  },
  {
    id: "NO_REPO_BYPASS",
    severity: "BLOCK",
    match: ({ file, code }) =>
      file.includes("business-claims") &&
      code.includes("BusinessRepository.update")
  }
];
