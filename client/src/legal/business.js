/**
 * Who is selling. Shown in the Terms, Privacy Policy, Refund Policy and the
 * site footer, and required by consumer-protection law for online sales (for
 * example, Ontario's rules for internet agreements require the seller's name,
 * address and a telephone number or email to be disclosed before purchase).
 *
 * FILL THESE IN BEFORE TAKING REAL PAYMENTS. While any required field is
 * empty, the legal pages show a "draft" notice and the Plans page won't start
 * a checkout — see `missingBusinessDetails()`.
 *
 * As a sole proprietor you sell under your own legal name. If you trade as
 * "Jobassist", most provinces require that business name to be registered —
 * see BILLING.md → "Before you take real money".
 */
export const BUSINESS = {
  // The brand the site uses.
  tradeName: "Jobassist",
  // REQUIRED. Your full legal name — you are the seller as a sole proprietor.
  legalName: "",
  // REQUIRED. The province or territory whose law governs the Terms, e.g. "Ontario".
  province: "",
  // REQUIRED. A postal address where you accept legal mail. A mailbox service
  // is fine if you'd rather not publish your home address.
  mailingAddress: "",
  // Recommended (Ontario requires a telephone number for internet agreements).
  phone: "",
  // Where customers reach you — refunds, privacy requests, support.
  contactEmail: "bibo2.muamar@gmail.com",
  // The date the current versions of the legal documents take effect.
  effectiveDate: "2026-09-30",
};

const REQUIRED = [
  ["legalName", "your legal name"],
  ["province", "the province whose law applies"],
  ["mailingAddress", "a mailing address"],
  ["contactEmail", "a contact email"],
];

/** Human names of the required fields still empty. */
export function missingBusinessDetails(b = BUSINESS) {
  return REQUIRED.filter(([key]) => !String(b[key] || "").trim()).map(([, label]) => label);
}

/** "the seller" wording used across the legal pages. */
export function sellerLine(b = BUSINESS) {
  const name = b.legalName.trim() || "[your legal name]";
  return `${b.tradeName} is operated by ${name}, a sole proprietor in ${b.province.trim() || "[province]"}, Canada`;
}
