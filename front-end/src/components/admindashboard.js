import React, { useState, useEffect, useMemo } from "react";
import "./admindashboard.css";
import {
  LayoutDashboard, Users, ShieldCheck, ClipboardList, FileText,
  Search, Bell, Check, X, Eye, Pencil, Trash2, Download,
  UserPlus, Activity, FileBarChart2, Clock,
  AlertTriangle, CheckCircle2, XCircle, Filter, BookOpen, MonitorSmartphone, LogOut
} from "lucide-react";
import LibraryDashboard from "./Dashboard";
import StatDetailModal from "./StatDetailModal";
import libraryLogo from '../logo.png';
import { showAlert } from './dialogs';

import { API } from '../config';

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------
const ROLES = ["User", "Officer", "Senior Officer", "Department Head"];
const PERMISSIONS = ["view", "edit", "delete", "download"];

// The 3-step approval chain, in order. This matches server.js's
// STAGE_ORDER = ['officer', 'senior_officer', 'authorizer'] exactly —
// these keys are not display labels, they are the wire format the backend
// reads/writes under system_settings.responsibility_map.
const STAGE_DEFS = [
  { key: "officer",        label: "Officer (Step 1)" },
  { key: "senior_officer", label: "Senior Officer (Step 2)" },
  { key: "authorizer",     label: "Department Head (Step 3 — Final)" },
];

// Fixed chain for permission requests. Download requests instead carry
// their own r.requiredStages (varies by security class — see
// chainForClass() in server.js), so the approval queue reads that per-row
// instead of assuming this fixed chain applies to everyone.
const PERMISSION_CHAIN = ["officer", "senior_officer", "authorizer"];

const SECURITY_CLASSES = ["normal", "medium", "strict"];
const CLASS_LABELS = { normal: "Normal", medium: "Medium Restriction", strict: "Strict / Secure" };

const ROLE_COLORS = {
  User:             { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-400" },
  Officer:          { bg: "bg-blue-50",   text: "text-blue-700",  dot: "bg-blue-500"  },
  "Senior Officer": { bg: "bg-violet-50", text: "text-violet-700",dot: "bg-violet-500"},
  "Department Head":{ bg: "bg-emerald-50",text: "text-emerald-700",dot:"bg-emerald-500"},
};

const STAGE_COLORS = {
  officer:        { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-300"   },
  senior_officer: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-300" },
  authorizer:     { bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-300"},
};

const STAGE_SHORT_LABEL = { officer: "Officer", senior_officer: "Sr. Officer", authorizer: "Dept. Head" };

const PERM_ICON = { view: Eye, edit: Pencil, delete: Trash2, download: Download };

const defaultMatrix = {
  User:             { view: true,  edit: false, delete: false, download: false },
  Officer:          { view: true,  edit: true,  delete: false, download: true  },
  "Senior Officer": { view: true,  edit: true,  delete: true,  download: true  },
  "Department Head":{ view: true,  edit: true,  delete: true,  download: true  },
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
function arrayToResponsibilityMap(arr) {
  if (!Array.isArray(arr)) return { ...defaultResponsibility };
  const map = { ...defaultResponsibility };
  arr.forEach(entry => {
    if (entry && entry.stage && STAGE_DEFS.some(s => s.key === entry.stage)) {
      map[entry.stage] = entry.role;
    }
  });
  return map;
}

// Converts the stage-keyed object back into the array format the server
// expects to persist under system_settings.responsibility_map.
function responsibilityMapToArray(map) {
  return STAGE_DEFS.map(s => ({ stage: s.key, role: map[s.key] }));
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

  useEffect(() => {
    fetch(`${API}/api/settings/category-fees`)
      .then(r => r.json())
      .then(data => { if (data) setFees({ ...defaultCategoryFees, ...data }); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

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
            <p className="text-xs text-slate-500 mt-0.5">Click a permission button to grant or revoke it for a role, instantly. "Add" uses the same permission as "edit".</p>
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
          <p className="text-xs text-slate-500 mt-0.5">Assign which role reviews each of the 3 approval steps. "Maker" is not assigned here — anyone who submits a request acts as the maker for that request.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {STAGE_DEFS.map(stageDef => {
            const c = STAGE_COLORS[stageDef.key];
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
                      {CLASS_LABELS[r.securityClass] || r.securityClass || "Normal"}
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
              // Floor of 4% so a document with a single download still shows
              // a visible column instead of a sliver.
              const pct = Math.max((doc.downloads / maxDownloads) * 100, 4);
              return (
                <div
                  key={`${doc.name}-${i}`}
                  className="topdocs-col"
                  title={`${doc.name} — ${doc.dept} — ${doc.downloads} download${doc.downloads === 1 ? '' : 's'}`}
                >
                  <span className="topdocs-col-value">{doc.downloads}</span>

                  <div className="topdocs-col-plot">
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
// Shell
// ---------------------------------------------------------------------------
const NAV = [
  { key: "library",   label: "Library",        icon: BookOpen      },
  { key: "overview",  label: "Overview",        icon: LayoutDashboard },
  { key: "access",    label: "Access control",  icon: ShieldCheck   },
  { key: "fees",      label: "Download fees",   icon: Download      },
  { key: "users",     label: "Users",           icon: Users         },
  { key: "sessions",  label: "Sessions",        icon: MonitorSmartphone },
  { key: "approvals", label: "Approval queue",  icon: ClipboardList },
  { key: "audit",     label: "Audit log",       icon: Activity      },
  { key: "documents", label: "Documents",       icon: FileText      },
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
          {active === "fees"      && <ClassFees currentUserId={currentUser.id} />}
          {active === "users"     && <UserManagement currentUserId={currentUser.id} />}
          {active === "sessions"  && <SessionManagement currentUserId={currentUser.id} />}
          {active === "approvals" && <ApprovalQueue currentUser={currentUser} />}
          {active === "audit"     && <AuditLog />}
          {active === "documents" && <Documents />}
        </main>
      </div>
    </div>
  );
}