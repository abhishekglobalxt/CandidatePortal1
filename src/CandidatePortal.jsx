// CandidatePortal.jsx
import gxLogo from "./assets/globalxperts-logo.png";
import { useEffect, useMemo, useRef, useState } from "react";

/** ================== ENV / CONFIG ================== **/
const INTERVIEWS_API =
  import.meta.env.VITE_INTERVIEWS_API ||
  "https://hirexpert-1ecv.onrender.com/api/interviews";
const UPLOAD_WEBHOOK = import.meta.env.VITE_UPLOAD_WEBHOOK; // https://n8n…/webhook/candidate-upload

const VIDEO_CONSTRAINTS = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

const BITRATES = { videoBitsPerSecond: 2_800_000, audioBitsPerSecond: 128_000 };
const WARNING_AUTOHIDE_MS = 3500;

const progressKey = (iid, cid) => `hirexpert_progress_${iid || "na"}_${cid || "na"}`;

/** ================== Small UI helpers (no layout change) ================== **/
function Header({ title, current, total }) {
  const pct = total ? Math.round((current / total) * 100) : 0;
  return (
    <header className="hx-header">
      <div className="hx-header-inner">
        <div className="hx-brand">
          <img className="hx-logo" src={gxLogo} alt="GlobalXperts logo" />
        </div>
        <div className="hx-head-center">
          <div className="hx-title">{title || "Loading…"}</div>
          <div className="hx-overall">
            <div className="hx-overall-text">Progress: {pct}%</div>
            <div className="hx-overall-bar"><div className="hx-overall-fill" style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
        <div className="hx-head-right">
          <span className="hx-help" title="Stay in fullscreen, keep your face visible, and avoid switching tabs.">?</span>
        </div>
      </div>
    </header>
  );
}
function Card({ children }) { return <div className="hx-card">{children}</div>; }
function Chip({ children, tone = "neutral" }) { return <span className={`hx-chip ${tone}`}>{children}</span>; }
function ProctorBanner({ message, onClose }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => { const t = setTimeout(() => setVisible(false), WARNING_AUTOHIDE_MS); return () => clearTimeout(t); }, []);
  useEffect(() => { if (!visible) { const t = setTimeout(onClose, 400); return () => clearTimeout(t); } }, [visible, onClose]);
  return (
    <div aria-live="polite" style={{ position: "fixed", right: 16, top: 16, zIndex: 1000, transform: visible ? "translateX(0)" : "translateX(120%)", transition: "transform 0.35s ease", maxWidth: 360 }}>
      <div className="hx-card" style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.18)", borderLeft: "4px solid #F59E0B" }}>
        <div style={{ padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Proctoring notice</div>
          <div style={{ fontSize: 14, opacity: 0.9 }}>{message}</div>
        </div>
      </div>
    </div>
  );
}

