import { useEffect, useRef, useState } from "react";
import "./App.css"; // <— new stylesheet

const SETUP_WEBHOOK = import.meta.env.VITE_SETUP_WEBHOOK;

function useQuery() {
  const p = new URLSearchParams(window.location.search);
  return Object.fromEntries(p.entries());
}

function StatusPill({ ok, label }) {
  return (
    <span className={`pill ${ok ? "ok" : ""}`}>
      <span className="dot" />
      {label} {ok ? "ready" : "…"}
    </span>
  );
}

export default function SetupPortal() {
  const { id: interviewIdParam = "" } = useQuery();

  // persist id for handoff to interview page
  useEffect(() => {
    if (interviewIdParam) sessionStorage.setItem("gx_interview_id", interviewIdParam);
  }, [interviewIdParam]);

  // media
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const dataArrayRef = useRef(null);

  // ui
  const [isTesting, setIsTesting] = useState(false);
  const [permError, setPermError] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [camOk, setCamOk] = useState(false);
  const [micOk, setMicOk] = useState(false);

  // form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [resume, setResume] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const startTest = async () => {
    setPermError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      setCamOk(stream.getVideoTracks().length > 0);
      setMicOk(stream.getAudioTracks().length > 0);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsTesting(true);

      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 1024;
      source.connect(analyserRef.current);
      dataArrayRef.current = new Uint8Array(analyserRef.current.fftSize);

      const tick = () => {
        analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          const v = (dataArrayRef.current[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArrayRef.current.length);
        const lvl = Math.min(1, rms * 4);
        setAudioLevel(lvl);
        if (lvl > 0.03) setMicOk(true);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.error(err);
      setPermError("We couldn’t access your camera/mic. Please allow permissions and try again.");
      stopTest();
    }
  };

  const stopTest = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (analyserRef.current) { try { analyserRef.current.disconnect(); } catch {} }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} }
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsTesting(false);
    setAudioLevel(0);
    setCamOk(false);
    setMicOk(false);
  };
  useEffect(() => () => stopTest(), []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");

    if (!name.trim() || !email.trim()) return setSubmitError("Please enter your name and email.");
    if (!resume) return setSubmitError("Attach your resume (.pdf, .doc, .docx).");
    const okExt = [".pdf", ".doc", ".docx"].some((ext) => resume.name.toLowerCase().endsWith(ext));
    if (!okExt) return setSubmitError("Resume must be PDF or Word.");
    if (!camOk || !micOk) return setSubmitError("Please complete the camera & mic test.");
    if (!SETUP_WEBHOOK) return setSubmitError("Setup webhook is not configured.");

    setSubmitting(true);
    try {
      const iid = interviewIdParam || sessionStorage.getItem("gx_interview_id") || "";
      const form = new FormData();
      form.append("name", name);
      form.append("email", email);
      form.append("interview_id", iid);
      form.append("cam_ok", String(camOk));
      form.append("mic_ok", String(micOk));
      form.append("user_agent", navigator.userAgent);
      form.append("resume", resume, resume.name);

      const res = await fetch(SETUP_WEBHOOK, { method: "POST", body: form });
      let payload = {};
      try { payload = await res.json(); } catch {}
      if (!res.ok) throw new Error(payload?.message || `Setup failed (${res.status})`);

      const candidateId = payload.candidateId || payload.candidate_id || payload.id || null;
      sessionStorage.setItem("gx_candidate", JSON.stringify({ candidateId, name, email }));
      sessionStorage.setItem("gx_interview_id", iid);

      window.location.assign(`/interview${iid ? `?id=${encodeURIComponent(iid)}` : ""}`);
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Something went wrong during setup.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo-dot" />
          <span className="brand-name">GlobalXperts</span>
          <span className="brand-sub">Pre-Interview Setup</span>
        </div>
      </header>

      <main className="container">
        <section className="card">
          <div className="left">
            <div className="video-surface">
              <video ref={videoRef} playsInline muted className="video" />
              {!isTesting ? (
                <button className="btn primary floating" type="button" onClick={startTest}>
                  Start camera & mic test
                </button>
              ) : (
                <button className="btn subtle floating" type="button" onClick={stopTest}>
                  Stop test
                </button>
              )}
              <div className="soft-shine" />
            </div>

            <div className="meter">
              <div className="fill" style={{ width: `${Math.round(audioLevel * 100)}%` }} />
            </div>

            <div className="status">
              <StatusPill ok={camOk} label="Camera" />
              <StatusPill ok={micOk} label="Mic" />
            </div>

            {permError && <div className="banner error">{permError}</div>}
            <p className="hint">Speak “testing 1-2-3” — the bar should pulse.</p>
          </div>

          <form className="right" onSubmit={onSubmit}>
            <h2>Candidate details</h2>

            {/* floating labels */}
            <div className="field">
              <input
                id="fullName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder=" " // keep space for :placeholder-shown
                autoComplete="name"
                required
              />
              <label htmlFor="fullName">Full name</label>
            </div>

            <div className="field">
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder=" "
                autoComplete="email"
                required
              />
              <label htmlFor="email">Email</label>
            </div>

            <div className="field file">
              <input
                id="resume"
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setResume(e.target.files?.[0] || null)}
                required
              />
              <label htmlFor="resume">Resume (.pdf, .doc, .docx)</label>
            </div>

            {submitError && <div className="banner error">{submitError}</div>}

            <div className="actions">
              <button className="btn primary" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit & continue"}
              </button>
            </div>

            <p className="privacy">We only use this info for this interview. Your files are stored securely.</p>
          </form>
        </section>
      </main>
    </div>
  );
}
