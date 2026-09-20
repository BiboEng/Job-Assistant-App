import { Navigate, useLocation } from "react-router";
import { useAuth } from "./AuthProvider.jsx";
import AppSkeleton from "../components/AppSkeleton.jsx";
import { PATHS } from "../routes.js";

/**
 * Route guard for the signed-in app. Wraps the AppWorkspace layout route, so
 * one check covers every protected path.
 *
 * While the persisted session is still being read it renders a quiet
 * placeholder rather than redirecting — see AuthProvider for why. Once it
 * knows there's no user it redirects to /sign-in and remembers where the
 * person was headed (`state.from`) so a deep link survives signing in.
 *
 * This is a UX boundary, not a security one: the API server does not verify
 * Supabase tokens. See "Authentication" in CLAUDE.md.
 */
export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AppSkeleton label="Checking your sign-in…" />;
  }

  if (!user) {
    return (
      <Navigate
        to={PATHS.signIn}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return children;
}
