import React, { useState, useEffect, useCallback } from 'react';
import './MyRequests.css';

const API = "http://localhost:5000";

const STAGE_LABELS = {
  officer: 'Officer',
  senior_officer: 'Senior Officer',
  authorizer: 'Department Head',
};
export const PENDING_STAGES = ['officer', 'senior_officer', 'authorizer'];

// ----------------------------------------------------------------------------
// MyRequests — the maker's own view of every request they submitted (add,
// edit, delete, download): where it is in the chain, and the outcome once
// the chain completes. Rejections show the outcome only — never the
// reviewer's reason.
// ----------------------------------------------------------------------------
export default function MyRequests({ user }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchMine = useCallback(() => {
    if (!user?.id) return;
    fetch(`${API}/api/office-requests?makerId=${user.id}`)
      .then(r => r.json())
      .then(data => { setRequests(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    fetchMine();
    const interval = setInterval(fetchMine, 15000);
    return () => clearInterval(interval);
  }, [fetchMine]);

  const statusFor = (r) => {
    if (PENDING_STAGES.includes(r.stage)) {
      return { cls: 'mr-chip--pending', text: `Waiting for ${STAGE_LABELS[r.stage]} acceptance` };
    }
    if (r.stage === 'approved') {
      if (r.requestType === 'download') {
        return r.paymentStatus === 'paid'
          ? { cls: 'mr-chip--accepted', text: 'Accepted — you can download now' }
          : { cls: 'mr-chip--accepted', text: `Accepted — pay ${r.totalFee} ETB to download` };
      }
      const done = { add: 'record added to the library', edit: 'your changes were applied', delete: 'record deleted' };
      return { cls: 'mr-chip--accepted', text: `Accepted — ${done[r.requestedPermission] || 'applied'}` };
    }
    if (r.stage === 'rejected') {
      return { cls: 'mr-chip--rejected', text: 'Rejected' };
    }
    return { cls: 'mr-chip--pending', text: r.stage };
  };

  const typeLabel = (r) => {
    if (r.requestType === 'download') return 'Download';
    const map = { add: 'Add', edit: 'Edit', delete: 'Delete' };
    return map[r.requestedPermission] || r.requestType || '—';
  };

  return (
    <div className="mr-root">
      <div className="mr-header">
        <h3 className="mr-title">My Requests</h3>
        <p className="mr-subtitle">Every request you sent for acceptance — add, edit, delete and download — and where it stands.</p>
      </div>

      {loading ? (
        <div className="mr-empty">Loading your requests...</div>
      ) : requests.length === 0 ? (
        <div className="mr-empty">You haven't submitted any requests yet.</div>
      ) : (
        <table className="mr-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Type</th>
              <th>Request</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {requests.map(r => {
              const s = statusFor(r);
              return (
                <tr key={r.id}>
                  <td className="mr-code">{r.requestCode}</td>
                  <td>{typeLabel(r)}</td>
                  <td className="mr-target">{r.targetLabel}</td>
                  <td><span className={`mr-chip ${s.cls}`}>{s.text}</span></td>
                  <td className="mr-date">{r.created}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
