import React, { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
 
const API_BASE = "";
 
const USERS = [
  "Ajit Jadhav",
  "Kiran Khade",
  "Mruda Sogale",
  "Sandhya Ghuge",
  "Sejal Pawar",
];
 
const PUNCH_ACTIONS = [
  { label: "Punch In",    type: "Punch In",    icon: "▶", cls: "action-in" },
  { label: "Punch Out",   type: "Punch Out",   icon: "■", cls: "action-out" },
  { label: "Start Break", type: "Start Break", icon: "⏸", cls: "action-break-start" },
  { label: "End Break",   type: "End Break",   icon: "↩", cls: "action-break-end" },
];
 
/* ── Camera Modal ─────────────────────────────────────────────── */
function CameraModal({ user, actionType, onCapture, onCancel }) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const streamRef   = useRef(null);
  const [ready,     setReady]     = useState(false);
  const [captured,  setCaptured]  = useState(null);
  const [camErr,    setCamErr]    = useState("");
  const [countdown, setCountdown] = useState(null);
 
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setReady(true);
        }
      })
      .catch(() => setCamErr("Camera access denied. Please allow camera permission and try again."));
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);
 
  const takeSelfie = useCallback(() => {
    let count = 3;
    setCountdown(count);
    const interval = setInterval(() => {
      count--;
      if (count > 0) { setCountdown(count); }
      else {
        clearInterval(interval);
        setCountdown(null);
        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;
        canvas.width  = video.videoWidth  || 320;
        canvas.height = video.videoHeight || 240;
        canvas.getContext("2d").drawImage(video, 0, 0);
        setCaptured(canvas.toDataURL("image/jpeg", 0.85));
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      }
    }, 1000);
  }, []);
 
  const retake = () => {
    setCaptured(null);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); setReady(true); }
      });
  };
 
  const actionColor =
    actionType === "Punch In"    ? "#15803d" :
    actionType === "Punch Out"   ? "#b91c1c" :
    actionType === "Start Break" ? "#b45309" : "#1d4ed8";
 
  return (
<div className="modal-overlay">
<div className="modal-box">
<div className="modal-header" style={{ borderTop: `4px solid ${actionColor}` }}>
<div className="modal-title">
<span className="modal-action-badge" style={{ background: actionColor }}>
              {actionType}
</span>
<span className="modal-user">👤 {user}</span>
</div>
<button className="modal-close" onClick={onCancel}>✕</button>
</div>
 
        <div className="modal-body">
          {camErr ? (
<div className="cam-error">
<span className="cam-error-icon">📷</span>
<p>{camErr}</p>
<button className="btn-secondary" onClick={onCancel}>Cancel</button>
</div>
          ) : (
<>
<p className="cam-instruction">
                {captured ? "Looks good? Confirm to submit." : "Position your face in the frame and click Capture."}
</p>
<div className="cam-frame">
                {!captured && (
<>
<video ref={videoRef} className="cam-video" autoPlay playsInline muted />
                    {countdown !== null && <div className="cam-countdown">{countdown}</div>}
                    {!ready && <div className="cam-loading">Starting camera…</div>}
</>
                )}
                {captured && <img src={captured} alt="selfie" className="cam-preview" />}
<canvas ref={canvasRef} style={{ display: "none" }} />
</div>
<div className="modal-actions">
                {!captured ? (
<>
<button className="btn-secondary" onClick={onCancel}>Cancel</button>
<button
                      className="btn-capture"
                      style={{ background: `linear-gradient(135deg, ${actionColor}, ${actionColor}dd)` }}
                      onClick={takeSelfie}
                      disabled={!ready || countdown !== null}
>
                      📸 Capture
</button>
</>
                ) : (
<>
<button className="btn-secondary" onClick={retake}>↩ Retake</button>
<button
                      className="btn-capture"
                      style={{ background: `linear-gradient(135deg, ${actionColor}, ${actionColor}dd)` }}
                      onClick={() => onCapture(captured)}
>
                      ✓ Confirm &amp; Submit
</button>
</>
                )}
</div>
</>
          )}
</div>
</div>
</div>
  );
}
 
