const normalized = (value) => String(value ?? "").trim().toLowerCase();

export function inferSimplifiAccountType(accountName) {
  const name = normalized(accountName);
  if (/\b(ira|retirement|portfolio|brokerage|investment|crypto|xrp)\b/.test(name)) {
    return "investment";
  }
  if (/\b(line of credit|loan|mortgage)\b/.test(name)) return "loan";
  if (/\b(credit|card|visa|master|spark)\b/.test(name)) return "credit";
  if (/\b(checking|savings|\bck\b|cash)\b/.test(name)) return "depository";
  return "other";
}