/** ================== Main Component ================== **/
export default function CandidatePortal() {
  /** -------- Session guard -------- **/
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const interviewIdParam = params.get("id") || "";
    const setup = sessionStorage.getItem("gx_candidate");
    if (!setup) window.location.replace(`/setup${interviewIdParam ? `?id=${encodeURIComponent(interviewIdParam)}` : ""}`);
  }, []);

  const params = new URLSearchParams(window.location.search);
  const interviewId = params.get("id") || "";

  const candidate = useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem("gx_candidate") || "{}"); }
    catch { return {}; }
  }, []);

  /** -------- Data state -------- **/
  const [loading, setLoading] = useState(true);
  const [interview, setInterview] = useState(null);
  const [error, setError] = useState("");

  /** -------- Flow state -------- **/
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState("question"); // question | review | uploading | done
  const total = interview?.questions?.length || 0;
  const currentQ = interview?.questions?.[idx] || null;

  /** -------- Media & recorder -------- **/
  const videoEl = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const isStartingRef = useRef(false); // debounce start
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [permError, setPermError] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);

  /** -------- Proctoring -------- **/
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [answerMeta, setAnswerMeta] = useState({}); // { qid: { warnings:[{type,ts}] } }
  const [banners, setBanners] = useState([]);
  const pushBanner = (msg) => setBanners((b) => [...b, { id: Math.random().toString(36).slice(2), message: msg }]);
  const removeBanner = (id) => setBanners((b) => b.filter((x) => x.id !== id));

  const addWarning = (reason) => {
    const qid = (interview?.questions?.[idx]?.id) || `q${idx + 1}`;
    setAnswerMeta((prev) => {
      const next = { ...prev };
      const entry = next[qid] || { warnings: [] };
      entry.warnings = [...entry.warnings, { type: reason, ts: Date.now() }];
      next[qid] = entry;
      return next;
    });
    if (["visibility", "blur", "fs-exit"].includes(reason)) setTabSwitchCount((n) => n + 1);
    pushBanner(
      reason === "visibility" ? "We detected a tab/app switch. Please stay focused on the interview."
    : reason === "blur"       ? "Window focus lost. Please return to the interview."
    : reason === "fs-exit"    ? "Fullscreen was exited. Please stay in fullscreen."
    : reason === "multiple-faces" ? "Multiple faces detected. Continue solo to avoid flags."
    : reason === "no-face"    ? "No face detected. Please stay in frame."
    : "Session policy warning."
    );
  };
  const getTotalWarningCount = (meta) => Object.values(meta || {}).reduce((s, m) => s + (m?.warnings?.length || 0), 0);

  /** ================== Fetch questions ================== **/
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true); setError("");

        let item = null;
        try {
          const res1 = await fetch(`${INTERVIEWS_API.replace(/\/$/, "")}/${encodeURIComponent(interviewId)}`);
          if (res1.ok) item = await res1.json();
        } catch {}

        if (!item) {
          const res2 = await fetch(INTERVIEWS_API);
          if (!res2.ok) throw new Error(`API ${res2.status}`);
          const list = await res2.json();
          item = Array.isArray(list) ? list.find(i => i.id === interviewId) : null;
        }
        if (!item) throw new Error("Interview not found");

        const qs = (item.questions || []).map((q, i) => ({
          id: `q${i + 1}`,
          text: q?.text || q,
          timeLimit: item.time_limits?.[i] ?? item.timeLimits?.[i] ?? q?.timeLimit ?? 120,
        }));

        if (cancelled) return;
        setInterview({ interviewId: item.id, title: item.title || "Interview", questions: qs });
        setTimeLeft(qs[0]?.timeLimit || 120);

        // restore progress
        try {
          const raw = localStorage.getItem(progressKey(item.id, candidate?.candidateId || candidate?.id));
          if (raw) {
            const saved = JSON.parse(raw);
            if (Number.isInteger(saved.currentIndex)) {
              const safeIndex = Math.max(0, Math.min(qs.length - 1, saved.currentIndex));
              setIdx(safeIndex);
              setTimeLeft(qs[safeIndex]?.timeLimit ?? 120);
            }
            if (typeof saved.tabSwitchCount === "number") setTabSwitchCount(saved.tabSwitchCount);
            if (saved.answerMeta && typeof saved.answerMeta === "object") setAnswerMeta(saved.answerMeta);
          }
        } catch {}
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Couldn’t load interview. Check your link and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [interviewId, candidate]);

  /** persist progress */
  useEffect(() => {
    if (!interview?.interviewId) return;
    try {
      localStorage.setItem(
        progressKey(interview.interviewId, candidate?.candidateId || candidate?.id),
        JSON.stringify({ currentIndex: idx, tabSwitchCount, answerMeta, savedAt: Date.now() })
      );
    } catch {}
  }, [interview?.interviewId, candidate, idx, tabSwitchCount, answerMeta]);

  /** ================== Fullscreen on entry with gesture fallback ================== **/
  useEffect(() => {
    const enterFs = async () => {
      try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); }
      catch { /* likely needs gesture */ }
    };
    enterFs();

    const onFs = () => { if (!document.fullscreenElement) addWarning("fs-exit"); };
    document.addEventListener("fullscreenchange", onFs);

    // If FS failed on mount, request it on first user gesture
    const onFirstGesture = async () => {
      if (!document.fullscreenElement) {
        try { await document.documentElement.requestFullscreen(); } catch {}
      }
      window.removeEventListener("pointerdown", onFirstGesture);
    };
    window.addEventListener("pointerdown", onFirstGesture, { once: true });

    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("pointerdown", onFirstGesture);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ================== Proctoring events ================== **/
  useEffect(() => {
    const onVis = () => { if (document.visibilityState !== "visible") addWarning("visibility"); };
    const onBlur = () => addWarning("blur");
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("visibilitychange", onVis); window.removeEventListener("blur", onBlur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, interview?.interviewId]);

  /** ================== Preview lifecycle (robust) ================== **/
  const tracksEnded = (s) => !s || s.getTracks().every(t => t.readyState === "ended");

  const ensurePreview = async () => {
    // start or repair the stream
    if (!streamRef.current || tracksEnded(streamRef.current)) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: AUDIO_CONSTRAINTS });
        streamRef.current = s;
      } catch (err) {
        console.error(err);
        setPermError("Camera/mic blocked. Allow permissions in your browser and refresh.");
        return false;
      }
    }

    // attach to element
    if (videoEl.current && videoEl.current.srcObject !== streamRef.current) {
      videoEl.current.srcObject = streamRef.current;
    }

    // try play with retries & gesture fallback
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      try {
        videoEl.current.muted = true;
        videoEl.current.playsInline = true;
        if (videoEl.current.readyState < 2) {
          await new Promise(r => setTimeout(r, 120)); // wait for metadata
        }
        await videoEl.current.play();
        return true;
      } catch {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    // final fallback: arm one-time gesture
    const onGesture = async () => {
      try { await videoEl.current.play(); } catch {}
      window.removeEventListener("pointerdown", onGesture);
    };
    window.addEventListener("pointerdown", onGesture, { once: true });
    return false;
  };

  useEffect(() => {
    ensurePreview();
    return () => {
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // nudge preview when interview/question changes (covers fresh mounts)
  useEffect(() => {
    if (streamRef.current && videoEl.current && videoEl.current.paused) {
      (async () => {
        try {
          videoEl.current.muted = true;
          videoEl.current.playsInline = true;
          await videoEl.current.play();
        } catch {}
      })();
    }
  }, [interview?.interviewId, idx]);

  /** ================== Recording ================== **/
  const pickMime = () => {
    const choices = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4;codecs=h264,aac" // Safari fallback
    ];
    for (const m of choices) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return "video/webm";
  };

  const startRecording = async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    try {
      if (!currentQ) return;

      // make sure preview is alive before recorder
      const ok = await ensurePreview();
      if (!ok || !streamRef.current || tracksEnded(streamRef.current)) {
        pushBanner("Unable to start camera/mic. Check permissions.");
        return;
      }

      const mimeType = pickMime();
      const mr = new MediaRecorder(streamRef.current, {
        mimeType,
        videoBitsPerSecond: BITRATES.videoBitsPerSecond,
        audioBitsPerSecond: BITRATES.audioBitsPerSecond
      });

      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType || "video/webm" });
        setRecordedBlob(blob);

        // switch to playback
        if (videoEl.current) {
          videoEl.current.pause();
          videoEl.current.srcObject = null;
          const url = URL.createObjectURL(blob);
          setRecordingUrl(url);
          videoEl.current.src = url;
          videoEl.current.muted = false;
          await videoEl.current.play().catch(() => {});
        }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        setIsRecording(false);
        setStage("review");
      };

      setRecordedBlob(null);
      URL.revokeObjectURL(recordingUrl);
      setRecordingUrl("");

      setIsRecording(true);
      setTimeLeft(currentQ.timeLimit || 120);
      recorderRef.current = mr;
      mr.start(3000); // chunked
    } finally {
      isStartingRef.current = false;
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state === "recording") recorderRef.current.stop();
  };

  useEffect(() => {
    if (!isRecording) return;
    if (timeLeft <= 0) { stopRecording(); return; }
    const t = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [isRecording, timeLeft]);

  /** ================== Save & Upload ================== **/
  const saveLocalProgress = (nextIndex = idx) => {
    if (!interview?.interviewId) return;
    try {
      localStorage.setItem(
        progressKey(interview.interviewId, candidate?.candidateId || candidate?.id),
        JSON.stringify({ currentIndex: nextIndex, tabSwitchCount, answerMeta, savedAt: Date.now() })
      );
    } catch {}
  };

  const uploadAnswer = async () => {
    if (!UPLOAD_WEBHOOK) { alert("Upload webhook is not configured."); return; }
    if (!recordedBlob || !currentQ || !interview) return;

    setStage("uploading");

    const token = candidate.candidateId || candidate.candidate_token || candidate.candidate_id || "";
    const ext = recordedBlob.type.includes("mp4") ? "mp4" : "webm";
    const filePath = `${interview.interviewId}/${currentQ.id}.${ext}`;

    const thisQWarnings = answerMeta[currentQ.id]?.warnings || [];
    const totalWarnings = getTotalWarningCount(answerMeta);

    const form = new FormData();
    form.append("interview_id", interview.interviewId);
    form.append("question_id", currentQ.id);
    form.append("candidate_token", token);
    form.append("file_path", filePath);
    form.append("mimeType", recordedBlob.type || "video/webm");
    form.append("userAgent", navigator.userAgent);
    form.append("tab_switch_count", String(tabSwitchCount));
    form.append("total_warnings", String(totalWarnings));
    form.append("question_warning_count", String(thisQWarnings.length));
    form.append("warnings_json", JSON.stringify(thisQWarnings));
    form.append("file", recordedBlob, `${currentQ.id}.${ext}`);

    try {
      const res = await fetch(UPLOAD_WEBHOOK, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

      const next = idx + 1;
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      setRecordedBlob(null); setRecordingUrl("");

      if (next < total) {
        setIdx(next);
        saveLocalProgress(next);
        await ensurePreview();
        setStage("question");
        setTimeLeft(interview.questions[next]?.timeLimit ?? 120);
      } else {
        saveLocalProgress(next);
        if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
        setStage("done");
      }
    } catch (e) {
      console.error(e);
      alert("Upload failed. Please try again.");
      setStage("review");
    }
  };

  /** ================== Keyboard shortcuts ================== **/
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space" && stage === "question") { e.preventDefault(); if (!isRecording) startRecording(); else stopRecording(); }
      if (e.code === "Enter" && stage === "review") { e.preventDefault(); uploadAnswer(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, isRecording, recordedBlob, currentQ]);

  /** ================== UI ================== **/
  const pctThisQ = currentQ ? Math.max(0, Math.min(100, (timeLeft / (currentQ.timeLimit || 1)) * 100)) : 0;

  return (
    <div className="hx-root">
      <Header title={interview?.title} current={idx} total={total} />

      <main className="hx-main">
        {/* LEFT RAIL */}
        <aside className="hx-rail">
          <div className="hx-rail-head">Questions</div>
          <ol className="hx-steps" aria-label="Interview questions list">
            {Array.from({ length: total }).map((_, i) => (
              <li key={i} className={`hx-step ${i < idx ? "done" : ""} ${i === idx ? "current" : ""}`}>
                <span className="hx-step-dot" />
                <span className="hx-step-text">Question {i + 1}</span>
              </li>
            ))}
          </ol>
          <div className="hx-rail-note">Stay in fullscreen while answering.</div>
          <div className="hx-rail-note">Tab switches: <strong>{tabSwitchCount}</strong></div>
          <div className="hx-rail-note">Total warnings: <strong>{getTotalWarningCount(answerMeta)}</strong></div>
        </aside>

        {/* CONTENT */}
        <section className="hx-content">
          {loading && <Card><div className="hx-skel-title" /><div className="hx-skel-media" /><div className="hx-skel-actions" /></Card>}
          {!loading && error && <Card><div className="hx-error">{error}</div></Card>}

          {!loading && interview && currentQ && stage !== "done" && (
            <Card>
              <div className="hx-card-head">
                <div className="hx-question-index">Question {idx + 1} of {total}</div>
                <div className="hx-chips">
                  <Chip tone="neutral">Time limit: {currentQ.timeLimit}s</Chip>
                  {isRecording && <Chip tone="danger"><span className="hx-dot" /> Recording</Chip>}
                </div>
              </div>

              <div className="hx-question">{currentQ.text}</div>

              <div className="hx-progress"><div className="hx-progress-fill" style={{ width: `${pctThisQ}%` }} /></div>

              <div className="hx-media">
                <video
                  ref={videoEl}
                  className="hx-video"
                  playsInline
                  autoPlay={stage === "question"}
                  muted={stage === "question"}
                  controls={stage === "review"}
                  aria-label={stage === "question" ? "Camera preview" : "Review your recording"}
                />
                {permError && <div className="hx-perm">{permError}</div>}
                {!isRecording && !recordingUrl && stage === "question" && (
                  <div className="hx-play-overlay">
                    <button className="hx-btn" onClick={startRecording}>Start</button>
                  </div>
                )}
              </div>

              <div className="hx-controls" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div className="hx-timer">
                  {stage === "question" && (isRecording ? <>Time left: <b>{timeLeft}s</b></> : <>Ready to record</>)}
                </div>
                <div className="hx-actions" style={{ marginLeft: "auto" }}>
                  {stage === "question" && isRecording && (
                    <button className="hx-btn danger" onClick={stopRecording} aria-label="Stop recording (Space)">Stop</button>
                  )}
                  {stage === "review" && (
                    <>
                      <button className="hx-btn" onClick={uploadAnswer} aria-label="Upload (Enter)">Looks good — Upload</button>
                      <button className="hx-btn ghost" onClick={async () => {
                        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
                        setRecordedBlob(null); setRecordingUrl("");
                        await ensurePreview(); setStage("question");
                      }}>Re-record</button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          )}

          {stage === "done" && <Card><div className="hx-done">🎉 All set! Thanks for completing the interview.</div></Card>}
        </section>
      </main>

      {banners.map((b) => <ProctorBanner key={b.id} message={b.message} onClose={() => removeBanner(b.id)} />)}
    </div>
  );
}
