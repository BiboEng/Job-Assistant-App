/**
 * App paths, in one module with no component imports — so App.jsx can build
 * the route table without statically pulling the (lazy-loaded) signed-in app
 * into the landing page's bundle.
 */
export const PATHS = {
  home: "/",
  // /about and /how-it-works both scroll to the landing page's Features
  // section (About and How It Works were merged); both URLs still work.
  about: "/about",
  howItWorks: "/how-it-works",
  contact: "/contact",
  // The landing page's Pricing section (plans and prices).
  pricing: "/pricing",
  // Public legal pages. Stripe Checkout links to /terms and /refunds.
  terms: "/terms",
  privacy: "/privacy",
  refunds: "/refunds",
  signIn: "/sign-in",
  // Where the "reset your password" email lands. Public: the recovery link
  // establishes a session of its own, and the person arrives here precisely
  // because they can't sign in normally.
  resetPassword: "/reset-password",

  dashboard: "/dashboard",
  setup: "/interview/new",
  chat: "/interview",
  results: "/interview/results",
  history: (id) => `/history/${encodeURIComponent(id)}`,
  jobs: "/jobs",
  resume: "/resume",
  // Interview scores over time, grouped by role. `?role=<key>` selects one.
  progress: "/progress",
  // The Application Tracker's Kanban board.
  applications: "/applications",
  // The optional career survey. Protected: it is per-account data.
  survey: "/survey",
  // Your plan, today's usage, upgrade and billing. `?plan=pro|ultimate`
  // opens that plan's checkout confirmation; Stripe returns to
  // `?checkout=success|cancelled` and `?portal=returned`.
  plans: "/plans",
};
