import React, { useState, useEffect, useMemo, useCallback } from "react";
import "./admindashboard.css";
import {
  LayoutDashboard, Users, ShieldCheck, ClipboardList, FileText,
  Search, Bell, Check, X, Eye, Pencil, Trash2, Download,
  UserPlus, Activity, FileBarChart2, Clock,
  AlertTriangle, CheckCircle2, XCircle, Filter, BookOpen, MonitorSmartphone, LogOut,
  FolderTree, Plus, Pencil as PencilIcon, EyeOff, RotateCcw, HelpCircle
} from "lucide-react";
import LibraryDashboard from "./Dashboard";
import Help from "./Help";
import StatDetailModal from "./StatDetailModal";
import libraryLogo from '../logo.png';
import { showAlert, askConfirm } from './dialogs';

import { API } from '../config';

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------
// Fallback only — the live list comes from /api/roles via useRoleList(), so a
// role the administrator adds shows up in every dropdown without a code change.
const FALLBACK_ROLES = ["User", "Officer", "Senior Officer", "Department Head"];

// Role keys as currently configured. Administrator-behaviour roles are left
// out of the assignable list by default: handing someone the admin console
// from a row dropdown is not something to do by accident.
function useRoleList({ includeAdmin = false } = {}) {
  const [roles, setRoles] = useState(null);
  useEffect(() => {
    fetch(`${API}/api/roles`)
      .then(r => r.json())
      .then(d => setRoles(Array.isArray(d.roles) ? d.roles : null))
      .catch(() => setRoles(null));
  }, []);
  if (!roles) return FALLBACK_ROLES;
  return roles
    .filter(r => includeAdmin || r.behaviour !== "administrator")
    .map(r => r.key);
}
const PERMISSIONS = ["view", "add", "edit", "delete", "download"];

// The 3-step approval chain, in order. This matches server.js's
// STAGE_ORDER = ['officer', 'senior_officer', 'authorizer'] exactly —
// these keys are not display labels, they are the wire format the backend
// reads/writes under system_settings.responsibility_map.
// The three steps the system ships with. This is ONLY a fallback for when the
// workflow cannot be read — the real list comes from /api/workflow, which is
// also what Roles & workflow edits. It used to be the single source for this
// screen, which meant renaming a step there never showed up here, and a fourth
// step did not appear at all.
const STAGE_DEFS = [
  { key: "officer",        label: "Maker" },
  { key: "senior_officer", label: "Checker" },
  { key: "authorizer",     label: "Authorizer" },
];

// Fixed chain for permission requests. Download requests instead carry
// their own r.requiredStages (varies by security class — see
// chainForClass() in server.js), so the approval queue reads that per-row
// instead of assuming this fixed chain applies to everyone.
const PERMISSION_CHAIN = ["officer", "senior_officer", "authorizer"];

const SECURITY_CLASSES = ["normal", "medium", "strict"];
const CLASS_LABELS = { normal: "Public", medium: "Confidential", strict: "Highly Confidential" };

