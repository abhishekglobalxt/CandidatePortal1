// CandidatePortal.jsx
import gxLogo from "./assets/globalxperts-logo.png";
import { useEffect, useRef, useState } from "react";

const API_URL = "https://hirexpert-1ecv.onrender.com/api/interviews";
const N8N_UPLOAD_WEBHOOK =
  "https://n8n.srv958691.hstgr.cloud/webhook-test/candidate-upload";

/* ---------- Presentational bits ---------- */
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
            <div className="hx-overall-bar">
              <div className="hx-overall-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        <div className="hx-head-right">
          <span
            className="hx-help"
            title="Make sure you have a quiet, well-lit place. You can’t skip questions."
          >
            ?
          </span>
        </div>
      </div>
    </header>
  );
}

function Card({ children }) {
  return <div className="hx-card">{children}</div>;
}

function Chip({ children, tone = "neutral" }) {
  return <span className={`hx-chip ${tone}`}>{children}</span>;
}

/* ---------- Main component ---------- */
export default function CandidatePortal() {
  // Redirect to Setup if not completed
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const interviewIdParam = params.get("id") || "";
    const setup = sessionStorage.getItem("gx_candidate"); // set by SetupPortal after submit
    if (!setup) {
      window.location.replace(
        `/setup${interviewIdParam ? `?id=${encodeURIComponent(interviewIdParam)}` : ""}`
      );
    }
  }, []);

  // Read ?id=... from URL
  const params = new URLSearchParams(window.location.search);
  const interviewId = params.get("id") || "";

  // Data
  const [loading, setLoading] = useState(true);
  const [interview, setInterview] = useState(null);
  const [error, setError] = useState("");

  // Flow
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState("question"); // "question" | "review" | "uploading" | "done"

  // Media
  const previewRef = useRef(null);
  const playbackRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [recorder, setRecorder] = useState(null);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [permError, setPermError] = useState("");

  // Time
  const [timeLeft, setTimeLeft] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);

  // ===== Fetch interview =====
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error(`API ${res.status}`);
        const list = await res.json();

        const item = Array.isArray(list)
          ? list.find((i) => i.id === interviewId)
          : null;

        if (!item) throw new Error("Interview not found");

        const qs = item.questions.map((q, i) => ({
          id: `q${i + 1}`,
          text: q,
          timeLimit: item.time_limits?.[i] ?? item.timeLimits?.[i] ?? 120,
        }));

        setInterview({
          interviewId: item.id,
          title: item.title,
          allowRerecord: false,
          questions: qs,
        });

        setTimeLeft(qs[0].timeLimit);
      } catch (e) {
        console.error(e);
        setError("Couldn’t load interview. Check your link and try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [interviewId]);

  const total = interview?.questions?.length || 0;
  const currentQ = interview?.questions?.[idx] || null;
  const pctThisQ = currentQ
    ? Math.max(0, Math.min(100, (timeLeft / currentQ.timeLimit) * 100))
    : 0;

  // ===== Guard against closing tab =====
  useEffect(() => {
    const handler = (e) => {
      if (isRecording || (stage === "review" && recordingBlob)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isRecording, stage, recordingBlob]);

  // ===== Ask for camera =====
  useEffect(() => {
    if (stage !== "question") return;
    (async () => {
      setPermError("");
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        setStream(s);
        if (previewRef.current) {
          previewRef.current.srcObject = s;
          await previewRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.error(err);
        setPermError(
          "Camera/mic blocked. Allow permissions in your browser and refresh."
        );
      }
    })();

    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // ===== Countdown =====
  useEffect(() => {
    if (!isRecording) return;
    if (timeLeft <= 0) {
      stopRecording();
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [isRecording, timeLeft]);

  // ===== Shortcuts =====
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (stage === "question") {
          if (!isRecording) startRecording();
          else stopRecording();
        }
      }
      if (e.code === "Enter" && stage === "review") {
        uploadAnswer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, isRecording, recordingBlob]);

  // ===== Recording helpers =====
  function getMime() {
    const choices = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
    for (const m of choices) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    }
    return "video/webm";
  }

  function startRecording() {
    if (!stream || isRecording || !currentQ) return;
    const mimeType = getMime();
    const mr = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks = [];
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setRecordingBlob(blob);
      setRecordingUrl(url);
      setIsRecording(false);
      setStage("review");
    };
    mr.start();
    setRecorder(mr);
    setIsRecording(true);
    setTimeLeft(currentQ.timeLimit);
  }

  function stopRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function discardAndRetry() {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingBlob(null);
    setRecordingUrl("");
    setStage("question");
  }

  async function uploadAnswer() {
    if (!recordingBlob || !currentQ || !interview) return;
    setStage("uploading");
    setUploadPct(10);

    const ext = recordingBlob.type.includes("mp4") ? "mp4" : "webm";
    const filePath = `${interview.interviewId}/${currentQ.id}.${ext}`;

    const form = new FormData();
    form.append("interview_id", interview.interviewId);
    form.append("question_id", currentQ.id);
    form.append("file_path", filePath);
    form.append("mimeType", recordingBlob.type || "video/webm");
    form.append("userAgent", navigator.userAgent);
    form.append("file", recordingBlob, `${currentQ.id}.${ext}`);

    try {
      const res = await fetch(N8N_UPLOAD_WEBHOOK, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      setUploadPct(100);

      const next = idx + 1;
      if (next < total) {
        setIdx(next);
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        setRecordingBlob(null);
        setRecordingUrl("");
        setStage("question");
        setTimeLeft(interview.questions[next].timeLimit);
      } else {
        setStage("done");
      }
    } catch (e) {
      console.error(e);
      alert("Upload failed. Please try again.");
      setStage("review");
    }
  }

  // ===== UI =====
  return (
    <div className="hx-root">
      <Header title={interview?.title} current={idx} total={total} />

      <main className="hx-main">
        <aside className="hx-rail">
          <div className="hx-rail-head">Questions</div>
          <ol className="hx-steps" aria-label="Interview questions list">
            {Array.from({ length: total }).map((_, i) => (
              <li
                key={i}
                className={`hx-step ${i < idx ? "done" : ""} ${
                  i === idx ? "current" : ""
                }`}
              >
                <span className="hx-step-dot" />
                <span className="hx-step-text">Question {i + 1}</span>
              </li>
            ))}
          </ol>
          <div className="hx-rail-note">You can’t skip or go back.</div>
        </aside>

        <section className="hx-content">
          {loading && (
            <Card>
              <div className="hx-skel-title" />
              <div className="hx-skel-media" />
              <div className="hx-skel-actions" />
            </Card>
          )}

          {!loading && error && (
            <Card>
              <div className="hx-error">{error}</div>
            </Card>
          )}

          {!loading && interview && currentQ && (
            <Card>
              <div className="hx-card-head">
                <div className="hx-question-index">
                  Question {idx + 1} of {total}
                </div>
                <div className="hx-chips">
                  <Chip tone="neutral">Time limit: {currentQ.timeLimit}s</Chip>
                  {isRecording && (
                    <Chip tone="danger">
                      <span className="hx-dot" /> Recording
                    </Chip>
                  )}
                </div>
              </div>

              <div className="hx-question">{currentQ.text}</div>

              <div className="hx-progress">
                <div
                  className="hx-progress-fill"
                  style={{ width: `${pctThisQ}%` }}
                />
              </div>

              <div className="hx-media">
                {stage === "question" && (
                  <div className="hx-media-area">
                    <video
                      ref={previewRef}
                      autoPlay
                      playsInline
                      muted
                      className="hx-video"
                      aria-label="Camera preview"
                    />
                    {!isRecording && (
                      <button
                        className="hx-play-overlay"
                        onClick={startRecording}
                        disabled={!!permError}
                        title={
                          permError
                            ? "Allow camera/mic and refresh"
                            : "Start recording (Space)"
                        }
                        aria-label="Start recording"
                      >
                        ▶
                      </button>
                    )}
                    {permError && <div className="hx-perm">{permError}</div>}
                  </div>
                )}

                {stage === "review" && (
                  <div className="hx-media-area">
                    <video
                      ref={playbackRef}
                      className="hx-video"
                      src={recordingUrl}
                      controls
                      playsInline
                      aria-label="Review your recording"
                    />
                  </div>
                )}

                {stage === "uploading" && (
                  <div className="hx-upload">
                    <div className="hx-bar">
                      <div
                        className="hx-fill"
                        style={{ width: `${uploadPct}%` }}
                      />
                    </div>
                    <div className="hx-upload-text">Uploading your answer…</div>
                  </div>
                )}
              </div>

              <div className="hx-controls">
                <div className="hx-timer">
                  {stage === "question" &&
                    (isRecording ? (
                      <>
                        Time left: <b>{timeLeft}s</b>
                      </>
                    ) : (
                      <>Ready to record</>
                    ))}
                </div>

                <div className="hx-actions">
                  {stage === "question" &&
                    (isRecording ? (
                      <button
                        className="hx-btn danger"
                        onClick={stopRecording}
                        aria-label="Stop recording (Space)"
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        className="hx-btn"
                        onClick={startRecording}
                        disabled={!!permError}
                        aria-label="Start recording (Space)"
                      >
                        Start
                      </button>
                    ))}

                  {stage === "review" && (
                    <>
                      <button
                        className="hx-btn"
                        onClick={uploadAnswer}
                        aria-label="Upload (Enter)"
                      >
                        Looks good — Upload
                      </button>
                      {interview.allowRerecord && (
                        <button
                          className="hx-btn ghost"
                          onClick={discardAndRetry}
                        >
                          Re-record
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Card>
          )}

          {stage === "done" && (
            <Card>
              <div className="hx-done">
                🎉 All set! Thanks for completing the interview.
              </div>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
