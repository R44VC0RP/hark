import { Route, Routes } from "react-router";
import { Analytics } from "./components/Analytics";
import { DitherBackground } from "./components/DitherBackground";
import { DocumentMetadata } from "./components/DocumentMetadata";
import { CliAuthorize } from "./pages/CliAuthorize";
import {
  AgentsTab,
  AppsTab,
  BillingTab,
  DashboardLayout,
  DevicesTab,
  NotificationsTab,
  TeamsTab,
} from "./pages/Dashboard";
import { Docs } from "./pages/Docs";
import { Overview } from "./pages/dashboard/Overview";
import { Join } from "./pages/Join";
import { Landing } from "./pages/Landing";
import { Launched } from "./pages/Launched";
import { Privacy, Terms } from "./pages/Legal";
import { NotFound } from "./pages/NotFound";
import { OAuthConsent } from "./pages/OAuthConsent";
import { Pricing } from "./pages/Pricing";
import { TeamPage } from "./pages/Team";

export function App() {
  return (
    <>
      <DitherBackground />
      <Analytics />
      <DocumentMetadata />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Overview />} />
          <Route path="notifications" element={<NotificationsTab />} />
          <Route path="agents" element={<AgentsTab />} />
          <Route path="apps" element={<AppsTab />} />
          <Route path="teams" element={<TeamsTab />} />
          <Route path="teams/:teamId" element={<TeamPage />} />
          <Route path="devices" element={<DevicesTab />} />
          <Route path="billing" element={<BillingTab />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="/join" element={<Join />} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="/cli/authorize" element={<CliAuthorize />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/a/launched" element={<Launched />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/oauth/consent" element={<OAuthConsent />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
