import { useEffect, useRef, useState } from "react";
import "./App.css";

const SETUP_WEBHOOK = import.meta.env.VITE_SETUP_WEBHOOK;

function useQuery() {
  const p = new URLSearchParams(window.location.search);
  return Object.fromEntries(p.entries());
}

function StatusPill({ ok, label }) {
  return (
    <span className={`gx-pill ${ok ? "ok" : ""}`}>
      <span className="dot" />
      {label} {ok ? "ready" : "…"}
    </span>
  );
}

export default function SetupPortal() {
  const { id: interviewId = "" } = useQuery();

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

      // if tracks exist, pre-mark as OK
      setCamOk(stream.getVideoTracks().length > 0);
      setMicOk(stream.getAudioTracks().length > 0);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsTesting(true);

      // audio meter
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 1024;
      source.connect(analyserRef.current);
      dataArrayRef.current = new Uint8Array(analyserRef.current.fftSize);

      const tick = () => {
        const an = analyserRef.current;
        if (!an) return;
        an.getByteTimeDomainData(dataArrayRef.current);
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          const v = (dataArrayRef.current[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArrayRef.current.length);
        const lvl = Math.min(1, rms * 3.8); // 0..1-ish
        setAudioLevel(lvl);

        if (lvl > 0.03) setMicOk(true); // any voice activity confirms mic
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
    rafRef.current = null;
    if (analyserRef.current) { try { analyserRef.current.disconnect(); } catch {} }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} }
    analyserRef.current = null;
    audioCtxRef.current = null;
    const s = streamRef.current;
    if (s) s.getTracks().forEach(t => t.stop());
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
    const okExt = [".pdf", ".doc", ".docx"].some(ext => resume.name.toLowerCase().endsWith(ext));
    if (!okExt) return setSubmitError("Resume must be PDF or Word.");
    if (!camOk || !micOk) return setSubmitError("Please complete the camera & mic test.");

    if (!SETUP_WEBHOOK) return setSubmitError("Setup webhook is not configured.");

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("name", name);
      form.append("email", email);
      form.append("interview_id", interviewId);
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

      window.location.assign(`/interview?id=${encodeURIComponent(interviewId)}`);
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Something went wrong during setup.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="gx-setup">
      <header className="gx-setup-header">
        <div className="brand">
          <div className="logo-dot" />
          <span className="brand-name">GlobalXperts</span>
          <span className="brand-sub">Pre-Interview Setup</span>
        </div>
      </header>

      <main className="gx-setup-main">
        <section className="gx-shell">
          <div className="gx-left">
            <div className="gx-video-wrap">
              <video ref={videoRef} playsInline muted className="gx-video" />
              {!isTesting && (
                <button className="gx-cta" type="button" onClick={startTest}>
                  Start camera & mic test
                </button>
              )}
              {isTesting && (
                <button className="gx-cta ghost" type="button" onClick={stopTest}>
                  Stop test
                </button>
              )}
              <div className="gx-overlay-gradient" />
            </div>

            <div className="gx-meter">
              <div className="gx-meter-fill" style={{ width: `${Math.round(audioLevel * 100)}%` }} />
            </div>

            <div className="gx-status">
              <StatusPill ok={camOk} label="Camera" />
              <StatusPill ok={micOk} label="Mic" />
            </div>

            {permError && <div className="gx-banner error">{permError}</div>}
            <p className="gx-hint">Say “testing 1-2-3” or clap once — the bar should pulse.</p>
          </div>

          <form className="gx-right" onSubmit={onSubmit}>
            <h2>Tell us about you</h2>

            <div className="gx-field">
              <label>Full name</label>
              <input
                className="gx-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Jane Doe"
                required
              />
            </div>

            <div className="gx-field">
              <label>Email</label>
              <input
                className="gx-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="jane@domain.com"
                required
              />
            </div>

            <div className="gx-field">
              <label>Resume (.pdf, .doc, .docx)</label>
              <input
                className="gx-file"
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setResume(e.target.files?.[0] || null)}
                required
              />
            </div>

            {submitError && <div className="gx-banner error">{submitError}</div>}

            <div className="gx-actions">
              <button className="gx-primary" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit & continue"}
              </button>
            </div>

            <p className="gx-privacy">We only use this info for this interview. Your files are stored securely.</p>
          </form>
        </section>
      </main>
    </div>
  );
}