const ROLE_COLORS = {
  User:             { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-400" },
  Officer:          { bg: "bg-blue-50",   text: "text-blue-700",  dot: "bg-blue-500"  },
  "Senior Officer": { bg: "bg-violet-50", text: "text-violet-700",dot: "bg-violet-500"},
  "Department Head":{ bg: "bg-emerald-50",text: "text-emerald-700",dot:"bg-emerald-500"},
};

// The five things a person can do to a record, in the order they escalate.
// The blurbs say what the action actually means, because "edit" and "delete"
// carry very different weight and the matrix is where that gets decided.
const ACTION_LABELS = [
  { key: 'view',              label: 'View',                   blurb: 'Open a document in the viewer' },
  // Downloading is split by how restricted the document is, because that is
  // exactly the decision a classification exists to drive.
  { key: 'download:normal',   label: 'Download — Public',      blurb: 'Take a copy of an unrestricted document' },
  { key: 'download:medium',   label: 'Download — Confidential', blurb: 'Take a copy of restricted material' },
  { key: 'download:strict',   label: 'Download — Highly Confidential', blurb: 'Take a copy of the most restricted material' },
  { key: 'add',               label: 'Add',                    blurb: 'File a new record' },
  { key: 'edit',              label: 'Edit',                   blurb: 'Change an existing record' },
  { key: 'delete',            label: 'Delete',                 blurb: 'Remove a record' },
];

const STAGE_COLORS = {
  officer:        { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-300"   },
  senior_officer: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-300" },
  authorizer:     { bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-300"},
};

// Steps are administrator-defined, so a custom one has no entry above. Fall
// back by position rather than leaving it unstyled.
const STAGE_COLOR_CYCLE = [
  { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-300"   },
  { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-300" },
  { bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-300"},
  { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-300"  },
  { bg: "bg-rose-50",   text: "text-rose-700",   border: "border-rose-300"   },
];
const stageColor = (key, i) =>
  STAGE_COLORS[key] || STAGE_COLOR_CYCLE[i % STAGE_COLOR_CYCLE.length];

const STAGE_SHORT_LABEL = { officer: "Officer", senior_officer: "Sr. Officer", authorizer: "Dept. Head" };

const PERM_ICON = { view: Eye, add: Plus, edit: Pencil, delete: Trash2, download: Download };

const defaultMatrix = {
  User:             { view: true,  add: false, edit: false, delete: false, download: true  },
  Officer:          { view: true,  add: true,  edit: true,  delete: false, download: true  },
  "Senior Officer": { view: true,  add: true,  edit: true,  delete: true,  download: true  },
  "Department Head":{ view: true,  add: true,  edit: true,  delete: true,  download: true  },
};

// Stage-keyed, matching resolveChainRoles()'s expected shape once converted
// to an array on save: [{ stage: 'officer', role: 'Officer' }, ...]
const defaultResponsibility = {
  officer: "Officer",
  senior_officer: "Senior Officer",
  authorizer: "Department Head",
};

// Download fees are keyed by document CATEGORY, not security class.
const FEE_CATEGORIES = ["technical_report", "map", "other_publication", "book"];
const FEE_CATEGORY_LABELS = {
  technical_report: "Technical Reports",
  map: "Maps",
  other_publication: "Other Publications",
  book: "Books",
};
const defaultCategoryFees = { technical_report: 2, map: 5, other_publication: 2, book: 2 };

function formatBirr(amount) {
  return `ETB ${Number(amount || 0).toFixed(2)}`;
}

// Converts the array format the server stores/returns
// ([{ stage, role }, ...]) into the stage-keyed object this component
// works with in state. Falls back to defaults for any missing stage.
// Any stage key is kept, not just the three the system ships with. Filtering
// against a fixed list meant an administrator-added step was dropped on load
// and again on save, so its assignment could never stick.
function arrayToResponsibilityMap(arr) {
  if (!Array.isArray(arr)) return { ...defaultResponsibility };
  const map = { ...defaultResponsibility };
  arr.forEach(entry => {
    if (entry && entry.stage) map[entry.stage] = entry.role;
  });
  return map;
}

// Converts the stage-keyed object back into the array format the server
// expects to persist under system_settings.responsibility_map.
function responsibilityMapToArray(map) {
  return Object.keys(map || {}).map(stage => ({ stage, role: map[stage] }));
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------
function RoleBadge({ role }) {
  const c = ROLE_COLORS[role] || ROLE_COLORS.User;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {role}
    </span>
  );
}

function StatusPill({ status }) {
  const map = { Active: "bg-emerald-50 text-emerald-700", Inactive: "bg-slate-100 text-slate-500" };
  return <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${map[status] || map.Inactive}`}>{status}</span>;
}

function StageLabel({ stage }) {
  const map = {
    officer:        { text: "Awaiting officer",       cls: "text-blue-700 bg-blue-50"    },
    senior_officer: { text: "Awaiting senior officer",cls: "text-violet-700 bg-violet-50" },
    authorizer:     { text: "Awaiting authorizer",     cls: "text-emerald-700 bg-emerald-50" },
    approved:       { text: "Approved",                cls: "text-emerald-700 bg-emerald-50" },
    rejected:       { text: "Rejected",                cls: "text-red-700 bg-red-50"      },
  };
  const m = map[stage] || map.officer;
  return <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${m.cls}`}>{m.text}</span>;
}

function StatCard({ icon: Icon, label, value, sub, accent, onClick }) {
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-2${onClick ? " stat-card-clickable cursor-pointer hover:bg-slate-50 transition-colors" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${accent}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// chain: explicit stage-key array for THIS request (fixed permission chain,
// or a download's requiredStages). Previously this component had its own
// internal 'maker'/'checker'/'authorizer' labels compared against an
// 'order' array of the SAME wrong keys — but the stage prop passed in is
// always the real DB value ('officer'/'senior_officer'/'authorizer'/
// 'approved'/'rejected'), which never matched 'maker' or 'checker'. That
// meant every request sitting at 'officer' or 'senior_officer' rendered as
// all-pending regardless of actual progress. Fixed by keying strictly off
// the real stage values passed in via `chain`.
function ApprovalPipeline({ stage, chain, requestedBy, size = "md" }) {
  const stages = (chain && chain.length > 0 ? chain : PERMISSION_CHAIN).map(key => ({
    key, label: STAGE_SHORT_LABEL[key] || key,
  }));
  const idx = stages.findIndex(s => s.key === stage);
  const small = size === "sm";

  return (
    <div className="flex items-center gap-0">
      {stages.map((s, i) => {
        let state = "pending";
        if (stage === "rejected")      { state = i === 0 ? "done" : "rejected"; }
        else if (stage === "approved") { state = "done"; }
        else if (idx !== -1) {
          if (i < idx) state = "done";
          else if (i === idx) state = "active";
        }
        const isDone = state === "done", isActive = state === "active", isRejected = state === "rejected";
        return (
          <React.Fragment key={s.key}>
            <div className="flex flex-col items-center gap-1" style={{ minWidth: small ? 64 : 84 }}>
              <div className={`flex items-center justify-center rounded-full border-2 ${small ? "w-7 h-7" : "w-9 h-9"} ${
                isDone     ? "bg-emerald-500 border-transparent" :
                isActive   ? "bg-white border-blue-300 text-blue-700" :
                isRejected ? "bg-red-500 border-transparent" :
                             "bg-slate-50 border-slate-200 text-slate-400"
              }`}>
                {isDone ? <Check className="w-4 h-4 text-white" /> :
                 isRejected ? <X className="w-4 h-4 text-white" /> :
                 isActive ? <Clock className="w-4 h-4 text-blue-700" /> :
                 <span className="text-xs font-medium">{i + 1}</span>}
              </div>
              <div className={`text-center ${small ? "text-[10px]" : "text-xs"}`}>
                <div className={`font-medium ${isActive ? "text-blue-700" : isDone ? "text-slate-700" : "text-slate-400"}`}>{s.label}</div>
                {!small && i === 0 && requestedBy && <div className="text-slate-400 truncate max-w-[80px]">by {requestedBy}</div>}
              </div>
            </div>
            {i < stages.length - 1 && (
              <div className={`h-0.5 flex-1 mb-5 ${small ? "max-w-[20px]" : "max-w-[32px]"} ${
                (stage === "rejected" && i === 0) ? "bg-slate-200" :
                (stage === "approved" || i < idx) ? "bg-slate-300" : "bg-slate-200"
              }`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview — fetches all data from real API endpoints
// ---------------------------------------------------------------------------
function Overview({ currentUserId }) {
  const [counters, setCounters] = useState(null);
  const [trend, setTrend]       = useState([]);
  const [topDocs, setTopDocs]   = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [openModal, setOpenModal] = useState(null); // null | 'active-users' | 'new-accounts' | 'audit-events'

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/dashboard/counters`).then(r => r.json()),
      fetch(`${API}/api/dashboard/registration-trends`).then(r => r.json()),
      fetch(`${API}/api/dashboard/top-downloads`).then(r => r.json()),
      fetch(`${API}/api/dashboard/approval-snapshot`).then(r => r.json()),
    ]).then(([c, t, d, s]) => {
      setCounters(c); setTrend(t); setTopDocs(d); setSnapshot(s);
      setLoading(false);
    }).catch(err => { console.error(err); setLoading(false); });
  }, []);

  if (loading) return <div className="text-sm text-slate-400 p-6">Loading overview...</div>;
  if (!counters) return <div className="text-sm text-red-500 p-6">Failed to load overview data.</div>;

  const maxCount = trend.length ? Math.max(...trend.map(d => d.count)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Users}       label="Active users"        value={counters.activeUsers}       sub={`of ${counters.totalUsers} total`}  accent="bg-emerald-50 text-emerald-600" onClick={() => setOpenModal('active-users')} />
        <StatCard icon={UserPlus}    label="New accounts (30d)"  value={counters.newAccounts30Days} sub="this month"                          accent="bg-blue-50 text-blue-600"     onClick={() => setOpenModal('new-accounts')} />
        <StatCard icon={ClipboardList} label="Pending approvals" value={counters.pendingApprovals}  sub="in maker-checker queue"              accent="bg-amber-50 text-amber-600"   />
        <StatCard icon={Activity}    label="Audit events (24h)"  value={counters.auditEvents24h}    sub="logged actions"                      accent="bg-violet-50 text-violet-600" onClick={() => setOpenModal('audit-events')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">New accounts created</h3>
            <span className="text-xs text-slate-400">This year</span>
          </div>
          <div className="flex items-end gap-3 h-32">
            {trend.map(d => (
              <div key={d.month} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full flex items-end justify-center" style={{ height: 96 }}>
                  <div className="w-full max-w-[28px] rounded-t-md bg-blue-500"
                    style={{ height: `${Math.round((d.count / maxCount) * 100)}%` }}
                    title={`${d.count} accounts`} />
                </div>
                <span className="text-xs text-slate-500">{d.month}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Most downloaded</h3>
            <FileBarChart2 className="w-4 h-4 text-slate-400" />
          </div>
          <div className="flex flex-col gap-3">
            {topDocs.slice(0, 4).map((doc, i) => (
              <div key={doc.name || i} className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-400 w-3">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-700 truncate">{doc.name}</div>
                  <div className="text-xs text-slate-400">{doc.dept}</div>
                </div>
                <span className="text-xs font-semibold text-slate-600">{doc.downloads}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-900">Approval queue snapshot</h3>
          <span className="text-xs text-slate-400">{counters.pendingApprovals} pending</span>
        </div>
        <div className="flex flex-col gap-4">
          {snapshot.length === 0 && <p className="text-xs text-slate-400">No pending requests.</p>}
          {snapshot.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800 truncate">{r.action} &middot; {r.target}</div>
                <div className="text-xs text-slate-400">{r.requestCode || r.id} requested by {r.requestedBy}</div>
              </div>
              <ApprovalPipeline stage={r.stage} chain={PERMISSION_CHAIN} requestedBy={r.requestedBy} size="sm" />
            </div>
          ))}
        </div>
      </div>

      {openModal && <StatDetailModal kind={openModal} onClose={() => setOpenModal(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category Fees — admin-configurable per-page ETB rate for each document
// CATEGORY: Technical Reports, Maps, Other Publications. The security
// class (normal/medium/strict) no longer sets the price — it only governs
// approval requirements. Server defaults to
// { technical_report: 2, map: 5, other_publication: 2 } if never saved.
// ---------------------------------------------------------------------------
function ClassFees({ currentUserId }) {
  const [fees, setFees] = useState(defaultCategoryFees);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // How many downloads a member may take without authorisation. This had no
  // screen at all before — it could only be set by calling the API.
  const [perMonth, setPerMonth] = useState("");
  const [perDay, setPerDay] = useState("");
  const [policySaving, setPolicySaving] = useState(false);
  const [policySaved, setPolicySaved] = useState(false);
  const [policyError, setPolicyError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/settings/category-fees`)
      .then(r => r.json())
      .then(data => { if (data) setFees({ ...defaultCategoryFees, ...data }); setLoading(false); })
      .catch(() => setLoading(false));
    fetch(`${API}/api/settings/download-policy`)
      .then(r => r.json())
      .then(d => {
        if (d && d.selfServicePerMonth !== undefined) setPerMonth(String(d.selfServicePerMonth));
        setPerDay(d && d.selfServicePerDay !== null && d.selfServicePerDay !== undefined
          ? String(d.selfServicePerDay) : "");
      })
      .catch(() => {});
  }, []);

  const savePolicy = async () => {
    setPolicySaving(true); setPolicyError(""); setPolicySaved(false);
    try {
      const res = await fetch(`${API}/api/settings/download-policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selfServicePerMonth: Number(perMonth) || 0,
          // Blank means no daily cap, which is not the same as a cap of zero.
          selfServicePerDay: perDay.trim() === "" ? null : Number(perDay),
          changedBy: currentUserId,
        }),
      });
      const raw = await res.text();
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      if (!res.ok) { setPolicyError(body.message || `The server refused that (HTTP ${res.status}).`); return; }
      setPolicySaved(true);
    } catch {
      setPolicyError("Could not reach the server.");
    } finally { setPolicySaving(false); }
  };

  const handleChange = (cat, value) => {
    setSaved(false);
    setFees(prev => ({ ...prev, [cat]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const normalized = {
        technical_report: Number(fees.technical_report) || 0,
        map: Number(fees.map) || 0,
        other_publication: Number(fees.other_publication) || 0,
      };
      await fetch(`${API}/api/settings/category-fees`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fees: normalized, changedBy: currentUserId }),
      });
      setFees(normalized);
      setSaved(true);
    } catch (err) {
      console.error("Failed to save category fees:", err);
    }
    setSaving(false);
  };

  if (loading) return <div className="text-sm text-slate-400 p-6">Loading fee schedule...</div>;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">How many downloads without authorisation</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          A member may take this many downloads themselves, paying the fee but needing nobody's
          approval. Past either limit, Download asks for a reason and goes to the approval chain
          instead. Staff roles are not affected.
        </p>
      </div>
      <div className="p-5 flex flex-col gap-4 border-b border-slate-100">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-800">Per calendar month</div>
            <div className="text-xs text-slate-400">Counted from the 1st. Zero means every download needs approval.</div>
          </div>
          <input type="number" min="0" step="1" value={perMonth}
            onChange={e => { setPerMonth(e.target.value); setPolicySaved(false); }}
            className="w-24 text-sm rounded-lg border border-slate-200 px-2.5 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-blue-200" />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-800">Per day</div>
            <div className="text-xs text-slate-400">
              Leave blank for no daily limit. Whichever limit runs out first is the one that applies.
            </div>
          </div>
          <input type="number" min="0" step="1" value={perDay} placeholder="none"
            onChange={e => { setPerDay(e.target.value); setPolicySaved(false); }}
            className="w-24 text-sm rounded-lg border border-slate-200 px-2.5 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-blue-200" />
        </div>
        {policyError && <div className="ls-error">{policyError}</div>}
        <div className="flex items-center gap-3">
          <button onClick={savePolicy} disabled={policySaving}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
            {policySaving ? "Saving..." : "Save download limits"}
          </button>
          {policySaved && <span className="text-xs text-emerald-600 font-medium">Saved.</span>}
        </div>
      </div>

      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">Download fees per document category</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Per-page ETB rate charged when a user downloads a document, based on what kind of
          document it is — Technical Reports, Maps, or Other Publications. Security class
          still controls the approval requirement, but not the price.
        </p>
      </div>
      <div className="p-5 flex flex-col gap-4">
        {FEE_CATEGORIES.map(cls => (
          <div key={cls} className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-800">{FEE_CATEGORY_LABELS[cls]}</div>
              <div className="text-xs text-slate-400">Currently: {formatBirr(fees[cls])} / page</div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">ETB</span>
              <input
                type="number" min="0" step="0.5"
                value={fees[cls]}
                onChange={e => handleChange(cls, e.target.value)}
                className="w-24 text-sm rounded-lg border border-slate-200 px-2.5 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <span className="text-xs text-slate-400">/ page</span>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 pt-2">
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
            {saving ? "Saving..." : "Save fee schedule"}
          </button>
          {saved && <span className="text-xs text-emerald-600 font-medium">Saved.</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access Control Matrix — persists changes to the backend
// ---------------------------------------------------------------------------
function AccessControlMatrix({ matrix, setMatrix, responsibility, setResponsibility, currentUserId }) {
  // Every role the administrator has defined, including administrator ones —
  // this screen is where their permissions are set, so they must be listed.
  const ROLES = useRoleList({ includeAdmin: true });

  // The approval steps, read live from the same place Roles & workflow writes
  // them. STAGE_DEFS is only the fallback for when that cannot be reached.
  const [stages, setStages] = useState(STAGE_DEFS);
  useEffect(() => {
    fetch(`${API}/api/workflow`)
      .then(r => r.json())
      .then(d => {
        const live = Array.isArray(d.steps) ? d.steps.filter(st => st.isActive) : [];
        if (live.length) setStages(live.map(st => ({ key: st.key, label: st.label })));
      })
      .catch(() => {});   // the fallback above still renders something usable
  }, []);
  // FIXED: was PUT /api/access-control/matrix (does not exist on the
  // server — 404s were silently swallowed, so toggles never persisted).
  // The real route is /api/permissions (see server.js section 9).
  const toggle = async (role, perm) => {
    const newMatrix = { ...matrix, [role]: { ...matrix[role], [perm]: !matrix[role][perm] } };
    setMatrix(newMatrix);
    try {
      await fetch(`${API}/api/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix: newMatrix, changedBy: currentUserId }),
      });
    } catch (err) { console.error("Failed to save matrix:", err); }
  };

  // FIXED: previously stored a role-keyed shape
  // ({ Officer: 'Maker', ... }) that the backend's resolveChainRoles()
  // could never parse (it reads an array of { stage, role } keyed by
  // workflow STAGE, not by role). Now each of the 3 chain stages
  // (officer / senior_officer / authorizer) is assigned to whichever ROLE
  // should handle it, and that stage-keyed object is converted to the
  // array format on save.
  const assignStageRole = async (stageKey, role) => {
    const updatedResponsibility = { ...responsibility, [stageKey]: role };
    setResponsibility(updatedResponsibility);
    try {
      await fetch(`${API}/api/access-control/responsibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responsibility: responsibilityMapToArray(updatedResponsibility),
          changedBy: currentUserId,
        }),
      });
    } catch (err) { console.error("Failed to persist workflow responsibility:", err); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Dynamic access control</h3>
            <p className="text-xs text-slate-500 mt-0.5">Click a permission button to grant or revoke it for a role, instantly. Adding and editing are separate: a role can be allowed to file new records without being allowed to change existing ones.</p>
          </div>
          <ShieldCheck className="w-5 h-5 text-slate-400" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-5 py-3 font-medium text-slate-500 text-xs">Role</th>
                {PERMISSIONS.map(p => (
                  <th key={p} className="px-5 py-3 font-medium text-slate-500 text-xs capitalize text-center">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map(role => (
                <tr key={role} className="border-t border-slate-100">
                  <td className="px-5 py-3"><RoleBadge role={role} /></td>
                  {PERMISSIONS.map(perm => {
                    const Icon = PERM_ICON[perm];
                    const granted = matrix[role]?.[perm];
                    return (
                      <td key={perm} className="px-5 py-3 text-center">
                        <button onClick={() => toggle(role, perm)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            granted ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                    : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"}`}>
                          <Icon className="w-3.5 h-3.5" />
                          {granted ? "Granted" : "Denied"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Workflow responsibility</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Assign which role reviews each step. The steps themselves — their names, their
            order, and how many there are — are set under Roles &amp; workflow. Whoever
            submits a request is its maker; that is not assigned here.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {stages.map((stageDef, i) => {
            const c = stageColor(stageDef.key, i);
            return (
              <div key={stageDef.key} className="px-5 py-3 flex items-center justify-between flex-wrap gap-3">
                <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{stageDef.label}</span>
                <div className="flex items-center gap-2">
                  {ROLES.map(role => (
                    <button key={role}
                      onClick={() => assignStageRole(stageDef.key, role)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        responsibility[stageDef.key] === role
                          ? `${c.bg} ${c.text} ${c.border}`
                          : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"}`}>
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          Segregation-of-duties rule: a user cannot check or authorize a request they personally made as a maker. This is enforced in the backend.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// User Management — fetches from API, persists role changes to backend
// ---------------------------------------------------------------------------
function UserManagement({ currentUserId }) {
  const ROLES = useRoleList();
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState("");
  const [roleFilter, setRoleFilter] = useState("All");

  useEffect(() => {
    fetch(`${API}/api/users`)
      .then(r => r.json())
      .then(data => { setUsers(data); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, []);

  const filtered = useMemo(() => users.filter(u => {
    const matchesQuery = (u.username || "").toLowerCase().includes(query.toLowerCase()) ||
                         (u.email || "").toLowerCase().includes(query.toLowerCase());
    const matchesRole = roleFilter === "All" || u.role === roleFilter;
    return matchesQuery && matchesRole;
  }), [users, query, roleFilter]);

  const changeRole = async (id, role) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u));
    try {
      await fetch(`${API}/api/users/${id}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, changedBy: currentUserId }),
      });
    } catch (err) { console.error("Failed to save role change:", err); }
  };

  const formatDate = (ts) => ts ? new Date(ts).toISOString().split('T')[0] : '—';
  const formatActive = (ts) => ts ? new Date(ts).toLocaleString() : 'Never';

  if (loading) return <div className="text-sm text-slate-400 p-6">Loading users...</div>;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Users</h3>
          <p className="text-xs text-slate-500 mt-0.5">{filtered.length} of {users.length} accounts</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search name or email"
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200 w-56" />
          </div>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            className="text-xs rounded-lg border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200">
            <option>All</option>
            {ROLES.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left">
              {["Name", "Department", "Role", "Status", "Last active", "Joined"].map(h => (
                <th key={h} className="px-5 py-3 font-medium text-slate-500 text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-800">{u.username}</div>
                  <div className="text-xs text-slate-400">{u.email}</div>
                </td>
                <td className="px-5 py-3 text-slate-600 text-xs">{u.department || "—"}</td>
                <td className="px-5 py-3">
                  <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}
                    className="appearance-none bg-transparent text-xs font-medium pr-4 focus:outline-none cursor-pointer text-slate-700">
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-5 py-3"><StatusPill status={u.status || "Inactive"} /></td>
                <td className="px-5 py-3 text-xs text-slate-500">{formatActive(u.last_active_at)}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{formatDate(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approval Queue — fetches from API, persists advance/reject to backend
//
// NOTE: server.js exposes /api/office-requests (not /api/approval-requests),
// and stages are 'officer' | 'senior_officer' | 'authorizer' | 'approved' |
// 'rejected'. This mirrors OfficeDashboard.js. Download-type rows also carry
// securityClass/requiredStages/feePerPage/pageCount/totalFee/paymentStatus —
// shown here so an approver knows what class/cost they're approving before
// clicking Accept.
// ---------------------------------------------------------------------------
function ApprovalQueue({ currentUser }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab]   = useState("pending");
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchRequests = () => {
    fetch(`${API}/api/office-requests`)
      .then(r => r.json())
      .then(data => { setRequests(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  };
  useEffect(() => { fetchRequests(); }, []);

  const handleApprove = async (id) => {
    try {
      const res = await fetch(`${API}/api/office-requests/${id}/accept`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actingUserId: currentUser.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        showAlert(err.message);
        return;
      }
      fetchRequests();
    } catch (err) { console.error(err); }
  };

  const handleReject = async (id, reason) => {
    try {
      await fetch(`${API}/api/office-requests/${id}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actingUserId: currentUser.id, rejectReason: reason }),
      });
      setRejectingId(null);
      setRejectReason("");
      fetchRequests();
    } catch (err) { console.error(err); }
  };

  const pending  = requests.filter(r => ["officer", "senior_officer", "authorizer"].includes(r.stage));
  const resolved = requests.filter(r => r.stage === "approved" || r.stage === "rejected");
  const list = activeTab === "pending" ? pending : resolved;

  const rejectReasonFor = (r) => r.officerRejectReason || r.seniorOfficerRejectReason || r.deptHeadRejectReason;

  if (loading) return <div className="text-sm text-slate-400 p-6">Loading approval queue...</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {[["pending", pending.length], ["resolved", resolved.length]].map(([tab, count]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
              activeTab === tab ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-500"}`}>
            {tab} ({count})
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {list.length === 0 && <div className="text-center py-12 text-sm text-slate-400">Nothing here right now.</div>}
        {list.map(r => {
          const isDownload = r.requestType === "download";
          const chain = isDownload && r.requiredStages && r.requiredStages.length > 0 ? r.requiredStages : PERMISSION_CHAIN;
          return (
          <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-mono text-slate-400">{r.requestCode || r.id}</span>
                  <StageLabel stage={r.stage} />
                  {isDownload && (
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                      {CLASS_LABELS[r.securityClass] || r.securityClass || "Public"}
                    </span>
                  )}
                  {isDownload && r.totalFee != null && (
                    <span className="text-xs text-slate-500">
                      {formatBirr(r.totalFee)} ({r.pageCount ?? "?"} pages @ {formatBirr(r.feePerPage)}/page)
                      {r.paymentStatus && ` · ${r.paymentStatus === "paid" ? "Paid" : "Unpaid"}`}
                    </span>
                  )}
                </div>
                <div className="text-sm font-medium text-slate-800">{r.action} &middot; {r.targetLabel}</div>
                <div className="text-xs text-slate-500 mt-1">{r.reason}</div>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-400 flex-wrap">
                  <RoleBadge role={r.makerRole} />
                  <span>requested by {r.makerUsername}</span>
                  <span>&middot;</span>
                  <span>{r.created}</span>
                </div>
                {r.stage === "rejected" && rejectReasonFor(r) && (
                  <div className="mt-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5" /> {rejectReasonFor(r)}
                  </div>
                )}
              </div>
              <ApprovalPipeline stage={r.stage} chain={chain} requestedBy={r.makerUsername} />
            </div>

            {["officer", "senior_officer", "authorizer"].includes(r.stage) && (
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100 flex-wrap">
                <button onClick={() => handleApprove(r.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {r.stage === chain[chain.length - 1] ? "Authorize & finalize" : "Approve & forward"}
                </button>
                {rejectingId === r.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input autoFocus value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection"
                      className="flex-1 text-xs rounded-lg border border-red-200 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-200" />
                    <button onClick={() => handleReject(r.id, rejectReason)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700">
                      Confirm reject
                    </button>
                    <button onClick={() => setRejectingId(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setRejectingId(r.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                )}
              </div>
            )}
          </div>
        )})}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Log — fetches from API with severity filter (client-side, since
// server.js's GET /api/audit-logs does not accept ?severity/?limit params)
// ---------------------------------------------------------------------------
function AuditLog() {
  const [auditLog, setAuditLog] = useState([]);
  const [filter, setFilter]     = useState("All");
  const [loading, setLoading]   = useState(true);
  const severities = ["All", "success", "warning", "danger", "info"];

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/audit-logs`)
      .then(r => r.json())
      .then(data => { setAuditLog(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, []);

  const visible = filter === "All" ? auditLog : auditLog.filter(a => a.severity === filter);

  const sevStyle = {
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger:  "bg-red-50 text-red-700",
    info:    "bg-slate-100 text-slate-600",
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Audit log</h3>
          <p className="text-xs text-slate-500 mt-0.5">Immutable record of every action across the system</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          {severities.map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize ${
                filter === s ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
        {loading && <div className="p-4 text-xs text-slate-400">Loading...</div>}
        {!loading && visible.map(a => (
          <div key={a.id} className="px-5 py-3 flex items-start gap-3">
            <span className={`mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${sevStyle[a.severity] || sevStyle.info}`}>{a.action}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-700">{a.detail}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {a.username || 'System'} · {new Date(a.created_at).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents — fetches from API
// ---------------------------------------------------------------------------
// Colour slots, assigned IN FIXED ORDER — never cycled, never generated.
// This 8-hue order is validated for colour-blind separation on a white
// surface (worst adjacent pair ΔE 9.1, floor is 8), so do not rearrange it.
const BAR_COLORS = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
];
const BAR_COLOR_OVERFLOW = '#8a8a85'; // 9th+ document — neutral, never a 9th hue

// Each document gets its own colour, keyed on the document TITLE rather than
// its position in the list. That matters: download counts change, so if the
// colour followed the rank, tomorrow's re-sort would repaint every bar and a
// document someone remembers as "the green one" would silently become blue.
// Keying on the title alphabetically keeps each document's colour stable.
function buildBarColorMap(docs) {
  const titles = [...new Set(docs.map(d => d.name))].sort();
  const map = {};
  titles.forEach((title, i) => {
    map[title] = i < BAR_COLORS.length ? BAR_COLORS[i] : BAR_COLOR_OVERFLOW;
  });
  return map;
}

function Documents() {
  const [docs, setDocs]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/dashboard/top-downloads`)
      .then(r => r.json())
      .then(data => { setDocs(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, []);

  if (loading) return <div className="text-sm text-slate-400 p-6">Loading documents...</div>;

  const rows = docs.map(d => ({
    name: d.name || 'Untitled',
    dept: d.dept || 'Unassigned',
    downloads: Number(d.downloads) || 0,
  }));
  const maxDownloads = rows.length ? Math.max(...rows.map(d => d.downloads), 1) : 1;
  const barColors = buildBarColorMap(rows);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">Highly downloaded documents</h3>
        <p className="text-xs text-slate-500 mt-0.5">Across all departments, all time</p>
      </div>

      {rows.length === 0 ? (
        <div className="p-6 text-sm text-slate-400">No downloads recorded yet.</div>
      ) : (
        <div className="topdocs-body">
          <div className="topdocs-columns">
            {rows.map((doc, i) => {
              // The tallest bar stops at 88% of the plot, leaving the top 12%
              // as room for the count that sits on its cap — at a full 100%
              // the number would be pushed outside the box. Every bar is
              // scaled against the same 88%, so the proportions between them
              // are untouched. The 5% floor keeps a one-download column
              // visible instead of a hairline.
              const pct = Math.max((doc.downloads / maxDownloads) * 88, 5);
              return (
                <div
                  key={`${doc.name}-${i}`}
                  className="topdocs-col"
                  title={`${doc.name} — ${doc.dept} — ${doc.downloads} download${doc.downloads === 1 ? '' : 's'}`}
                >
                  {/* The count rides the bar's cap, so it lives inside the
                      plot and rises with it. Outside, it sat at the top of the
                      box and stopped belonging to the shorter columns. */}
                  <div className="topdocs-col-plot">
                    <span className="topdocs-col-value">{doc.downloads}</span>
                    <div
                      className="topdocs-col-bar"
                      style={{ height: `${pct}%`, backgroundColor: barColors[doc.name] }}
                    />
                  </div>

                  <div className="topdocs-col-foot">
                    <span className="topdocs-col-rank">{i + 1}</span>
                    <span className="topdocs-col-title">{doc.name}</span>
                    <span className="topdocs-col-dept">{doc.dept}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ROLES & WORKFLOW
//
// Roles and the approval chain used to be hardcoded. Both are rows now.
//
// A role is a name plus a BEHAVIOUR, and the behaviour is what the system
// branches on. Without it a new role would silently behave like a plain
// member — which is how someone ends up with free downloads nobody intended.
// ---------------------------------------------------------------------------

const BEHAVIOUR_INFO = {
  member: {
    label: 'Member',
    blurb: 'Browses the library. Gets a few self-service downloads each month, then pays and needs authorisation.',
  },
  staff_maker: {
    label: 'Staff — asks',
    blurb: 'Requests documents with a reason and pays nothing, but someone further along the chain must accept.',
  },
  staff_direct: {
    label: 'Staff — direct',
    blurb: 'Downloads immediately. No request, no fee. Every download is still recorded against their name.',
  },
  administrator: {
    label: 'Administrator',
    blurb: 'The full admin console: library structure, fees, users, roles and reports.',
  },
};

function RolesAndWorkflow({ currentUserId }) {
  const [roles, setRoles] = useState([]);
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingRole, setEditingRole] = useState(null);   // { mode, row? }
  const [editingStep, setEditingStep] = useState(null);
  // Shown inside the step dialog. The page-level banner sits above a long list
  // of roles, so a refusal there is off-screen while the dialog is open and
  // Save looks as though it did nothing.
  const [saveError, setSaveError] = useState("");
  const [removing, setRemoving] = useState(null);         // { row, accounts }
  const [reassignTo, setReassignTo] = useState("");
  const [usingDefaults, setUsingDefaults] = useState(null);
  const [actionChains, setActionChains] = useState({});
  const [users, setUsers] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/roles?includeHidden=true`).then(r => r.json()),
      fetch(`${API}/api/workflow?includeHidden=true`).then(r => r.json()),
      fetch(`${API}/api/workflow/action-chains`).then(r => r.json()),
      fetch(`${API}/api/users`).then(r => r.json()),
    ])
      .then(([r, w, ac, us]) => {
        setRoles(Array.isArray(r.roles) ? r.roles : []);
        setSteps(Array.isArray(w.steps) ? w.steps : []);
        setActionChains(ac && ac.chains ? ac.chains : {});
        setUsers(Array.isArray(us) ? us : []);
        // The server says when the list it just sent is the built-in fallback
        // rather than the table. Without this the screen looks perfectly
        // normal while every add or edit fails.
        setUsingDefaults(r.usingDefaults ? (r.defaultsReason || true) : null);
        setLoading(false);
      })
      .catch(err => { console.error(err); setError("Could not load roles."); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (url, method, body) => {
    setError("");
    try {
      const res = await fetch(`${API}${url}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(body || {}), changedBy: currentUserId }),
      });
      // Read as text first. An error body is not always JSON — several
      // endpoints answer a 500 with the bare words "Server Error" — and
      // calling res.json() on that threw, leaving the catch to swallow the
      // real reason and show a useless "That did not work."
      const raw = await res.text();
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
      if (!res.ok) {
        // A 404 from Express is an HTML page, not JSON, so read the text when
        // there is no message — otherwise the reason is thrown away and the
        // screen just says nothing happened.
        const message = payload.message ||
          (raw && raw.trim() ? `${res.status}: ${raw.trim().slice(0, 300)}` : `The server refused that (HTTP ${res.status}).`);
        setError(message);
        return { ok: false, payload, message };
      }
      load();
      return { ok: true, payload };
    } catch (err) {
      console.error(err);
      const message = "Could not reach the server.";
      setError(message);
      return { ok: false, payload: {}, message };
    }
  };

  // A switched-off step cannot be part of a chain — the server filters it out
  // — so it must not be offered here either.
  const liveSteps = steps.filter(st => st.isActive !== false);

  // Who staffs a step, in a few words. Named people first — the same order
  // authority is decided in — so a column header says whose desk it is rather
  // than which job title it used to belong to.
  const staffLine = (st) => {
    const named = Array.isArray(st.userIds) ? st.userIds.map(String) : [];
    if (named.length > 0) {
      const names = (users || [])
        .filter(u => named.includes(String(u.id)))
        .map(u => u.fullName || u.username);
      return names.join(', ') || `${named.length} named`;
    }
    if (st.roleKey) {
      return `any ${(roles.find(r => r.key === st.roleKey) || {}).label || st.roleKey}`;
    }
    return 'nobody yet';
  };

  // Saved immediately on each tick, matching how Access control behaves — a
  // Save button on a grid of toggles is a step people forget to press.
  const toggleActionStep = async (action, stepKey) => {
    const current = actionChains[action] || [];
    const next = current.includes(stepKey)
      ? current.filter(k => k !== stepKey)
      : [...current, stepKey];
    const optimistic = { ...actionChains, [action]: next };
    setActionChains(optimistic);
    setError("");
    try {
      const res = await fetch(`${API}/api/workflow/action-chains`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chains: optimistic, changedBy: currentUserId }),
      });
      const raw = await res.text();
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      if (!res.ok) {
        setError(body.message || `The server refused that (HTTP ${res.status}).`);
        setActionChains(actionChains);           // put the tick back
        return;
      }
      // The server returns them in the chain's order, which may differ from
      // the order they were ticked.
      if (body.chains) setActionChains(body.chains);
    } catch {
      setError("Could not reach the server.");
      setActionChains(actionChains);
    }
  };

  const askRemove = async (row) => {
    // id, or the role key as a fallback — the server accepts either.
    const res = await fetch(`${API}/api/roles/${encodeURIComponent(row.id ?? row.key)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changedBy: currentUserId }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { load(); return; }
    if (body.needsReassign) {
      setRemoving({ row, accounts: body.accounts });
      setReassignTo("");
    } else {
      setError(body.message || "That role could not be removed.");
    }
  };

  if (loading) return <div className="text-sm text-slate-400 p-6">Loading roles…</div>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Roles &amp; workflow</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Who can do what, and the order requests travel in. Both are yours to change.
        </p>
      </div>

      {error && <div className="ls-error">{error}</div>}

      {usingDefaults && (
        <div className="rw-degraded">
          <strong>These are the built-in roles, not your saved ones.</strong>
          <span>
            The roles table could not be read, so the list below is the fallback the
            system ships with. It looks normal but nothing here can be added or changed
            until the table is fixed. Restart the backend — it repairs an out-of-date
            roles table on startup. If that does not clear this, the server log has the
            reason.
          </span>
          {typeof usingDefaults === 'string' && (
            <code className="rw-degraded-reason">{usingDefaults}</code>
          )}
        </div>
      )}

      {/* ---- roles ---- */}
      <div className="ls-panel">
        <div className="ls-panel-head">
          <span>Roles</span>
          <button className="ls-add-btn" onClick={() => setEditingRole({ mode: "add" })}>
            <Plus className="w-3 h-3" /> Add role
          </button>
        </div>
        <div className="rw-list">
          {roles.map(role => (
            <div key={role.key} className={`rw-row ${role.isActive === false ? "ls-row--hidden" : ""}`}>
              <div className="rw-row-main">
                <div className="rw-row-label">
                  {role.label}
                  {role.isSystem && <span className="rw-tag rw-tag--system">built-in</span>}
                  {role.isActive === false && <span className="ls-tag">Hidden</span>}
                </div>
                <div className="rw-row-sub">
                  {BEHAVIOUR_INFO[role.behaviour]?.label || role.behaviour}
                  {" · "}
                  {role.accounts} account{role.accounts === 1 ? "" : "s"}
                </div>
                <div className="rw-row-blurb">{BEHAVIOUR_INFO[role.behaviour]?.blurb}</div>
              </div>
              <div className="ls-row-actions">
                <button title="Edit" onClick={() => setEditingRole({ mode: "edit", row: role })}>
                  <PencilIcon className="w-3.5 h-3.5" />
                </button>
                {!role.isSystem && (
                  <button title="Remove" onClick={() => askRemove(role)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- workflow ---- */}
      <div className="ls-panel">
        <div className="ls-panel-head">
          <span>Approval steps, in order</span>
          <button className="ls-add-btn" onClick={() => setEditingStep({ mode: "add" })}>
            <Plus className="w-3 h-3" /> Add step
          </button>
        </div>
        <div className="rw-steps">
          {steps.map((step, i) => (
            <div key={step.key} className={`rw-step ${step.isActive === false ? "ls-row--hidden" : ""}`}>
              <span className="rw-step-num">{i + 1}</span>
              <div className="rw-row-main">
                <div className="rw-row-label">{step.label}</div>
                <div className="rw-row-sub">
                  {/* Named people first, because that is the order authority is
                      decided in. Showing the role when people are named made
                      the step look like the role's, which it is not. */}
                  {(() => {
                    const named = Array.isArray(step.userIds) ? step.userIds.map(String) : [];
                    if (named.length > 0) {
                      const names = (users || [])
                        .filter(u => named.includes(String(u.id)))
                        .map(u => u.fullName || u.username);
                      return <>handled by <strong>{names.join(', ') || `${named.length} named ${named.length === 1 ? 'person' : 'people'}`}</strong></>;
                    }
                    if (step.roleKey) {
                      const lbl = (roles.find(r => r.key === step.roleKey) || {}).label || step.roleKey;
                      return <>handled by <strong>anyone with the {lbl} role</strong></>;
                    }
                    return <span className="rw-unassigned">nobody assigned — requests will stall here</span>;
                  })()}
                </div>
              </div>
              <div className="ls-row-actions">
                <button title="Edit" onClick={() => setEditingStep({ mode: "edit", row: step })}>
                  <PencilIcon className="w-3.5 h-3.5" />
                </button>
                <button
                  title="Remove"
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: "Remove step",
                      okLabel: "Remove",
                      message: `Remove "${step.label}" from the chain? Requests already in flight keep the chain they started with.`,
                    });
                    if (ok) call(`/api/workflow/${encodeURIComponent(step.id ?? step.key)}`, "DELETE");
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="rw-note">
          A request keeps the chain it was created with, so changing anything here never
          rewrites a decision already made.
        </div>
      </div>

      {/* ---- which steps each action has to pass ---- */}
      <div className="ls-panel">
        <div className="ls-panel-head">
          <span>What each action has to pass through</span>
        </div>
        <div className="rw-matrix-note">
          Tick the steps an action must clear. Untick everything and that action needs no
          approval at all — it happens the moment someone does it, and is still recorded.
          The order is always the chain's own order, whatever order you tick them in.
        </div>
        <div className="rw-matrix">
          <div className="rw-matrix-head"
               style={{ gridTemplateColumns: `minmax(12rem, 1.6fr) repeat(${liveSteps.length + 1}, minmax(5.5rem, 1fr))` }}>
            <span>Action</span>
            {liveSteps.map(st => (
              <span key={st.key} className="rw-matrix-col">
                {st.label}
                <em className="rw-matrix-staff">{staffLine(st)}</em>
              </span>
            ))}
            <span className="rw-matrix-col">Result</span>
          </div>
          {ACTION_LABELS.map(({ key, label, blurb }) => {
            const picked = actionChains[key] || [];
            return (
              <div key={key} className="rw-matrix-row"
                   style={{ gridTemplateColumns: `minmax(12rem, 1.6fr) repeat(${liveSteps.length + 1}, minmax(5.5rem, 1fr))` }}>
                <span className="rw-matrix-action">
                  <strong>{label}</strong>
                  <em>{blurb}</em>
                </span>
                {liveSteps.map(st => {
                  const on = picked.includes(st.key);
                  return (
                    <span key={st.key} className="rw-matrix-col">
                      <button
                        type="button"
                        className={`rw-tick ${on ? 'rw-tick--on' : ''}`}
                        aria-pressed={on}
                        title={`${on ? 'Remove' : 'Require'} ${st.label} for ${label}`}
                        onClick={() => toggleActionStep(key, st.key)}
                      >
                        {on ? '✓' : ''}
                      </button>
                    </span>
                  );
                })}
                <span className="rw-matrix-col rw-matrix-result">
                  {picked.length === 0
                    ? <em>no approval</em>
                    : `${picked.length} step${picked.length === 1 ? '' : 's'}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {editingRole && (
        <RoleEditor
          editing={editingRole}
          onCancel={() => { setSaveError(""); setEditingRole(null); }}
          saveError={saveError}
          onSave={async (payload) => {
            setSaveError("");
            // The row id, or its role key if the id is missing. This used to
            // post to /api/roles/ with nothing here, which answered 404 and
            // left the dialog open as if Save had done nothing.
            const ref = editingRole.row?.id ?? editingRole.row?.key;
            if (editingRole.mode === "edit" && !ref) {
              setSaveError("This role has no identifier, so it cannot be saved. Reload the page and try again.");
              return;
            }
            const { ok, message } = editingRole.mode === "edit"
              ? await call(`/api/roles/${encodeURIComponent(ref)}`, "PUT", payload)
              : await call(`/api/roles`, "POST", payload);
            if (ok) setEditingRole(null);
            else setSaveError(message || "Could not save this role.");
          }}
        />
      )}

      {editingStep && (
        <StepEditor
          editing={editingStep}
          roles={roles}
          users={users}
          onCancel={() => { setSaveError(""); setEditingStep(null); }}
          saveError={saveError}
          onSave={async (payload) => {
            setSaveError("");
            // The row id, or its step key if the id is missing. Saving used to
            // post to /api/workflow/ with nothing at all here, which answered
            // 404 and left the dialog sitting open as if Save did nothing.
            const ref = editingStep.row?.id ?? editingStep.row?.key;
            if (editingStep.mode === "edit" && !ref) {
              setSaveError("This step has no identifier, so it cannot be saved. Reload the page and try again.");
              return;
            }
            const { ok, message } = editingStep.mode === "edit"
              ? await call(`/api/workflow/${encodeURIComponent(ref)}`, "PUT", payload)
              : await call(`/api/workflow`, "POST", payload);
            if (ok) setEditingStep(null);
            else setSaveError(message || "Could not save this step.");
          }}
        />
      )}

      {removing && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 440 }}>
            <h3>Move these accounts first</h3>
            <div className="modal-form-body">
              <p className="rw-modal-text">
                <strong>{removing.accounts}</strong> account{removing.accounts === 1 ? "" : "s"} still
                hold <strong>{removing.row.label}</strong>. Choose the role they should have instead.
              </p>
              <label className="ls-field">
                <span>Move them to</span>
                <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}>
                  <option value="">Choose a role…</option>
                  {roles.filter(r => r.key !== removing.row.key).map(r => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => setRemoving(null)}>Cancel</button>
              <button
                type="button"
                className="save-btn"
                disabled={!reassignTo}
                onClick={async () => {
                  const { ok } = await call(`/api/roles/${encodeURIComponent(removing.row.id ?? removing.row.key)}`, "DELETE", { reassignTo });
                  if (ok) setRemoving(null);
                }}
              >
                Move &amp; remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleEditor({ editing, onCancel, onSave, saveError }) {
  const row = editing.row || {};
  const isEdit = editing.mode === "edit";
  const [label, setLabel] = useState(row.label || "");
  const [behaviour, setBehaviour] = useState(row.behaviour || "member");

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 520 }}>
        <h3>{isEdit ? "Edit role" : "Add role"}</h3>
        <form onSubmit={e => { e.preventDefault(); if (label.trim()) onSave({ label: label.trim(), behaviour }); }}>
          <div className="modal-form-body">
            {saveError && <div className="rw-save-error">{saveError}</div>}
            <label className="ls-field">
              <span>Role name</span>
              <input value={label} onChange={e => setLabel(e.target.value)} autoFocus required />
            </label>

            <div className="ls-field">
              <span>What this role can do</span>
              <div className="rw-behaviours">
                {Object.entries(BEHAVIOUR_INFO).map(([key, info]) => (
                  <button
                    key={key}
                    type="button"
                    className={`rw-behaviour ${behaviour === key ? "rw-behaviour--on" : ""}`}
                    onClick={() => setBehaviour(key)}
                  >
                    <span className="rw-behaviour-label">{info.label}</span>
                    <span className="rw-behaviour-blurb">{info.blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            {isEdit && (
              <div className="ls-note">
                Renaming a role renames it on every account that holds it, and on any approval
                step pointing at it — all in one step, so nothing is left behind.
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="save-btn">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StepEditor({ editing, roles, users, onCancel, onSave, saveError }) {
  const row = editing.row || {};
  const isEdit = editing.mode === "edit";
  const [label, setLabel] = useState(row.label || "");
  const [roleKey, setRoleKey] = useState(row.roleKey || "");
  const [userIds, setUserIds] = useState(Array.isArray(row.userIds) ? row.userIds.map(String) : []);

  // Anybody who can see an approval queue, regardless of job title. A step
  // naming people belongs to those people — the role is no longer checked
  // first, so there is nothing to narrow within.
  //
  // Readers are left out: a member-behaviour account lands on the reader
  // workspace and never sees a queue, so naming one would stop every request
  // that reached this step. The server refuses it too.
  const behaviourByRole = {};
  (roles || []).forEach(r => { behaviourByRole[r.key] = r.behaviour; });
  const eligible = (users || []).filter(u => behaviourByRole[u.role] !== "member");

  // Changing the role no longer invalidates the names: the people stand on
  // their own, so a role change is just a change of fallback.
  const togglePerson = (id) => setUserIds(prev =>
    prev.includes(String(id)) ? prev.filter(x => x !== String(id)) : [...prev, String(id)]
  );
  const roleLabel = (roles.find(r => r.key === roleKey) || {}).label || roleKey;

  // Only roles that review things. A member-behaviour role staffing an
  // approval step would mean requests sit waiting for someone who never sees
  // a queue.
  const reviewerRoles = roles.filter(r => r.behaviour !== "member");

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 460 }}>
        <h3>{isEdit ? "Edit step" : "Add approval step"}</h3>
        <form onSubmit={e => { e.preventDefault(); if (label.trim()) onSave({ label: label.trim(), roleKey: roleKey || null, userIds: userIds.map(Number) }); }}>
          <div className="modal-form-body">
            {saveError && <div className="rw-save-error">{saveError}</div>}
            <label className="ls-field">
              <span>Step name</span>
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Archive check" autoFocus required />
            </label>
            <div className="ls-field">
              <span>Handled by <em>(pick the people)</em></span>
              {eligible.length === 0 ? (
                <div className="ls-note">
                  No account can review yet. Every account here is a reader, and readers never
                  see an approval queue — create a staff account, or change a role's behaviour
                  under Roles.
                </div>
              ) : (
                <div className="rw-staff">
                  {eligible.map(u => {
                    const on = userIds.includes(String(u.id));
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className={`rw-staff-pick ${on ? 'rw-staff-pick--on' : ''}`}
                        aria-pressed={on}
                        onClick={() => togglePerson(u.id)}
                      >
                        <span className="rw-staff-tick">{on ? '✓' : ''}</span>
                        <span>{u.fullName || u.username}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* The role is now only what happens when nobody is named, so it
                sits under the people and says so. */}
            <label className="ls-field">
              <span>Or anyone with this role <em>(used only if nobody is ticked)</em></span>
              <select value={roleKey} onChange={e => setRoleKey(e.target.value)} disabled={userIds.length > 0}>
                <option value="">No role</option>
                {reviewerRoles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </label>

            <div className="ls-note">
              {userIds.length > 0
                ? `This step belongs to the ${userIds.length} ticked ${userIds.length === 1 ? 'person' : 'people'}, whatever role they hold — nobody else sees or decides it. Whoever covers for them under a delegation still can.`
                : roleKey
                  ? `Nobody is ticked, so anyone holding the ${roleLabel} role handles this step. Tick people above to narrow it to them.`
                  : 'Nothing is assigned yet, so any request reaching this step will stop here. Tick the people who handle it, or choose a role.'}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="save-btn">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LIBRARY STRUCTURE — the categories on the library home page and the lists
// inside them.
//
// Add and edit only, deliberately. Institutional records keep their labels,
// so nothing here deletes: taking something out of circulation hides it,
// which removes it from the library while every document already filed under
// it keeps its label and stays downloadable.
// ---------------------------------------------------------------------------

// What each category's children are called, and which `kind` a new child gets.
const CHILD_LISTS = {
  report_topic: [{ kind: "report_topic", title: "Report topics", hasCode: true }],
  pub_type:     [{ kind: "pub_type",     title: "Publication types" }],
  item:         [{ kind: "item",         title: "Classifications" }],
  none:         [],
  map: [
    { kind: "map_format", title: "Formats" },
    { kind: "map_type",   title: "Map types" },
    { kind: "map_scale",  title: "Scales" },
  ],
};

const NAV_CHOICES = [
  { key: "item",         label: "One list of classifications" },
  { key: "report_topic", label: "Numbered topics (like Technical Reports)" },
  { key: "pub_type",     label: "Publication types" },
  { key: "none",         label: "No list — go straight to the documents" },
];

function LibraryStructure({ currentUserId }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);
  const [editing, setEditing] = useState(null);   // { mode, kind, row? }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    // includeHidden — the admin needs to see what they have hidden in order
    // to bring it back.
    fetch(`${API}/api/taxonomy?includeHidden=true`)
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d.categories) ? d.categories : [];
        setCategories(list);
        setSelectedKey(prev => prev && list.some(c => c.key === prev) ? prev : (list[0]?.key ?? null));
        setLoading(false);
      })
      .catch(err => { console.error(err); setError("Could not load the library structure."); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = categories.find(c => c.key === selectedKey) || null;

  const save = async (payload, id) => {
    setSaving(true); setError("");
    try {
      const res = await fetch(id ? `${API}/api/taxonomy/${id}` : `${API}/api/taxonomy`, {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, changedBy: currentUserId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.message || "Could not save."); return false; }
      if (body.documentsRelabelled > 0) {
        showAlert(`Saved. ${body.documentsRelabelled} document${body.documentsRelabelled === 1 ? "" : "s"} relabelled to match.`);
      }
      load();
      return true;
    } catch (err) {
      console.error(err); setError("Could not reach the server."); return false;
    } finally { setSaving(false); }
  };

  const toggleHidden = async (row) => {
    const hiding = row.isActive !== false;
    if (hiding) {
      // Say what hiding will affect before it happens.
      let count = 0;
      try {
        const r = await fetch(`${API}/api/taxonomy/${row.id}/usage`);
        count = (await r.json()).count || 0;
      } catch { /* a failed count shouldn't block the action */ }
      const ok = await askConfirm({
        title: "Hide from the library",
        okLabel: "Hide",
        message: count > 0
          ? `Hide "${row.label}"? It will disappear from the library, but the ${count} document${count === 1 ? "" : "s"} filed under it keep their label and stay downloadable.`
          : `Hide "${row.label}"? Nothing is filed under it yet. You can bring it back at any time.`,
      });
      if (!ok) return;
    }
    await save({ isActive: !row.isActive }, row.id);
  };

  if (loading) return <div className="text-sm text-slate-400 p-6">Loading library structure…</div>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Library structure</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          The cards on the library home page and the lists inside them. Nothing here is ever
          deleted — hide what should no longer be used.
        </p>
      </div>

      {error && <div className="ls-error">{error}</div>}

      <div className="ls-layout">
        {/* ---- categories ---- */}
        <div className="ls-panel">
          <div className="ls-panel-head">
            <span>Categories</span>
            <button className="ls-add-btn" onClick={() => setEditing({ mode: "add", kind: "category" })}>
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <div className="ls-list">
            {categories.map(cat => (
              <div
                key={cat.key}
                className={`ls-row ${selectedKey === cat.key ? "ls-row--active" : ""} ${cat.isActive === false ? "ls-row--hidden" : ""}`}
                onClick={() => setSelectedKey(cat.key)}
              >
                <span className="ls-row-icon">{cat.icon || "📁"}</span>
                <div className="ls-row-main">
                  <div className="ls-row-label">
                    {cat.label}
                    {cat.isActive === false && <span className="ls-tag">Hidden</span>}
                  </div>
                  <div className="ls-row-sub">
                    {(cat.children || []).length} item{(cat.children || []).length === 1 ? "" : "s"}
                    {cat.feePerPage !== null && cat.feePerPage !== undefined && ` · ${formatBirr(cat.feePerPage)}/page`}
                  </div>
                </div>
                <div className="ls-row-actions" onClick={e => e.stopPropagation()}>
                  <button title="Edit" onClick={() => setEditing({ mode: "edit", kind: "category", row: cat })}>
                    <PencilIcon className="w-3.5 h-3.5" />
                  </button>
                  <button title={cat.isActive === false ? "Show again" : "Hide"} onClick={() => toggleHidden(cat)}>
                    {cat.isActive === false ? <RotateCcw className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- what is inside the selected category ---- */}
        <div className="ls-panel ls-panel--wide">
          {!selected ? (
            <div className="ls-empty">Add a category to get started.</div>
          ) : (
            <>
              <div className="ls-panel-head">
                <span>Inside {selected.label}</span>
              </div>
              {(CHILD_LISTS[selected.nav] || CHILD_LISTS.item).length === 0 ? (
                <div className="ls-empty">
                  {selected.label} goes straight to its documents — there is no list inside it.
                </div>
              ) : (
                (CHILD_LISTS[selected.nav] || CHILD_LISTS.item).map(list => {
                  const rows = (selected.children || []).filter(ch => ch.kind === list.kind);
                  return (
                    <div key={list.kind} className="ls-sublist">
                      <div className="ls-sublist-head">
                        <span>{list.title}</span>
                        <button
                          className="ls-add-btn"
                          onClick={() => setEditing({ mode: "add", kind: list.kind, parentId: selected.id, hasCode: list.hasCode })}
                        >
                          <Plus className="w-3 h-3" /> Add
                        </button>
                      </div>
                      {rows.length === 0 ? (
                        <div className="ls-empty-small">Nothing added yet.</div>
                      ) : (
                        <div className="ls-chip-grid">
                          {rows.map(row => (
                            <div key={row.id} className={`ls-chip ${row.isActive === false ? "ls-chip--hidden" : ""}`}>
                              {row.code && <span className="ls-chip-code">{row.code}</span>}
                              <span className="ls-chip-label">{row.label}</span>
                              <button title="Edit" onClick={() => setEditing({ mode: "edit", kind: list.kind, row, hasCode: list.hasCode })}>
                                <PencilIcon className="w-3 h-3" />
                              </button>
                              <button title={row.isActive === false ? "Show again" : "Hide"} onClick={() => toggleHidden(row)}>
                                {row.isActive === false ? <RotateCcw className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>

      {editing && (
        <StructureEditor
          editing={editing}
          saving={saving}
          onCancel={() => { setEditing(null); setError(""); }}
          onSave={async (payload) => {
            const ok = await save(payload, editing.mode === "edit" ? editing.row.id : null);
            if (ok) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// Add/edit form. A category gets the extras a card needs (icon, subtitle,
// price, how it is browsed); everything else is just a name, plus a code for
// numbered topics.
function StructureEditor({ editing, saving, onCancel, onSave }) {
  const isCategory = editing.kind === "category";
  const isEdit = editing.mode === "edit";
  const row = editing.row || {};

  const [label, setLabel] = useState(row.label || "");
  const [code, setCode] = useState(row.code || "");
  const [subtitle, setSubtitle] = useState(row.subtitle || "");
  const [icon, setIcon] = useState(row.icon || "📁");
  const [nav, setNav] = useState(row.nav || "item");
  const [fee, setFee] = useState(row.feePerPage ?? 2);

  const submit = (e) => {
    e.preventDefault();
    if (!label.trim()) return;
    const payload = { label: label.trim() };
    if (editing.hasCode || row.code) payload.code = code.trim();
    if (isCategory) {
      payload.subtitle = subtitle.trim();
      payload.icon = icon.trim();
      payload.feePerPage = Number(fee) || 0;
      // How a category is browsed is fixed once documents are filed under it.
      if (!isEdit) payload.nav = nav;
    }
    if (!isEdit) {
      payload.kind = editing.kind;
      if (editing.parentId) payload.parentId = editing.parentId;
    }
    onSave(payload);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 480 }}>
        <h3>{isEdit ? "Edit" : "Add"} {isCategory ? "category" : "entry"}</h3>
        <form onSubmit={submit}>
          <div className="modal-form-body">
            <label className="ls-field">
              <span>Name</span>
              <input value={label} onChange={e => setLabel(e.target.value)} autoFocus required />
            </label>

            {(editing.hasCode || row.code) && (
              <label className="ls-field">
                <span>Code</span>
                <input value={code} onChange={e => setCode(e.target.value)} placeholder="001" />
              </label>
            )}

            {isCategory && (
              <>
                <label className="ls-field">
                  <span>Icon</span>
                  <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={4} style={{ width: 70 }} />
                </label>
                <label className="ls-field">
                  <span>Card subtitle</span>
                  <input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Shown under the name" />
                </label>
                <label className="ls-field">
                  <span>Download fee (ETB per page)</span>
                  <input type="number" min="0" step="0.5" value={fee} onChange={e => setFee(e.target.value)} />
                </label>
                {!isEdit && (
                  <label className="ls-field">
                    <span>How it is browsed</span>
                    <select value={nav} onChange={e => setNav(e.target.value)}>
                      {NAV_CHOICES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </label>
                )}
                {isEdit && (
                  <div className="ls-note">
                    How this category is browsed can't be changed once it exists — documents
                    are already filed by it.
                  </div>
                )}
              </>
            )}

            {isEdit && (
              <div className="ls-note">
                Renaming is safe: documents already filed under this keep their place, and
                any that store the old name are updated automatically.
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="save-btn" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ACCOUNT DETAILS
// Everything captured when the account was created, plus what it has done
// since. Opened by clicking a name anywhere it appears.
// ---------------------------------------------------------------------------
function AccountModal({ userId, snapshotName, onClose, currentUserId }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  // Filling in a name that was never captured. An account created before the
  // name was asked for — or by the admin form, which did not ask — would
  // otherwise read "not provided" for ever.
  const [editingName, setEditingName] = useState(null);   // { first, middle, last }
  const [savingName, setSavingName] = useState(false);

  const loadProfile = useCallback(() => {
    return fetch(`${API}/api/users/${userId}/profile`)
      .then(async r => {
        if (r.status === 404) throw new Error("This account no longer exists.");
        if (!r.ok) throw new Error("Could not load this account.");
        return r.json();
      })
      .then(d => { setProfile(d); return d; });
  }, [userId]);

  const saveName = async () => {
    setSavingName(true); setError("");
    try {
      const res = await fetch(`${API}/api/users/${userId}/name`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: editingName.first,
          middleName: editingName.middle,
          lastName: editingName.last,
          changedBy: currentUserId,
        }),
      });
      const raw = await res.text();
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      if (!res.ok) { setError(body.message || `The server refused that (HTTP ${res.status}).`); return; }
      setEditingName(null);
      await loadProfile();
    } catch (e) {
      setError("Could not reach the server.");
    } finally { setSavingName(false); }
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/users/${userId}/profile`)
      .then(async r => {
        if (r.status === 404) throw new Error("This account no longer exists.");
        if (!r.ok) throw new Error("Could not load this account.");
        return r.json();
      })
      .then(d => { if (!cancelled) setProfile(d); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [userId]);

  const when = (v) => (v ? new Date(v).toLocaleString() : "—");

  // The report stores the name as it was at download time. If the account has
  // been renamed since, say so rather than silently showing a different name.
  const renamed = profile && snapshotName && profile.fullName && profile.fullName !== snapshotName;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content acct-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        {!profile && !error && <div className="acct-loading">Loading account…</div>}
        {error && <div className="ls-error">{error}</div>}

        {profile && (
          <>
            <div className="acct-head">
              <div className="acct-avatar">{(profile.fullName || profile.username || "?").charAt(0).toUpperCase()}</div>
              <div>
                <div className="acct-name">{profile.fullName || profile.username}</div>
                <div className="acct-username">@{profile.username}</div>
              </div>
              <div className="acct-head-right">
                <RoleBadge role={profile.role} />
                <StatusPill status={profile.status} />
              </div>
            </div>

            {renamed && (
              <div className="acct-note">
                Recorded as <strong>{snapshotName}</strong> at the time of that download.
              </div>
            )}

            <div className="acct-section">Account</div>
            <dl className="acct-grid">
              <dt>First name</dt>
              <dd>{profile.firstName || <span className="acct-muted">not provided</span>}</dd>
              {profile.middleName && (<><dt>Middle name</dt><dd>{profile.middleName}</dd></>)}
              <dt>Last name</dt>
              <dd>{profile.lastName || <span className="acct-muted">not provided</span>}</dd>
              <dt>Username</dt><dd>{profile.username}</dd>
              <dt>Email</dt>
              <dd>{profile.email
                ? <a href={`mailto:${profile.email}`}>{profile.email}</a>
                : <span className="acct-muted">not provided</span>}</dd>
              <dt>Department</dt><dd>{profile.department || <span className="acct-muted">none</span>}</dd>
              <dt>Role</dt><dd>{profile.role}</dd>
              <dt>Account created</dt><dd>{when(profile.createdAt)}</dd>
              <dt>Last active</dt><dd>{when(profile.lastActiveAt)}</dd>
            </dl>

            {editingName ? (
              <div className="acct-name-edit">
                <div className="acct-name-edit-row">
                  <label>
                    <span>First name</span>
                    <input value={editingName.first} autoFocus
                      onChange={e => setEditingName(n => ({ ...n, first: e.target.value }))} />
                  </label>
                  <label>
                    <span>Middle name</span>
                    <input value={editingName.middle} placeholder="optional"
                      onChange={e => setEditingName(n => ({ ...n, middle: e.target.value }))} />
                  </label>
                  <label>
                    <span>Last name</span>
                    <input value={editingName.last}
                      onChange={e => setEditingName(n => ({ ...n, last: e.target.value }))} />
                  </label>
                </div>
                <div className="acct-name-edit-actions">
                  <button type="button" className="acct-name-cancel"
                    onClick={() => setEditingName(null)} disabled={savingName}>Cancel</button>
                  <button type="button" className="acct-name-save" onClick={saveName}
                    disabled={savingName || (!editingName.first.trim() && !editingName.last.trim())}>
                    {savingName ? "Saving…" : "Save name"}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="acct-name-btn"
                onClick={() => setEditingName({
                  first: profile.firstName || "",
                  middle: profile.middleName || "",
                  last: profile.lastName || "",
                })}>
                {profile.firstName || profile.lastName ? "Correct this name" : "Add a name"}
              </button>
            )}

            <div className="acct-section">Activity</div>
            <dl className="acct-grid">
              <dt>Downloads</dt><dd>{profile.activity.downloads}</dd>
              <dt>Paid in total</dt><dd>{formatBirr(profile.activity.spent)}</dd>
              <dt>First download</dt><dd>{when(profile.activity.firstDownload)}</dd>
              <dt>Latest download</dt><dd>{when(profile.activity.lastDownload)}</dd>
              <dt>Requests made</dt>
              <dd>
                {profile.requests.total}
                {profile.requests.total > 0 && (
                  <span className="acct-muted">
                    {" "}({profile.requests.approved} approved · {profile.requests.pending} pending · {profile.requests.rejected} rejected)
                  </span>
                )}
              </dd>
            </dl>
          </>
        )}

        <div className="modal-footer">
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DOWNLOAD & REVENUE REPORT
// Pick two dates: who downloaded what, from which part of the library, and
// what the organisation took in over that period.
// ---------------------------------------------------------------------------
function isoDay(d) { return d.toISOString().slice(0, 10); }

function DownloadReport({ currentUserId }) {
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openAccount, setOpenAccount] = useState(null);  // { userId, name }

  useEffect(() => {
    fetch(`${API}/api/taxonomy`)
      .then(r => r.json())
      .then(d => setCategories(Array.isArray(d.categories) ? d.categories : []))
      .catch(() => {});
  }, []);

  const run = useCallback(() => {
    setLoading(true);
    const qp = new URLSearchParams({ from, to });
    if (category) qp.set("category", category);
    fetch(`${API}/api/reports/downloads?${qp.toString()}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, [from, to, category]);

  useEffect(() => { run(); }, [run]);

  // Straight to a file the finance office can open in Excel.
  const exportCsv = () => {
    if (!data?.rows?.length) return;
    const header = ["Date", "Full name", "Username", "Document", "Category", "Details", "Pages", "Fee/page", "Amount (ETB)", "Type"];
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(",")].concat(
      data.rows.map(r => [
        new Date(r.downloadedAt).toLocaleString(),
        r.fullName, r.username || "", r.title || "", r.categoryLabel || "", r.detail || "",
        r.pageCount ?? "", r.feePerPage ?? "", r.amount.toFixed(2),
        r.channel === "paid" ? "Paid" : "Staff (no fee)",
      ].map(esc).join(","))
    );
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `downloads_${data.from}_to_${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const preset = (days) => {
    setFrom(isoDay(new Date(Date.now() - (days - 1) * 864e5)));
    setTo(isoDay(new Date()));
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Download report</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Who downloaded what between two dates, and what the organisation earned.
        </p>
      </div>

      <div className="rep-controls">
        <label className="rep-field">
          <span>From</span>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className="rep-field">
          <span>To</span>
          <input type="date" value={to} min={from} max={isoDay(new Date())} onChange={e => setTo(e.target.value)} />
        </label>
        <label className="rep-field">
          <span>Category</span>
          <select value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <div className="rep-presets">
          <button onClick={() => preset(7)}>7 days</button>
          <button onClick={() => preset(30)}>30 days</button>
          <button onClick={() => preset(90)}>90 days</button>
        </div>
        <button className="rep-export" onClick={exportCsv} disabled={!data?.rows?.length}>
          Export CSV
        </button>
      </div>

      {loading && <div className="text-sm text-slate-400 p-6">Loading report…</div>}

      {!loading && data && (
        <>
          <div className="rep-tiles">
            <div className="rep-tile">
              <span className="rep-tile-label">Downloads</span>
              <span className="rep-tile-value">{data.totals.downloads}</span>
              <span className="rep-tile-sub">{data.totals.paidDownloads} paid · {data.totals.freeDownloads} free</span>
            </div>
            <div className="rep-tile">
              <span className="rep-tile-label">Revenue</span>
              <span className="rep-tile-value">{formatBirr(data.totals.revenue)}</span>
              <span className="rep-tile-sub">{data.from} → {data.to}</span>
            </div>
            <div className="rep-tile">
              <span className="rep-tile-label">People</span>
              <span className="rep-tile-value">{data.totals.uniqueUsers}</span>
              <span className="rep-tile-sub">distinct accounts</span>
            </div>
          </div>

          {data.byCategory.length > 0 && (
            <div className="rep-card">
              <div className="rep-card-head">By category</div>
              <table className="rep-table">
                <thead>
                  <tr><th>Category</th><th className="rep-num">Downloads</th><th className="rep-num">Revenue</th></tr>
                </thead>
                <tbody>
                  {data.byCategory.map(c => (
                    <tr key={c.category}>
                      <td>{c.label}</td>
                      <td className="rep-num">{c.downloads}</td>
                      <td className="rep-num">{formatBirr(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rep-card">
            <div className="rep-card-head">
              Every download
              {data.truncated && <span className="rep-warn">showing the most recent 1000 — narrow the dates</span>}
            </div>
            {data.rows.length === 0 ? (
              <div className="rep-empty">No downloads in this period.</div>
            ) : (
              <div className="rep-scroll">
                <table className="rep-table">
                  <thead>
                    <tr>
                      <th>Date</th><th>Full name</th><th>Document</th><th>Category</th>
                      <th>Details</th><th className="rep-num">Pages</th><th className="rep-num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(r => (
                      <tr key={r.id}>
                        <td className="rep-date">{new Date(r.downloadedAt).toLocaleString()}</td>
                        <td>
                          {r.userId ? (
                            <button
                              type="button"
                              className="rep-person"
                              onClick={() => setOpenAccount({ userId: r.userId, name: r.fullName })}
                              title="See this account"
                            >
                              {r.fullName}
                            </button>
                          ) : r.fullName}
                          {r.username && r.username !== r.fullName && <span className="rep-sub">@{r.username}</span>}
                        </td>
                        <td className="rep-title">{r.title || "—"}</td>
                        <td>{r.categoryLabel}</td>
                        <td className="rep-detail">{r.detail || "—"}</td>
                        <td className="rep-num">{r.pageCount ?? "—"}</td>
                        <td className="rep-num">
                          {r.channel === "paid"
                            ? formatBirr(r.amount)
                            : <span className="rep-free">No fee</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {openAccount && (
        <AccountModal
          userId={openAccount.userId}
          snapshotName={openAccount.name}
          currentUserId={currentUserId}
          onClose={() => setOpenAccount(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
const NAV = [
  { key: "library",   label: "Library",        icon: BookOpen      },
  { key: "overview",  label: "Overview",        icon: LayoutDashboard },
  { key: "access",    label: "Access control",  icon: ShieldCheck   },
  { key: "structure", label: "Library structure", icon: FolderTree  },
  { key: "roles",     label: "Roles & workflow", icon: ShieldCheck  },
  { key: "fees",      label: "Download fees",   icon: Download      },
  { key: "users",     label: "Users",           icon: Users         },
  { key: "sessions",  label: "Sessions",        icon: MonitorSmartphone },
  { key: "approvals", label: "Approval queue",  icon: ClipboardList },
  { key: "audit",     label: "Audit log",       icon: Activity      },
  { key: "documents", label: "Documents",       icon: FileText      },
  { key: "reports",   label: "Download report",  icon: FileBarChart2 },
  { key: "help",      label: "Help & Manual",    icon: HelpCircle    },
];

// ---------------------------------------------------------------------------
// Session Management — live view of every logged-in user (all roles), with
// idle time and a force-logout action. The client's heartbeat (see
// UseSessionManager.js) keeps last_active_at fresh; force-logout flips the
// user's status to Inactive, which their next heartbeat obeys.
// ---------------------------------------------------------------------------
function timeAgo(ts) {
  if (!ts) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SessionManagement({ currentUserId }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const fetchSessions = () => {
    fetch(`${API}/api/sessions/active`)
      .then(r => r.json())
      .then(data => { setSessions(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 15000); // live refresh every 15s
    return () => clearInterval(interval);
  }, []);

  const forceLogout = async (session) => {
    if (!window.confirm(`End ${session.username}'s session? They will be logged out within a minute.`)) return;
    setBusyId(session.id);
    try {
      await fetch(`${API}/api/sessions/force-logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: session.id, adminId: currentUserId }),
      });
      fetchSessions();
    } catch (err) {
      console.error("Force logout failed:", err);
      showAlert("Failed to end the session. Please try again.");
    }
    setBusyId(null);
  };

  // A session is "live" if the heartbeat has been seen in the last 2 minutes.
  const isLive = (s) => s.last_active_at && (Date.now() - new Date(s.last_active_at).getTime()) < 2 * 60 * 1000;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Active sessions</h2>
          <p className="text-xs text-slate-500 mt-0.5">Everyone currently signed in, any role. Sessions idle for 15 minutes are logged out automatically. Refreshes every 15s.</p>
        </div>
        <span className="text-xs font-medium text-slate-500">{sessions.length} active</span>
      </div>
      {loading ? (
        <div className="p-6 text-sm text-slate-500">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="p-6 text-sm text-slate-500">No one is currently signed in.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-5 py-2.5 font-medium">User</th>
              <th className="px-5 py-2.5 font-medium">Role</th>
              <th className="px-5 py-2.5 font-medium">Department</th>
              <th className="px-5 py-2.5 font-medium">Last active</th>
              <th className="px-5 py-2.5 font-medium">Status</th>
              <th className="px-5 py-2.5 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-900">{s.full_name || s.username}</div>
                  <div className="text-xs text-slate-500">@{s.username}{s.id === currentUserId ? " (you)" : ""}</div>
                </td>
                <td className="px-5 py-3 text-slate-600">{s.role}</td>
                <td className="px-5 py-3 text-slate-600">{s.department || "—"}</td>
                <td className="px-5 py-3 text-slate-600">{timeAgo(s.last_active_at)}</td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                    isLive(s) ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isLive(s) ? "bg-emerald-500" : "bg-amber-500"}`} />
                    {isLive(s) ? "Online" : "Idle"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  {s.id !== currentUserId && (
                    <button onClick={() => forceLogout(s)} disabled={busyId === s.id}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg px-2.5 py-1.5 hover:bg-red-50 disabled:opacity-50">
                      <LogOut className="w-3.5 h-3.5" />
                      {busyId === s.id ? "Ending..." : "Force logout"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AdminDashboard({ user, setUser }) {
  const [active, setActive]           = useState("library");
  const [matrix, setMatrix]           = useState(defaultMatrix);
  const [responsibility, setResponsibility] = useState(defaultResponsibility);
  const [pendingCount, setPendingCount] = useState(0);

  const currentUser = { id: user?.id, name: user?.username || "Admin", role: user?.role || "Department Head" };

  // Poll pending count for the sidebar badge and bell dot
  useEffect(() => {
    const refresh = () => {
      fetch(`${API}/api/dashboard/counters`)
        .then(r => r.json())
        .then(data => setPendingCount(data.pendingApprovals || 0))
        .catch(() => {});
    };
    refresh();
    const interval = setInterval(refresh, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Load saved access matrix + workflow responsibility from backend on mount.
  // FIXED: matrix was fetched from /api/access-control/matrix (404 on this
  // server — real route is /api/permissions). Responsibility is fetched from
  // the correct route but its array response is now converted into the
  // stage-keyed shape this component uses in state.
  useEffect(() => {
    fetch(`${API}/api/permissions`)
      .then(r => r.json())
      .then(data => { if (data) setMatrix(data); })
      .catch(() => {});

    fetch(`${API}/api/access-control/responsibility`)
      .then(r => r.json())
      .then(data => { if (data) setResponsibility(arrayToResponsibilityMap(data)); })
      .catch(() => {});
  }, []);

  return (
    <div className="admin-dashboard-root flex min-h-screen bg-slate-50 font-sans">
      <aside className="w-60 bg-slate-900 text-white flex flex-col flex-shrink-0">
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-white/10">
          <img src={libraryLogo} alt="Library logo" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
          <div>
            <div className="text-sm font-semibold leading-tight">EGI Admin</div>
            <div className="text-[11px] text-slate-400 leading-tight">Management dashboard
              
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
          {NAV.map(item => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <button key={item.key} onClick={() => setActive(item.key)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}>
                <Icon className="w-4 h-4" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.key === "approvals" && pendingCount > 0 && (
                  <span className="bg-amber-500 text-slate-900 text-[10px] font-semibold rounded-full px-1.5 py-0.5">{pendingCount}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-xs font-semibold">
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{currentUser.name}</div>
              <div className="text-[11px] text-slate-400 truncate">{currentUser.role}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
          <h1 className="text-base font-semibold text-slate-900">{NAV.find(n => n.key === active)?.label}</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input placeholder="Search..." className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200 w-48" />
            </div>
            <button className="relative w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50">
              <Bell className="w-4 h-4 text-slate-500" />
              {pendingCount > 0 && <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500" />}
            </button>
          </div>
        </header>

        <main className={active === "library" ? "flex-1 overflow-y-auto" : "flex-1 p-6 overflow-y-auto"}>
          {active === "library"   && <LibraryDashboard user={user} setUser={setUser} />}
          {active === "overview"  && <Overview currentUserId={currentUser.id} />}
          {active === "access"    && <AccessControlMatrix matrix={matrix} setMatrix={setMatrix} responsibility={responsibility} setResponsibility={setResponsibility} currentUserId={currentUser.id} />}
          {active === "structure" && <LibraryStructure currentUserId={currentUser.id} />}
          {active === "roles"     && <RolesAndWorkflow currentUserId={currentUser.id} />}
          {active === "fees"      && <ClassFees currentUserId={currentUser.id} />}
          {active === "users"     && <UserManagement currentUserId={currentUser.id} />}
          {active === "sessions"  && <SessionManagement currentUserId={currentUser.id} />}
          {active === "approvals" && <ApprovalQueue currentUser={currentUser} />}
          {active === "audit"     && <AuditLog />}
          {active === "documents" && <Documents />}
          {active === "reports"   && <DownloadReport currentUserId={currentUser.id} />}
          {active === "help"      && <Help role={currentUser.role} behaviour={user?.behaviour} />}
        </main>
      </div>
    </div>
  );
}