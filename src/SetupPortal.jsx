import { useEffect, useRef, useState } from "react";
import "./App.css"; // new css file

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

  // refs
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const dataArrayRef = useRef(null);

  // states
  const [isTesting, setIsTesting] = useState(false);
  const [permError, setPermError] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [camOk, setCamOk] = useState(false);
  const [micOk, setMicOk] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [resume, setResume] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const startTest = async () => {
    setPermError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
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
        setAudioLevel(Math.min(1, rms * 4));
        if (rms > 0.03) setMicOk(true);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setPermError("Camera or microphone access denied. Allow permissions and retry.");
    }
  };

  const stopTest = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (audioCtxRef.current) audioCtxRef.current.close();
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    setIsTesting(false);
    setAudioLevel(0);
    setCamOk(false);
    setMicOk(false);
  };

  useEffect(() => () => stopTest(), []);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return setSubmitError("Enter name & email.");
    if (!resume) return setSubmitError("Attach resume.");
    if (!camOk || !micOk) return setSubmitError("Complete the camera & mic test.");

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("name", name);
      form.append("email", email);
      form.append("interview_id", interviewId);
      form.append("cam_ok", camOk);
      form.append("mic_ok", micOk);
      form.append("user_agent", navigator.userAgent);
      form.append("resume", resume, resume.name);

      const res = await fetch(SETUP_WEBHOOK, { method: "POST", body: form });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.message || "Setup failed.");

      sessionStorage.setItem(
        "gx_candidate",
        JSON.stringify({ candidateId: payload.candidateId, name, email })
      );
      sessionStorage.setItem("gx_interview_id", interviewId);

      window.location.assign(`/interview?id=${encodeURIComponent(interviewId)}`);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="gx-setup white">
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
              {!isTesting && <button className="gx-cta" onClick={startTest}>Start test</button>}
              {isTesting && <button className="gx-cta ghost" onClick={stopTest}>Stop test</button>}
            </div>

            <div className="gx-meter">
              <div className="gx-meter-fill" style={{ width: `${Math.round(audioLevel * 100)}%` }} />
            </div>

            <div className="gx-status">
              <StatusPill ok={camOk} label="Camera" />
              <StatusPill ok={micOk} label="Mic" />
            </div>

            {permError && <div className="gx-banner error">{permError}</div>}
          </div>

          <form className="gx-right" onSubmit={onSubmit}>
            <h2>Candidate Details</h2>

            <div className="gx-field">
              <label>Full Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="gx-field">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="gx-field">
              <label>Resume</label>
              <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setResume(e.target.files[0])} />
            </div>

            {submitError && <div className="gx-banner error">{submitError}</div>}

            <button className="gx-primary" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit & Continue"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
