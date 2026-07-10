import React, { useState, useEffect, useMemo } from "react";
import "./admindashboard.css";
import {
  LayoutDashboard, Users, ShieldCheck, ClipboardList, FileText,
  Search, Bell, Check, X, Eye, Pencil, Trash2, Download,
  UserPlus, Activity, FileBarChart2, Clock,
  AlertTriangle, CheckCircle2, XCircle, Filter, BookOpen
} from "lucide-react";
import LibraryDashboard from "./Dashboard";
import StatDetailModal from "./StatDetailModal";

const API = "http://localhost:5000";

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------
const ROLES = ["User", "Officer", "Senior Officer", "Department Head"];
const PERMISSIONS = ["view", "edit", "delete", "download"];
const RESPONSIBILITIES = ["Maker", "Checker", "Authorizer", "None"];

const ROLE_COLORS = {
  User:             { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-400" },
  Officer:          { bg: "bg-blue-50",   text: "text-blue-700",  dot: "bg-blue-500"  },
  "Senior Officer": { bg: "bg-violet-50", text: "text-violet-700",dot: "bg-violet-500"},
  "Department Head":{ bg: "bg-emerald-50",text: "text-emerald-700",dot:"bg-emerald-500"},
};

const RESP_COLORS = {
  Maker:      { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-300",  solid: "bg-amber-500"  },
  Checker:    { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-300",   solid: "bg-blue-500"   },
  Authorizer: { bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-300",solid: "bg-emerald-500"},
  None:       { bg: "bg-slate-50",  text: "text-slate-500",  border: "border-slate-200",  solid: "bg-slate-300"  },
};

const PERM_ICON = { view: Eye, edit: Pencil, delete: Trash2, download: Download };

const defaultMatrix = {
  User:             { view: true,  edit: false, delete: false, download: false },
  Officer:          { view: true,  edit: true,  delete: false, download: true  },
  "Senior Officer": { view: true,  edit: true,  delete: true,  download: true  },
  "Department Head":{ view: true,  edit: true,  delete: true,  download: true  },
};

const defaultResponsibility = {
  User: "None", Officer: "Maker", "Senior Officer": "Checker", "Department Head": "Authorizer",
};

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
    checker:     { text: "Awaiting checker",    cls: "text-blue-700 bg-blue-50"    },
    authorizer:  { text: "Awaiting authorizer", cls: "text-emerald-700 bg-emerald-50" },
    approved:    { text: "Approved",            cls: "text-emerald-700 bg-emerald-50" },
    rejected:    { text: "Rejected",            cls: "text-red-700 bg-red-50"      },
  };
  const m = map[stage] || map.checker;
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

function ApprovalPipeline({ stage, checker, authorizer, requestedBy, size = "md" }) {
  const stages = [
    { key: "maker",      label: "Maker",      who: requestedBy, color: RESP_COLORS.Maker      },
    { key: "checker",    label: "Checker",    who: checker,     color: RESP_COLORS.Checker    },
    { key: "authorizer", label: "Authorizer", who: authorizer,  color: RESP_COLORS.Authorizer },
  ];
  const order = ["maker", "checker", "authorizer", "approved"];
  const small = size === "sm";

  return (
    <div className="flex items-center gap-0">
      {stages.map((s, i) => {
        let state = "pending";
        if (stage === "rejected")       { state = i === 0 ? "done" : i === 1 ? "rejected" : "pending"; }
        else if (stage === "approved")  { state = "done"; }
        else {
          const idx = order.indexOf(stage);
          if (i < idx) state = "done";
          else if (i === idx) state = "active";
        }
        const isDone = state === "done", isActive = state === "active", isRejected = state === "rejected";
        return (
          <React.Fragment key={s.key}>
            <div className="flex flex-col items-center gap-1" style={{ minWidth: small ? 64 : 84 }}>
              <div className={`flex items-center justify-center rounded-full border-2 ${small ? "w-7 h-7" : "w-9 h-9"} ${
                isDone     ? `${s.color.solid} border-transparent` :
                isActive   ? `bg-white ${s.color.border} ${s.color.text}` :
                isRejected ? "bg-red-500 border-transparent" :
                             "bg-slate-50 border-slate-200 text-slate-400"
              }`}>
                {isDone ? <Check className="w-4 h-4 text-white" /> :
                 isRejected ? <X className="w-4 h-4 text-white" /> :
                 isActive ? <Clock className={`w-4 h-4 ${s.color.text}`} /> :
                 <span className="text-xs font-medium">{i + 1}</span>}
              </div>
              <div className={`text-center ${small ? "text-[10px]" : "text-xs"}`}>
                <div className={`font-medium ${isActive ? s.color.text : isDone ? "text-slate-700" : "text-slate-400"}`}>{s.label}</div>
                {!small && s.who && <div className="text-slate-400 truncate max-w-[80px]">{s.who}</div>}
              </div>
            </div>
            {i < stages.length - 1 && (
              <div className={`h-0.5 flex-1 mb-5 ${small ? "max-w-[20px]" : "max-w-[32px]"} ${
                (stage === "rejected" && i === 0) ? "bg-slate-200" :
                order.indexOf(stage === "approved" ? "approved" : stage) > i || stage === "approved" ? "bg-slate-300" : "bg-slate-200"
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
              <ApprovalPipeline stage={r.stage} checker={null} authorizer={null} requestedBy={r.requestedBy} size="sm" />
            </div>
          ))}
        </div>
      </div>

      {openModal && <StatDetailModal kind={openModal} onClose={() => setOpenModal(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access Control Matrix — persists changes to the backend
// ---------------------------------------------------------------------------
function AccessControlMatrix({ matrix, setMatrix, responsibility, setResponsibility, currentUserId }) {
  const toggle = async (role, perm) => {
    const newMatrix = { ...matrix, [role]: { ...matrix[role], [perm]: !matrix[role][perm] } };
    setMatrix(newMatrix);
    try {
      await fetch(`${API}/api/access-control/matrix`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix: newMatrix, changedBy: currentUserId }),
      });
    } catch (err) { console.error("Failed to save matrix:", err); }
  };

  // RE-ENGINEERED: Persists Maker-Checker administrative assignment layers downstream to Backend Controllers
  const changeResponsibility = async (role, resp) => {
    const updatedResponsibility = { ...responsibility, [role]: resp };
    setResponsibility(updatedResponsibility);
    try {
      await fetch(`${API}/api/access-control/responsibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responsibility: updatedResponsibility, changedBy: currentUserId }),
      });
    } catch (err) { console.error("Failed to persist operational workflow configuration changes:", err); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Dynamic access control</h3>
            <p className="text-xs text-slate-500 mt-0.5">Click a permission button to grant or revoke it for a role, instantly.</p>
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
          <p className="text-xs text-slate-500 mt-0.5">Who initiates (maker), reviews (checker), and approves (authorizer) sensitive actions for each role.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {ROLES.map(role => (
            <div key={role} className="px-5 py-3 flex items-center justify-between flex-wrap gap-3">
              <RoleBadge role={role} />
              <div className="flex items-center gap-2">
                {RESPONSIBILITIES.map(r => (
                  <button key={r}
                    onClick={() => changeResponsibility(role, r)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      responsibility[role] === r
                        ? `${RESP_COLORS[r].bg} ${RESP_COLORS[r].text} ${RESP_COLORS[r].border}`
                        : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ))}
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
// ---------------------------------------------------------------------------
function ApprovalQueue({ currentUser }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab]   = useState("pending");
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchRequests = () => {
    fetch(`${API}/api/approval-requests`)
      .then(r => r.json())
      .then(data => { setRequests(data); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  };
  useEffect(() => { fetchRequests(); }, []);

  const handleApprove = async (numericId) => {
    try {
      const res = await fetch(`${API}/api/approval-requests/${numericId}/advance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actingUserId: currentUser.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.message);
        return;
      }
      fetchRequests();
    } catch (err) { console.error(err); }
  };

  const handleReject = async (numericId, reason) => {
    try {
      await fetch(`${API}/api/approval-requests/${numericId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actingUserId: currentUser.id, rejectReason: reason }),
      });
      setRejectingId(null);
      setRejectReason("");
      fetchRequests();
    } catch (err) { console.error(err); }
  };

  const pending  = requests.filter(r => r.stage === "checker" || r.stage === "authorizer");
  const resolved = requests.filter(r => r.stage === "approved" || r.stage === "rejected");
  const list = activeTab === "pending" ? pending : resolved;

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
        {list.map(r => (
          <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-slate-400">{r.id}</span>
                  <StageLabel stage={r.stage} />
                </div>
                <div className="text-sm font-medium text-slate-800">{r.action} &middot; {r.target}</div>
                <div className="text-xs text-slate-500 mt-1">{r.reason}</div>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-400 flex-wrap">
                  <RoleBadge role={r.requestedByRole} />
                  <span>requested by {r.requestedBy}</span>
                  <span>&middot;</span>
                  <span>{r.created}</span>
                </div>
                {r.stage === "rejected" && r.rejectReason && (
                  <div className="mt-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5" /> {r.rejectReason}
                  </div>
                )}
              </div>
              <ApprovalPipeline stage={r.stage} checker={r.checker} authorizer={r.authorizer} requestedBy={r.requestedBy} />
            </div>

            {(r.stage === "checker" || r.stage === "authorizer") && (
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100 flex-wrap">
                <button onClick={() => handleApprove(r.numericId || r.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {r.stage === "checker" ? "Approve & forward to authorizer" : "Authorize & finalize"}
                </button>
                {rejectingId === r.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input autoFocus value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection"
                      className="flex-1 text-xs rounded-lg border border-red-200 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-200" />
                    <button onClick={() => handleReject(r.numericId || r.id, rejectReason)}
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
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Log — fetches from API with severity filter
// ---------------------------------------------------------------------------
function AuditLog() {
  const [auditLog, setAuditLog] = useState([]);
  const [filter, setFilter]     = useState("All");
  const [loading, setLoading]   = useState(true);
  const severities = ["All", "success", "warning", "danger", "info"];

  useEffect(() => {
    const url = filter === "All"
      ? `${API}/api/audit-logs?limit=100`
      : `${API}/api/audit-logs?severity=${filter}&limit=100`;
    setLoading(true);
    fetch(url)
      .then(r => r.json())
      .then(data => { setAuditLog(data); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, [filter]);

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
        {!loading && auditLog.map(a => (
          <div key={a.id} className="px-5 py-3 flex items-start gap-3">
            <span className={`mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${sevStyle[a.severity] || sevStyle.info}`}>{a.action}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-700">{a.detail}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {a.user} {a.role !== "—" && `· ${a.role}`} · {a.time}
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
function Documents() {
  const [docs, setDocs]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/dashboard/top-downloads`)
      .then(r => r.json())
      .then(data => { setDocs(data); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, []);

  if (loading) return <div className="text-sm text-slate-400 p-6">Loading documents...</div>;
  const maxDownloads = docs.length ? Math.max(...docs.map(d => d.downloads)) : 1;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">Highly downloaded documents</h3>
        <p className="text-xs text-slate-500 mt-0.5">Across all departments, all time</p>
      </div>
      <div className="p-5 flex flex-col gap-4">
        {docs.map((doc, i) => (
          <div key={doc.name || i} className="flex items-center gap-4">
            <span className="text-xs font-medium text-slate-400 w-4">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-slate-700 truncate flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  {doc.name}
                </span>
                <span className="text-xs font-semibold text-slate-600">{doc.downloads}</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${Math.round((doc.downloads / maxDownloads) * 100)}%` }} />
              </div>
              <div className="text-xs text-slate-400 mt-1">{doc.dept}</div>
            </div>
          </div>
        ))}
      </div>
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
  { key: "users",     label: "Users",           icon: Users         },
  { key: "approvals", label: "Approval queue",  icon: ClipboardList },
  { key: "audit",     label: "Audit log",       icon: Activity      },
  { key: "documents", label: "Documents",       icon: FileText      },
];

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

  // Load saved access matrix from backend on mount
  useEffect(() => {
    fetch(`${API}/api/access-control/matrix`)
      .then(r => r.json())
      .then(data => { if (data) setMatrix(data); })
      .catch(() => {});

    fetch(`${API}/api/access-control/responsibility`)
      .then(r => r.json())
      .then(data => { if (data) setResponsibility(data); })
      .catch(() => {});
  }, []);

  return (
    <div className="admin-dashboard-root flex min-h-screen bg-slate-50 font-sans">
      <aside className="w-60 bg-slate-900 text-white flex flex-col flex-shrink-0">
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center font-semibold text-sm">G</div>
          <div>
            <div className="text-sm font-semibold leading-tight">GIE / EGI Admin</div>
            <div className="text-[11px] text-slate-400 leading-tight">Management console</div>
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
          {active === "users"     && <UserManagement currentUserId={currentUser.id} />}
          {active === "approvals" && <ApprovalQueue currentUser={currentUser} />}
          {active === "audit"     && <AuditLog />}
          {active === "documents" && <Documents />}
        </main>
      </div>
    </div>
  );
}