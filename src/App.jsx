// App.jsx
import "./App.css";
import CandidatePortal from "./CandidatePortal.jsx";
import SetupPortal from "./SetupPortal.jsx";

export default function App() {
  const path = window.location.pathname.toLowerCase();
  const hasSetup = !!sessionStorage.getItem("gx_candidate");

  if (path.startsWith("/setup")) return <SetupPortal />;
  if (path.startsWith("/interview")) return <CandidatePortal />;

  // default route in dev: go to setup first
  return hasSetup ? <CandidatePortal /> : <SetupPortal />;
}