/* ── Selfie Zoom ──────────────────────────────────────────────── */
function SelfiePop({ src, onClose }) {
  return (
<div className="modal-overlay" onClick={onClose}>
<div className="selfie-zoom" onClick={e => e.stopPropagation()}>
<img src={src} alt="selfie" />
<button className="modal-close selfie-close" onClick={onClose}>✕</button>
</div>
</div>
  );
}
 
/* ── Upload Modal ─────────────────────────────────────────────── */
function UploadingModal({ stage }) {
  const stages = {
    uploading: { icon: "☁️", text: "Uploading selfie to S3…",     color: "#2563eb" },
    saving:    { icon: "💾", text: "Saving punch record…",         color: "#d97706" },
    done:      { icon: "✅", text: "Punch recorded successfully!", color: "#16a34a" },
    error:     { icon: "❌", text: "Upload failed. Please retry.", color: "#dc2626" },
  };
  const s = stages[stage] || stages.uploading;
  return (
<div className="modal-overlay">
<div className="upload-modal">
<div className="upload-icon">{s.icon}</div>
<p className="upload-text" style={{ color: s.color }}>{s.text}</p>
        {(stage === "uploading" || stage === "saving") && <div className="upload-spinner" />}
</div>
</div>
  );
}
 
/* ── Main App ─────────────────────────────────────────────────── */
export default function App() {
  const [entries,      setEntries]      = useState([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [manualMode,   setManualMode]   = useState(false);
  const [manualDate,   setManualDate]   = useState("");
  const [manualTime,   setManualTime]   = useState("");
  const [status,       setStatus]       = useState({ msg: "", ok: true });
  const [loading,      setLoading]      = useState(false);
  const [activeTab,    setActiveTab]    = useState("history");
  const [filterUser,   setFilterUser]   = useState("All Users");
  const [filterType,   setFilterType]   = useState("All Types");
  const [cameraAction, setCameraAction] = useState(null);
  const [zoomSelfie,   setZoomSelfie]   = useState(null);
  const [uploadStage,  setUploadStage]  = useState(null);
 
  const fetchEntries = async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/entries`);
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
    } catch { console.error("Failed to fetch entries"); }
  };
 
  useEffect(() => { fetchEntries(); }, []);
 
  const todayPunches = entries.filter(e =>
    e.type === "Punch In" && new Date(e.time).toDateString() === new Date().toDateString()
  ).length;
  const breaksTaken = entries.filter(e => e.type === "Start Break").length;
 
  const statCards = [
    { label: "Total Records",   value: entries.length, icon: "📁", color: "sc-purple" },
    { label: "Today's Punches", value: todayPunches,   icon: "📅", color: "sc-blue"   },
    { label: "Breaks Taken",    value: breaksTaken,    icon: "☕", color: "sc-amber"  },
    { label: "Total Users",     value: USERS.length,   icon: "👥", color: "sc-teal"   },
  ];
 
  /* Work hours per user per day */
  const workHoursMap = (() => {
    const map    = {};
    const sorted = [...entries].sort((a, b) => new Date(a.time) - new Date(b.time));
    sorted.forEach(e => {
      const day = new Date(e.time).toLocaleDateString();
      const key = `${e.user}__${day}`;
      if (!map[key]) map[key] = { punchIn: null, punchOut: null };
      if (e.type === "Punch In"  && !map[key].punchIn) map[key].punchIn  = e.time;
      if (e.type === "Punch Out")                       map[key].punchOut = e.time;
    });
    const result = {};
    Object.entries(map).forEach(([key, v]) => {
      const hrs = v.punchIn && v.punchOut
        ? ((new Date(v.punchOut) - new Date(v.punchIn)) / 3600000).toFixed(2) + " h"
        : v.punchIn ? "Active…" : "-";
      result[key] = { punchIn: v.punchIn, punchOut: v.punchOut, hours: hrs };
    });
    return result;
  })();
 
  const getWorkInfo = (entry) => {
    const day = new Date(entry.time).toLocaleDateString();
    return workHoursMap[`${entry.user}__${day}`] || { punchIn: null, punchOut: null, hours: "-" };
  };
 
  const fmt = (iso) => iso
    ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
 
  const handleActionClick = (type) => {
    if (!selectedUser) { setStatus({ msg: "Please select an employee first.", ok: false }); return; }
    if (type === "Punch In" || type === "Punch Out") setCameraAction({ type });
    else submitPunch(type, null);
  };
 
  const onCameraCapture = async (selfieDataUrl) => {
    const type = cameraAction.type;
    setCameraAction(null);
    setUploadStage("uploading");
    setLoading(true);
    setStatus({ msg: "", ok: true });
    try {
      setUploadStage("saving");
      await submitPunch(type, selfieDataUrl);
      setUploadStage("done");
      setTimeout(() => setUploadStage(null), 1500);
    } catch (err) {
      setUploadStage("error");
      setStatus({ msg: err.message || "Something went wrong.", ok: false });
      setTimeout(() => setUploadStage(null), 3000);
    } finally { setLoading(false); }
  };
 
  const submitPunch = async (type, selfie) => {
    try {
      const res = await fetch(`${API_BASE}/api/punch`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, user: selectedUser, manualDate, manualTime, selfie: selfie || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || `Server error ${res.status}`);
      }
      const data = await res.json();
      setStatus({ msg: data.message || "Recorded!", ok: true });
      await fetchEntries();
    } catch (err) {
      setStatus({ msg: err.message || "Error saving punch.", ok: false });
      throw err;
    }
  };
 
  const filtered = entries.filter(e =>
    (filterUser === "All Users" || e.user === filterUser) &&
    (filterType === "All Types" || e.type === filterType)
  );
 
  const dailySummary = () => {
    const map    = {};
    const sorted = [...entries].sort((a, b) => new Date(a.time) - new Date(b.time));
    sorted.forEach(e => {
      const day  = new Date(e.time).toLocaleDateString();
      const user = e.user || "Unknown";
      const key  = `${day}__${user}`;
      if (!map[key]) map[key] = { day, user, pIn: null, pOut: null, breakMs: 0, bStart: null };
      if (e.type === "Punch In"   && !map[key].pIn) map[key].pIn  = new Date(e.time);
      if (e.type === "Punch Out")                   map[key].pOut = new Date(e.time);
      if (e.type === "Start Break") map[key].bStart = new Date(e.time);
      if (e.type === "End Break" && map[key].bStart) {
        map[key].breakMs += new Date(e.time) - map[key].bStart;
        map[key].bStart = null;
      }
    });
    return Object.values(map).map(r => ({
      ...r,
      punchInStr:  r.pIn  ? r.pIn.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-",
      punchOutStr: r.pOut ? r.pOut.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Active…",
      duration:    r.pIn && r.pOut ? ((r.pOut - r.pIn) / 3600000).toFixed(2) + " h" : r.pIn ? "Active…" : "-",
      breakTime:   r.breakMs ? (r.breakMs / 60000).toFixed(0) + " min" : "-",
    }));
  };
 
  const isS3Url = (val) => val && val.startsWith("http");
 
  return (
<div className="app-bg">
      {cameraAction && (
<CameraModal
          user={selectedUser}
          actionType={cameraAction.type}
          onCapture={onCameraCapture}
          onCancel={() => setCameraAction(null)}
        />
      )}
      {uploadStage && <UploadingModal stage={uploadStage} />}
      {zoomSelfie  && <SelfiePop src={zoomSelfie} onClose={() => setZoomSelfie(null)} />}
 
      <div className="app-container">
 
        {/* ── Hero Header ── */}
<header className="header">
<div className="header-badge">⏰ Live Tracking</div>
<h1 className="header-title">
            Welcome to <span>Punch Clock</span>
</h1>
<p className="header-sub">Track attendance, breaks, and work hours for your team</p>
</header>
 
        {/* ── Stat Cards ── */}
<div className="stat-grid">
          {statCards.map((s, i) => (
<div className={`stat-card ${s.color}`} key={i}>
<div className="sc-icon">{s.icon}</div>
<div className="sc-body">
<div className="sc-value">{s.value}</div>
<div className="sc-label">{s.label}</div>
</div>
</div>
          ))}
</div>
 
        {/* ── Two Column Layout ── */}
<div className="content-grid">
 
          {/* ── LEFT: Record Punch ── */}
<div className="card">
<div className="section-label">Record Punch</div>
 
            <div className="select-wrap">
<select
                className="user-select"
                value={selectedUser}
                onChange={e => setSelectedUser(e.target.value)}
>
<option value="" disabled>Select employee…</option>
                {USERS.map(u => <option key={u} value={u}>{u}</option>)}
</select>
<span className="select-arrow">▾</span>
</div>
 
            <label className="manual-toggle">
<input type="checkbox" className="toggle-check" checked={manualMode}
                onChange={e => setManualMode(e.target.checked)} />
<span className="toggle-box" />
<span className="toggle-text">
                Enter time manually
<span className="toggle-hint"> (if auto-detect fails)</span>
</span>
</label>
 
            {manualMode && (
<div className="manual-row">
<input className="mini-input" type="date" value={manualDate}
                  onChange={e => setManualDate(e.target.value)} />
<input className="mini-input" type="time" value={manualTime}
                  onChange={e => setManualTime(e.target.value)} />
</div>
            )}
 
            <div className="cam-notice">
              📷 Punch In &amp; Out require selfie verification
</div>
 
            <div className="action-grid">
              {PUNCH_ACTIONS.map(a => (
<button
                  key={a.type}
                  className={`action-btn ${a.cls}`}
                  onClick={() => handleActionClick(a.type)}
                  disabled={loading}
>
<span className="action-icon">{a.icon}</span>
<span className="action-label">{a.label}</span>
                  {(a.type === "Punch In" || a.type === "Punch Out") && (
<span className="cam-badge">📷</span>
                  )}
</button>
              ))}
</div>
 
            {status.msg && (
<div className={`status-pill ${status.ok ? "status-ok" : "status-err"}`}>
                {status.ok ? "✓" : "✕"} {status.msg}
</div>
            )}
</div>
 
          {/* ── RIGHT: Quick Summary (today) ── */}
<div className="card">
<div className="section-label">Today's Activity</div>
            {entries.filter(e => new Date(e.time).toDateString() === new Date().toDateString()).length === 0 ? (
<div className="empty-state">
<span className="empty-icon">🌅</span>
<p>No activity recorded today.<br />Start by punching in above.</p>
</div>
            ) : (
<div className="table-wrapper">
<table className="shift-table">
<thead>
<tr>
<th>#</th>
<th>Employee</th>
<th>Action</th>
<th>Time</th>
<th>Photo</th>
</tr>
</thead>
<tbody>
                    {entries
                      .filter(e => new Date(e.time).toDateString() === new Date().toDateString())
                      .slice(-8)
                      .reverse()
                      .map((e, i) => (
<tr key={i}>
<td className="td-num">{i + 1}</td>
<td>
<div className="td-user">
<span className="user-avatar">{e.user ? e.user[0].toUpperCase() : "?"}</span>
<span>{e.user || <span className="no-user">Unknown</span>}</span>
</div>
</td>
<td>
<span className={`badge badge-${e.type.replace(/\s/g, "-").toLowerCase()}`}>
                              {e.type}
</span>
</td>
<td className="td-mono">
                            {new Date(e.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
</td>
<td>
                            {e.selfie
                              ? <img src={e.selfie} alt="s" className="selfie-thumb"
                                  onClick={() => setZoomSelfie(e.selfie)} />
                              : <span className="td-dash">—</span>}
</td>
</tr>
                      ))}
</tbody>
</table>
</div>
            )}
</div>
</div>
 
        {/* ── Tabs + History ── */}
<div>
<div className="tab-bar">
<button className={`tab-btn ${activeTab === "history" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("history")}>
              📋 Shift History
</button>
<button className={`tab-btn ${activeTab === "summary" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("summary")}>
              📊 Daily Summary
</button>
</div>
 
          {/* Shift History */}
          {activeTab === "history" && (
<div className="card">
<div className="section-label">Shift History</div>
<div className="filter-row">
<div className="filter-select-wrap">
<select className="filter-select" value={filterUser}
                    onChange={e => setFilterUser(e.target.value)}>
<option>All Users</option>
                    {USERS.map(u => <option key={u}>{u}</option>)}
</select>
<span className="select-arrow sm">▾</span>
</div>
<div className="filter-select-wrap">
<select className="filter-select" value={filterType}
                    onChange={e => setFilterType(e.target.value)}>
<option>All Types</option>
                    {["Punch In", "Punch Out", "Start Break", "End Break"].map(t => (
<option key={t}>{t}</option>
                    ))}
</select>
<span className="select-arrow sm">▾</span>
</div>
</div>
 
              {filtered.length === 0 ? (
<div className="empty-state">
<span className="empty-icon">🗂️</span>
<p>No entries found.</p>
</div>
              ) : (
<div className="table-wrapper">
<table className="shift-table">
<thead>
<tr>
<th>#</th><th>Employee</th><th>Action</th>
<th>Punch In</th><th>Punch Out</th>
<th>Work Hrs</th><th>Date</th><th>Selfie</th>
</tr>
</thead>
<tbody>
                      {filtered.map((e, i) => {
                        const wi = getWorkInfo(e);
                        return (
<tr key={i}>
<td className="td-num">{i + 1}</td>
<td>
<div className="td-user">
<span className="user-avatar">{e.user ? e.user[0].toUpperCase() : "?"}</span>
<span>{e.user || <span className="no-user">Unknown</span>}</span>
</div>
</td>
<td>
<span className={`badge badge-${e.type.replace(/\s/g, "-").toLowerCase()}`}>
                                {e.type}
</span>
</td>
<td className="td-mono time-green">
                              {wi.punchIn ? fmt(wi.punchIn) : <span className="td-dash">—</span>}
</td>
<td className="td-mono time-red">
                              {wi.punchOut ? fmt(wi.punchOut) : <span className="td-dash">—</span>}
</td>
<td className="td-mono bold-green">{wi.hours}</td>
<td className="td-mono">{new Date(e.time).toLocaleDateString()}</td>
<td>
                              {e.selfie ? (
<div className="selfie-cell">
<img src={e.selfie} alt="selfie" className="selfie-thumb"
                                    onClick={() => setZoomSelfie(e.selfie)} />
<span className={`selfie-badge ${isS3Url(e.selfie) ? "badge-s3" : "badge-local"}`}>
                                    {isS3Url(e.selfie) ? "S3" : "local"}
</span>
</div>
                              ) : <span className="td-dash">—</span>}
</td>
</tr>
                        );
                      })}
</tbody>
</table>
</div>
              )}
</div>
          )}
 
          {/* Daily Summary */}
          {activeTab === "summary" && (
<div className="card">
<div className="section-label">Daily Summary</div>
              {dailySummary().length === 0 ? (
<div className="empty-state">
<span className="empty-icon">📊</span>
<p>No summary data yet.</p>
</div>
              ) : (
<div className="table-wrapper">
<table className="shift-table">
<thead>
<tr>
<th>#</th><th>Employee</th><th>Date</th>
<th>Punch In</th><th>Punch Out</th>
<th>Work Hrs</th><th>Break</th>
</tr>
</thead>
<tbody>
                      {dailySummary().map((r, i) => (
<tr key={i}>
<td className="td-num">{i + 1}</td>
<td>
<div className="td-user">
<span className="user-avatar">{r.user ? r.user[0].toUpperCase() : "?"}</span>
<span>{r.user || "Unknown"}</span>
</div>
</td>
<td className="td-mono">{r.day}</td>
<td className="td-mono time-green">{r.punchInStr}</td>
<td className="td-mono time-red">{r.punchOutStr}</td>
<td className="td-mono bold-green">{r.duration}</td>
<td className="td-mono">{r.breakTime}</td>
</tr>
                      ))}
</tbody>
</table>
</div>
              )}
</div>
          )}
</div>
 
        <footer className="footer">
          Punch Clock © {new Date().getFullYear()} &nbsp;·&nbsp; Built with ❤️
</footer>
</div>
</div>
  );
}
