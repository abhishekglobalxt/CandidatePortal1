// src/SetupPortal.jsx
import { useEffect, useRef, useState } from "react";
import "./App.css";

const SETUP_WEBHOOK = import.meta.env.VITE_SETUP_WEBHOOK;

// OPTIONAL: if you prefer, move this URL to an env var like VITE_GEOIP_URL
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
  const { id: interviewIdParam = "" } = useQuery();

  // persist id for handoff
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

  // NEW: KYC / verification doc state
  const [countryCode, setCountryCode] = useState("");              // e.g. "IN"
  const [geoError, setGeoError] = useState("");
  const [docType, setDocType] = useState("");                      // "aadhaar" | "passport" | "driving_license"
  const [docFile, setDocFile] = useState(null);                    // File
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // --- GeoIP: detect country based on IP and pre-configure docType ---
  useEffect(() => {
    let cancelled = false;
    const detectCountry = async () => {
      try {
        const res = await fetch(GEOIP_URL);
        if (!res.ok) throw new Error("GeoIP request failed");
        const data = await res.json();
        if (cancelled) return;
        const cc = (data.country_code || "").toUpperCase();
        setCountryCode(cc || "");
        // If India, default docType to Aadhaar
        if (cc === "IN") {
          setDocType("aadhaar");
        }
      } catch (err) {
        console.error("GeoIP error", err);
        if (!cancelled) {
          setGeoError("We could not automatically detect your region. Please select an ID type manually.");
        }
      }
    };
    detectCountry();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Camera & mic test logic (unchanged) ---

  const startTest = async () => {
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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      setCamOk(!!videoTrack);
      setMicOk(!!audioTrack);

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      source.connect(analyser);
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = dataArray[i] / 128 - 1.0;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(1, Math.max(0, rms * 4));
        setAudioLevel(level);
        if (level > 0.03) {
          setMicOk(true);
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      setIsTesting(true);
      tick();
    } catch (err) {
      console.error(err);
      setPermError(
        "We couldn’t access your camera or microphone. Please allow permissions in your browser and try again."
      );
      stopTest();
    }
  };

  const stopTest = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (analyserRef.current && audioCtxRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {}
      try {
        audioCtxRef.current.close();
      } catch {}
    }
    analyserRef.current = null;
    audioCtxRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsTesting(false);
    setAudioLevel(0);
    setCamOk(false);
    setMicOk(false);
  };

  useEffect(() => () => stopTest(), []);

  // --- Submit handler with new verification logic ---

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
      return setSubmitError("Verification document must be a PDF or an image (JPG/PNG).");
    }

    if (!camOk || !micOk) {
      return setSubmitError("Please complete the camera & mic test.");
    }

    if (!SETUP_WEBHOOK) {
      return setSubmitError("Setup webhook is not configured.");
    }

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

      // NEW: pass region + verification doc info to n8n
      form.append("country_code", countryCode || "");
      form.append("verification_doc_type", docType);
      form.append("verification_document", docFile, docFile.name);

      const res = await fetch(SETUP_WEBHOOK, {
        method: "POST",
        body: form,
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        const msg = payload.message || payload.error || `Setup failed (${res.status})`;
        throw new Error(msg);
      }

      const candidateId = payload.candidateId || payload.candidate_id || payload.id || null;
      if (!candidateId) {
        throw new Error("Setup succeeded but no candidateId was returned.");
      }

      sessionStorage.setItem(
        "gx_candidate",
        JSON.stringify({ candidateId, name, email })
      );
      sessionStorage.setItem("gx_interview_id", iid);

      const nextUrl = `/interview?id=${encodeURIComponent(iid)}`;
      window.location.assign(nextUrl);
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Could not submit setup. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // --- Derived UI labels ---

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
          <div>
            <div className="brand-name">HireXpertz</div>
            <div className="brand-sub">Pre-interview check</div>
          </div>
        </div>
      </header>

      <main className="gx-container">
        <section className="gx-card">
          <div className="gx-left">
            <h2>Check your camera & mic</h2>
            <p className="gx-sub">
              We’ll quickly verify that your camera and microphone are working properly.
            </p>

            <div className="gx-video-surface">
              <div className="gx-soft-shine" />
              <video
                ref={videoRef}
                className="gx-video"
                autoPlay
                muted
                playsInline
              />
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

            <div className="gx-actions">
              {!isTesting ? (
                <button className="gx-btn primary" type="button" onClick={startTest}>
                  Start camera & mic test
                </button>
              ) : (
                <button className="gx-btn subtle" type="button" onClick={stopTest}>
                  Stop test
                </button>
              )}
            </div>
          </div>

          <form className="gx-right" onSubmit={onSubmit}>
            <h2>Before you start, we need a quick verification</h2>
            <p className="gx-sub">
              Please confirm your details and upload a valid ID as per your region.
            </p>

            <div className="gx-field">
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder=" "
                autoComplete="name"
                required
              />
              <label htmlFor="name">Full name</label>
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

            {/* NEW: Show doc type dropdown for non-India or when geo fails */}
            {!isIndia && (
              <div className="gx-field">
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
                <label htmlFor="verification_type">Verification document type</label>
              </div>
            )}

            {geoError && <div className="gx-banner error">{geoError}</div>}

            {/* File field — dynamic label */}
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

            {submitError && <div className="gx-banner error">{submitError}</div>}

            <div className="gx-actions">
              <button className="gx-btn primary" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit & continue"}
              </button>
            </div>

            <p className="gx-privacy">
              We only use this info and verification document for this interview. Your data is stored securely.
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
