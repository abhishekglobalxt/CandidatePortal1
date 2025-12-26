// App.jsx
import "./App.css";
import CandidatePortal from "./CandidatePortal.jsx";
import SetupPortal from "./SetupPortal.jsx";
import ThankYou from "./ThankYou.jsx";

export default function App() {
  const path = window.location.pathname.toLowerCase();

  if (path.startsWith("/setup")) return <SetupPortal />;
  if (path.startsWith("/interview")) return <CandidatePortal />;
  if (path.startsWith("/thank-you")) return <ThankYou />;

  // Default route: ALWAYS go to setup
  // (this avoids accidentally rendering CandidatePortal without id/token)
  return <SetupPortal />;
}
