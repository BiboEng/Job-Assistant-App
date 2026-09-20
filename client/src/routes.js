/**
 * App paths, in one module with no component imports — so App.jsx can build
 * the route table without statically pulling the (lazy-loaded) signed-in app
 * into the landing page's bundle.
 */
export const PATHS = {
  home: "/",
  about: "/about",
  howItWorks: "/how-it-works",
  contact: "/contact",
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
};
