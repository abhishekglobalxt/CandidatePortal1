// src/SetupPortal.jsx
import { useEffect, useRef, useState } from "react";
import "./App.css";

const SETUP_WEBHOOK = import.meta.env.VITE_SETUP_WEBHOOK;

function useQuery() {
  const p = new URLSearchParams(window.location.search);
  return Object.fromEntries(p.entries());
}

function Pill({ ok, label }) {
  return (
    <span className={`gx-pill ${ok ? "ok" : ""}`}>
      <span className="dot" />
      <span>{label}</span>
    </span>
  );
}

export default function SetupPortal() {
  const { token } = useQuery();

  // basic secure link validation
  const [interviewId, setInterviewId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linkError, setLinkError] = useState("");

  // camera/mic refs
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const dataArrayRef = useRef(null);

  // UI state for test
  const [isTesting, setIsTesting] = useState(false);
  const [permError, setPermError] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [camOk, setCamOk] = useState(false);
  const [micOk, setMicOk] = useState(false);

  // form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  // resume upload state
  const [resumeFile, setResumeFile] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // -------- Validate token & fetch interview --------
  useEffect(() => {
    const validate = async () => {
      if (!token) {
        setLinkError("Missing or invalid link.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(
          `https://hirexpert-1ecv.onrender.com/api/setup?token=${token}`,
          { mode: "cors" }
        );

        const raw = await res.text();
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = { error: "Invalid response from server" };
        }

        if (!res.ok || !data.interviewId) {
          const reason = data.error || "unknown";
          setLinkError(
            reason === "expired"
              ? "This interview link has expired."
              : "We could not validate your interview link."
          );
          setLoading(false);
          return;
        }

        setInterviewId(data.interviewId);
        sessionStorage.setItem("gx_interview_id", data.interviewId);
        if (data.candidateEmail) {
          sessionStorage.setItem("gx_candidate_email", data.candidateEmail);
          setEmail(data.candidateEmail);
        }
      } catch (err) {
        console.error(err);
        setLinkError("Unable to validate link. Please try again in a moment.");
      } finally {
        setLoading(false);
      }
    };

    validate();
  }, [token]);

  // -------- Camera & mic test --------
  const stopTest = () => {
    try {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    } catch (e) {
      console.error("Error stopping test", e);
    } finally {
      setIsTesting(false);
      setAudioLevel(0);
      setCamOk(false);
      setMicOk(false);
    }
  };

  const startTest = async () => {
    setPermError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();
      setCamOk(videoTracks.length > 0);
      setMicOk(audioTracks.length > 0);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          // ignore autoplay issues
        }
      }

      // audio meter
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyserRef.current = analyser;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.fftSize);
      dataArrayRef.current = dataArray;

      const tick = () => {
        if (!analyserRef.current || !dataArrayRef.current) return;
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

      setIsTesting(true);
      tick();
    } catch (err) {
      console.error(err);
      setPermError(
        "We couldn’t access your camera/mic. Please allow permissions and try again."
      );
      stopTest();
    }
  };

  useEffect(() => {
    return () => {
      stopTest();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- Submit handler --------
  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");

    if (!name.trim() || !email.trim()) {
      return setSubmitError("Please enter your name and email.");
    }

    if (!resumeFile) {
      return setSubmitError("Please upload your resume.");
    }

    const okExt = [".pdf", ".doc", ".docx"].some((ext) =>
      resumeFile.name.toLowerCase().endsWith(ext)
    );
    if (!okExt) {
      return setSubmitError(
        "Resume must be a PDF or Word document (.doc or .docx)."
      );
    }

    if (!camOk || !micOk) {
      return setSubmitError("Please complete the camera & mic test.");
    }

    if (!SETUP_WEBHOOK) {
      return setSubmitError("Setup webhook is not configured.");
    }

    setSubmitting(true);
    try {
      const iid = interviewId;

      const form = new FormData();
      form.append("name", name);
      form.append("email", email);
      form.append("interview_id", iid);
      form.append("cam_ok", String(camOk));
      form.append("mic_ok", String(micOk));
      form.append("user_agent", navigator.userAgent);

      // resume field for n8n
      form.append("resume", resumeFile, resumeFile.name);

      const res = await fetch(SETUP_WEBHOOK, {
        method: "POST",
        body: form,
      });

      let payload = {};
      try {
        payload = await res.json();
      } catch (_) {
        payload = {};
      }

      if (!res.ok || payload.ok === false) {
        const msg =
          payload.message ||
          payload.error ||
          "Setup failed on the server. Please contact support.";
        throw new Error(msg);
      }

      const candidateId =
        payload.candidateId || payload.candidate_id || payload.id || null;

      if (!candidateId) {
        throw new Error(
          "Setup succeeded but no candidateId was returned. Please contact support."
        );
      }

      sessionStorage.setItem(
        "gx_candidate",
        JSON.stringify({ candidateId, name, email })
      );
      sessionStorage.setItem("gx_interview_id", iid);

      const nextUrl = `/interview?id=${encodeURIComponent(
        iid
      )}&token=${encodeURIComponent(token)}`;
      window.location.assign(nextUrl);
    } catch (err) {
      console.error(err);
      setSubmitError(
        err.message || "Something went wrong during setup. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="gx-page">
      {loading ? (
        <p>Validating your secure link…</p>
      ) : linkError ? (
        <div className="gx-error-page">
          <h1>Link problem</h1>
          <p>{linkError}</p>
        </div>
      ) : (
        <>
          <header className="gx-header">
            <div className="gx-logo-row">
              <img
                src="/globalxperts-logo.png"
                alt="GlobalXperts"
                className="gx-logo"
              />
              <span className="brand-name">GlobalXperts</span>
              <span className="brand-sub">Pre-interview check</span>
            </div>
          </header>

          <main className="gx-container">
            <section className="gx-card">
              {/* LEFT: camera & mic */}
              <div className="gx-left">
                <h2>Check your camera &amp; mic</h2>
                <p className="gx-sub">
                  We’ll quickly verify that your camera and microphone are
                  working properly.
                </p>

                <div className="gx-video-surface">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay={false}
                    className="gx-video"
                  />
                  <div className="gx-soft-shine" />
                </div>

                {/* actions under video, non-floating */}
                <div className="gx-actions-left">
                  {!isTesting ? (
                    <button
                      className="gx-btn primary"
                      type="button"
                      onClick={startTest}
                    >
                      Start camera &amp; mic test
                    </button>
                  ) : (
                    <button
                      className="gx-btn secondary"
                      type="button"
                      onClick={stopTest}
                    >
                      Stop test
                    </button>
                  )}
                </div>

                <div className="gx-meter">
                  <div
                    className="fill"
                    style={{ width: `${Math.round(audioLevel * 100)}%` }}
                  />
                </div>

                <div className="gx-status">
                  <Pill ok={camOk} label="Camera" />
                  <Pill ok={micOk} label="Mic" />
                </div>

                {permError && <div className="gx-banner error">{permError}</div>}
                <p className="gx-hint">
                  Speak “testing 1-2-3” — the bar should pulse when your mic is
                  working.
                </p>
              </div>

              {/* RIGHT: candidate + resume */}
              <form className="gx-right" onSubmit={onSubmit}>
                <h2>Before you start, we need a quick check</h2>
                <p className="gx-sub">
                  Please confirm your details and upload your latest resume.
                </p>

                <div className="gx-field">
                  <input
                    id="fullName"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder=" "
                    autoComplete="name"
                    required
                  />
                  <label htmlFor="fullName">Full name</label>
                </div>

                <div className="gx-field">
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

                <div className="gx-field file">
                  <label htmlFor="resume">
                    Upload your resume (PDF / DOC / DOCX)
                  </label>
                  <input
                    id="resume"
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(e) =>
                      setResumeFile(e.target.files?.[0] || null)
                    }
                    required
                  />
                </div>

                {submitError && (
                  <div className="gx-banner error">{submitError}</div>
                )}

                <div className="gx-actions gx-actions-right">
                  <button className="gx-btn primary" disabled={submitting}>
                    {submitting ? "Submitting…" : "Submit & continue"}
                  </button>
                </div>

                <p className="gx-privacy">
                  We only use this info and your resume for this interview. Your
                  data is stored securely.
                </p>
              </form>
            </section>
          </main>
        </>
      )}
    </div>
  );
}
