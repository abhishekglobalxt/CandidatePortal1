// src/SetupPortal.jsx
import { useEffect, useRef, useState } from "react";
import "./App.css";

const SETUP_WEBHOOK = import.meta.env.VITE_SETUP_WEBHOOK;

// simple client-side GeoIP (IP -> country)
const GEOIP_URL = "https://ipapi.co/json/";



function useQuery() {
  const p = new URLSearchParams(window.location.search);
  return Object.fromEntries(p.entries());
}

function Pill({ ok, label }) {
  return (
    <span className={`gx-pill ${ok ? "ok" : ""}`}>
      <span className="dot" />
      {label} {ok ? "ready" : "…"}
    </span>
  );
}

export default function SetupPortal() {
  const { token } = useQuery();
  const [interviewId, setInterviewId] = useState(null);
  const [loading, setLoading] = useState(true);

  // -------- Token validation & interview ID fetch --------
useEffect(() => {
  const validate = async () => {
    if (!token) {
      window.location.href = "/expired.html?reason=missing";
      return;
    }

    try {
      const res = await fetch(`/api/setup?token=${token}`);
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "TOKEN_EXPIRED")
          return (window.location.href = "/expired.html?reason=expired");
        if (data.error === "TOKEN_USED")
          return (window.location.href = "/expired.html?reason=used");
        if (data.error === "INVALID_TOKEN")
          return (window.location.href = "/expired.html?reason=invalid");

        return (window.location.href = "/expired.html?reason=unknown");
      }

      setInterviewId(data.interviewId);
      sessionStorage.setItem("gx_interview_id", data.interviewId);
      sessionStorage.setItem("gx_candidate_email", data.candidateEmail);

    } catch (e) {
      window.location.href = "/expired.html?reason=error";
    } finally {
      setLoading(false);
    }
  };

  validate();
}, [token]);

if (loading) {
  return <div className="gx-page"><p>Validating your secure link…</p></div>;
}

  // persist id for handoff to CandidatePortal
  useEffect(() => {
    if (interviewId) {
      sessionStorage.setItem("gx_interview_id", interviewId);
    }
  }, [interviewId]);

  // media / audio meter refs
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

  // verification doc state
  const [countryCode, setCountryCode] = useState(""); // e.g. "IN"
  const [geoError, setGeoError] = useState("");
  const [docType, setDocType] = useState(""); // "aadhaar" | "passport" | "driving_license"
  const [docFile, setDocFile] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // -------- GeoIP: detect country once on load --------
  useEffect(() => {
    let cancelled = false;

    const detectCountry = async () => {
      try {
        const res = await fetch(GEOIP_URL);
        if (!res.ok) throw new Error("GeoIP request failed");
        const data = await res.json();
        if (cancelled) return;

        const cc = (data.country_code || "").toUpperCase();
        setCountryCode(cc);
        if (cc === "IN") {
          setDocType("aadhaar");
        }
      } catch (err) {
        console.error("GeoIP error", err);
        if (!cancelled) {
          setGeoError(
            "We couldn’t automatically detect your region. Please select an ID type."
          );
        }
      }
    };

    detectCountry();

    return () => {
      cancelled = true;
    };
  }, []);

  // -------- Camera & mic test --------
  const startTest = async () => {
    if (isTesting) return; // guard against double-clicks
    setPermError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      setCamOk(stream.getVideoTracks().length > 0);
      setMicOk(stream.getAudioTracks().length > 0);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // autoplay can still be blocked, but we ignore the error and let user click inside video if needed
        await videoRef.current.play().catch(() => {});
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

  const stopTest = () => {
    // stop animation loop
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // close audio context
    try {
      analyserRef.current && analyserRef.current.disconnect();
    } catch {}
    try {
      audioCtxRef.current && audioCtxRef.current.close();
    } catch {}

    analyserRef.current = null;
    audioCtxRef.current = null;
    dataArrayRef.current = null;

    // stop media tracks
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;

    // clear video
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // reset state
    setIsTesting(false);
    setAudioLevel(0);
    setCamOk(false);
    setMicOk(false);
  };

  useEffect(() => {
    return () => {
      // cleanup on unmount
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

    if (!docType) {
      return setSubmitError("Please select the type of verification document.");
    }

    if (!docFile) {
      return setSubmitError("Please upload your verification document.");
    }

    const okExt = [".pdf", ".jpg", ".jpeg", ".png"].some((ext) =>
      docFile.name.toLowerCase().endsWith(ext)
    );
    if (!okExt) {
      return setSubmitError(
        "Verification document must be a PDF or an image (JPG/PNG)."
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

      // verification fields for n8n
      form.append("country_code", countryCode || "");
      form.append("verification_doc_type", docType);
      form.append("verification_document", docFile, docFile.name);

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
          payload?.message ||
          payload?.error ||
          `Setup failed (${res.status})`;
        throw new Error(msg);
      }

      const candidateId =
        payload.candidateId || payload.candidate_id || payload.id || null;

      if (!candidateId) {
        throw new Error("Setup succeeded but no candidateId was returned.");
      }

      sessionStorage.setItem(
        "gx_candidate",
        JSON.stringify({ candidateId, name, email })
      );
      sessionStorage.setItem("gx_interview_id", iid);

      const nextUrl = `/interview${
        iid ? `?id=${encodeURIComponent(iid)}` : ""
      }`;
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

  // -------- Derived UI text --------
  const isIndia = countryCode === "IN";
  const docLabel =
    isIndia || docType === "aadhaar"
      ? "Upload Aadhaar Card (PDF / JPG / PNG)"
      : docType === "passport"
      ? "Upload Passport (PDF / JPG / PNG)"
      : docType === "driving_license"
      ? "Upload Driving License (PDF / JPG / PNG)"
      : "Upload verification document (PDF / JPG / PNG)";

  return (
    <div className="gx-page">
      <header className="gx-topbar">
        <div className="brand">
          <span className="logo-dot" />
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
              We’ll quickly verify that your camera and microphone are working properly.
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
                  className="gx-btn subtle"
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
              Speak “testing 1-2-3” — the bar should pulse when your mic is working.
            </p>
          </div>

          {/* RIGHT: candidate + verification */}
          <form className="gx-right" onSubmit={onSubmit}>
            <h2>Before you start, we need a quick verification</h2>
            <p className="gx-sub">
              Please confirm your details and upload a valid ID as per your region.
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

            {/* Doc type selector for non-India users */}
            {!isIndia && (
              <div className="gx-field file">
                <label htmlFor="verification_type">Verification document type</label>
                <select
                  id="verification_type"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  required
                >
                  <option value="">Select ID type</option>
                  <option value="passport">Passport</option>
                  <option value="driving_license">Driving License</option>
                </select>
              </div>
            )}

            {geoError && <div className="gx-banner error">{geoError}</div>}

            {/* File upload only after docType is known */}
            {docType && (
              <div className="gx-field file">
                <label htmlFor="verification_document">{docLabel}</label>
                <input
                  id="verification_document"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                  required
                />
              </div>
            )}

            {submitError && <div className="gx-banner error">{submitError}</div>}

            <div className="gx-actions gx-actions-right">
              <button className="gx-btn primary" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit & continue"}
              </button>
            </div>

            <p className="gx-privacy">
              We only use this info and verification document for this interview. Your data is
              stored securely.
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
