// ThankYou.jsx
import gxLogo from "./assets/globalxperts-logo.png";
import { useEffect } from "react";

export default function ThankYou() {
  const params = new URLSearchParams(window.location.search);
  const interviewId = params.get("id") || "";
  const reason = params.get("reason") || "completed";

  useEffect(() => {
    // 1) Clear any session state that could allow re-entry/resume
    try {
      sessionStorage.removeItem("gx_candidate");
      sessionStorage.removeItem("gx_interview_id");
    } catch {}

    // 2) Remove local progress keys (either all, or only this interview)
    try {
      const prefix = "hirexpert_progress_";
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (!k.startsWith(prefix)) continue;

        // if interviewId is known, remove only that interview’s progress
        if (!interviewId || k.includes(`_${interviewId}_`)) {
          localStorage.removeItem(k);
        }
      }
    } catch {}

    // 3) Block Back button (user asked "No back should be allowed")
    const lock = () => {
      try {
        window.history.pushState({ hx: "thankyou" }, "", window.location.href);
      } catch {}
    };

    // Add a couple of states so back triggers popstate
    lock();
    lock();

    const onPop = () => lock();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [interviewId]);

  return (
    <div className="hx-page" style={{ padding: 24 }}>
      <div className="hx-card" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ padding: 20, textAlign: "center" }}>
          <img
            src={gxLogo}
            alt="GlobalXperts"
            style={{ height: 48, marginBottom: 16 }}
          />
          <h2 style={{ margin: "8px 0" }}>Thank you!</h2>
          <p style={{ opacity: 0.9, margin: "8px 0 0" }}>
            Your interview has been submitted successfully.
          </p>

          {reason !== "completed" && (
            <p style={{ opacity: 0.7, marginTop: 10, fontSize: 13 }}>
              Session status: {reason}
            </p>
          )}

          <div style={{ marginTop: 18, opacity: 0.85, fontSize: 13 }}>
            You may close this tab now.
          </div>
        </div>
      </div>
    </div>
  );
}
