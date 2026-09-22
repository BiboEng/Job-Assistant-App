import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import RequireAuth from "./auth/RequireAuth.jsx";
import AppSkeleton from "./components/AppSkeleton.jsx";
import LandingScreen from "./screens/LandingScreen.jsx";
import SignInScreen from "./screens/SignInScreen.jsx";
import ResetPasswordScreen from "./screens/ResetPasswordScreen.jsx";
import { PATHS } from "./routes.js";

/**
 * The route table — the whole of the app's navigation, in one place.
 *
 * Public: the landing page and its three sections, plus /sign-in. The four
 * landing paths all render the same LandingScreen (so moving between them is a
 * scroll, not a remount); the path decides which section it scrolls to.
 *
 * Protected: one pathless layout route, guarded once by RequireAuth, holding
 * AppWorkspace — which owns the interview/job-match state and keeps it alive
 * while its child routes change. The whole signed-in app is one lazy chunk, so
 * the public pages don't ship it.
 */

const workspace = () => import("./AppWorkspace.jsx");
const pick = (name) => lazy(() => workspace().then((m) => ({ default: m[name] })));

const AppWorkspace = lazy(workspace);
const DashboardRoute = pick("DashboardRoute");
const SetupRoute = pick("SetupRoute");
const ChatRoute = pick("ChatRoute");
const ResultsRoute = pick("ResultsRoute");
const HistoryDetailRoute = pick("HistoryDetailRoute");
const JobMatchesRoute = pick("JobMatchesRoute");
const ResumeBuilderRoute = pick("ResumeBuilderRoute");
const SurveyRoute = pick("SurveyRoute");

export default function App() {
  return (
    <Routes>
      <Route path={PATHS.home} element={<LandingScreen />} />
      <Route path={PATHS.about} element={<LandingScreen />} />
      <Route path={PATHS.howItWorks} element={<LandingScreen />} />
      <Route path={PATHS.contact} element={<LandingScreen />} />
      <Route path={PATHS.signIn} element={<SignInScreen />} />
      <Route path={PATHS.resetPassword} element={<ResetPasswordScreen />} />

      <Route
        element={
          <RequireAuth>
            <Suspense fallback={<AppSkeleton label="Loading your workspace…" />}>
              <AppWorkspace />
            </Suspense>
          </RequireAuth>
        }
      >
        <Route path={PATHS.dashboard} element={<DashboardRoute />} />
        <Route path={PATHS.setup} element={<SetupRoute />} />
        <Route path={PATHS.chat} element={<ChatRoute />} />
        <Route path={PATHS.results} element={<ResultsRoute />} />
        <Route path="/history/:interviewId" element={<HistoryDetailRoute />} />
        <Route path={PATHS.jobs} element={<JobMatchesRoute />} />
        <Route path={PATHS.resume} element={<ResumeBuilderRoute />} />
        <Route path={PATHS.survey} element={<SurveyRoute />} />
      </Route>

      <Route path="*" element={<Navigate to={PATHS.home} replace />} />
    </Routes>
  );
}
