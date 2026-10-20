import React, { useState, useEffect, useCallback } from 'react';
import './Delegation.css';
import { askConfirm, showAlert } from './dialogs';

import { API } from '../config';

// ----------------------------------------------------------------------------
// DELEGATION — leave cover
//
// Hand your review duties to a colleague for a date range, and see what you
// are covering for other people.
//
// Dates rather than an on/off switch, on purpose: an open-ended handover is
// one people forget to turn off, and the authority quietly outlives the leave.
// ----------------------------------------------------------------------------

// What can be handed over. 'approvals' is authority over the delegator's step
// in the chain; the rest mirror the access matrix. Partial is the common case:
// cover my reviews, but do not also hand over deleting records.
const SCOPES = [
  { key: 'approvals', label: 'Approvals', hint: 'Decide on requests waiting at my step' },
  { key: 'add',       label: 'Add records',    hint: 'Create new library records' },
  { key: 'edit',      label: 'Edit records',   hint: 'Change existing records' },
  { key: 'delete',    label: 'Delete records', hint: 'Remove records' },
  { key: 'download',  label: 'Download',       hint: 'Download documents' },
];

// Rows read better as "Approvals, Download" than as the raw keys the API
// stores. An unknown key (an older record, a future scope) falls back to
// itself rather than vanishing from the row.
const SCOPE_LABEL = Object.fromEntries(SCOPES.map(sc => [sc.key, sc.label]));
const describeScopes = (scopes) =>
  (Array.isArray(scopes) && scopes.length ? scopes : ['approvals'])
    .map(k => SCOPE_LABEL[k] || k)
    .join(', ');

const daysLeft = (endsOn) => {
  const end = new Date(String(endsOn).slice(0, 10));
  const now = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((end - now) / 864e5);
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const asDay = (v) => (v ? String(v).slice(0, 10) : '—');

export default function Delegation({ user }) {
  const [given, setGiven] = useState([]);
  const [received, setReceived] = useState([]);
  const [colleagues, setColleagues] = useState([]);
  const [mine, setMine] = useState({ scopes: [], ownStage: null, ownStageLabel: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [toUserId, setToUserId] = useState('');
  const [startsOn, setStartsOn] = useState(today());
  const [endsOn, setEndsOn] = useState(plusDays(7));
  const [reason, setReason] = useState('');
  const [scopes, setScopes] = useState([]);
  const [saving, setSaving] = useState(false);

  // You can only offer what you hold, so the list is the intersection of the
  // full catalogue and this person's own responsibilities. The server checks
  // the same thing — hiding a box is a courtesy, not a control.
  const offered = SCOPES.filter(sc => mine.scopes.includes(sc.key));
  const toggleScope = (key) => setScopes(prev =>
    prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
  );
  const isFull = offered.length > 0 && offered.every(sc => scopes.includes(sc.key));

  const load = useCallback(() => {
    if (!user?.id) return;
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/delegations?userId=${user.id}`).then(r => r.json()),
      fetch(`${API}/api/users`).then(r => r.json()),
      fetch(`${API}/api/delegations/delegatable?userId=${user.id}`).then(r => r.json()),
    ])
      .then(([d, u, can]) => {
        setGiven(Array.isArray(d.given) ? d.given : []);
        setReceived(Array.isArray(d.received) ? d.received : []);
        // Anyone but yourself. The delegation itself carries the authority,
        // so the colleague's own role does not restrict who can cover.
        setColleagues((Array.isArray(u) ? u : []).filter(x => x.id !== user.id));
        const allowed = (can && Array.isArray(can.scopes)) ? can : { scopes: [], ownStage: null, ownStageLabel: null };
        setMine(allowed);
        // Default to approvals when they have it — covering a queue is the
        // usual reason for going through this page at all.
        setScopes(allowed.scopes.includes('approvals') ? ['approvals'] : []);
        setLoading(false);
      })
      .catch(err => { console.error(err); setError('Could not load delegations.'); setLoading(false); });
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // An administrator can change a role's permissions, or rename the role,
  // while this page is sitting open — and then what it offers is a lie. Reload
  // whenever the tab comes back to the front, which is when someone is about
  // to act on what they see.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!toUserId) return;
    if (scopes.length === 0) { setError('Choose at least one responsibility to hand over.'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`${API}/api/delegations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromUserId: user.id,
          toUserId: Number(toUserId),
          startsOn, endsOn,
          scopes,
          reason: reason.trim() || null,
          createdBy: user.id,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.message || 'Could not set that up.'); return; }
      setToUserId(''); setReason('');
      showAlert('Your duties are delegated. They take effect on the start date and end on their own.');
      load(); // also resets the tick-boxes to the default
    } catch (err) {
      console.error(err); setError('Could not reach the server.');
    } finally { setSaving(false); }
  };

  const end = async (row) => {
    const ok = await askConfirm({
      title: 'End delegation',
      okLabel: 'End it',
      message: `Stop ${row.toName} covering your duties? They keep anything they have already decided.`,
    });
    if (!ok) return;
    await fetch(`${API}/api/delegations/${row.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actingUserId: user.id }),
    });
    load();
  };

  if (loading) return <div className="dlg-root"><div className="dlg-loading">Loading…</div></div>;

  const canDelegate = offered.length > 0;

  return (
    <div className="dlg-root">
      <div className="dlg-head">
        <h2>Delegation</h2>
        <p>Going on leave? Hand your review duties to a colleague for a set period.</p>
      </div>

      {error && <div className="dlg-error">{error}</div>}

      {/* What I am covering for other people */}
      {received.filter(r => r.isActive).length > 0 && (
        <div className="dlg-card dlg-card--active">
          <div className="dlg-card-head">You are covering for</div>
          {received.filter(r => r.isActive).map(r => (
            <div key={r.id} className="dlg-row">
              <div>
                <div className="dlg-row-main">{r.fromName}</div>
                <div className="dlg-row-sub">
                  {describeScopes(r.effectiveScopes && r.effectiveScopes.length ? r.effectiveScopes : r.scopes)}
                  {' · ends '}{asDay(r.ends_on)}
                  {' '}({daysLeft(r.ends_on)} day{daysLeft(r.ends_on) === 1 ? '' : 's'} left)
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>
                {r.lapsedScopes && r.lapsedScopes.length > 0 && (
                  <div className="dlg-lapsed">
                    {describeScopes(r.lapsedScopes)} no longer applies — {r.fromRole || 'their role'} does
                    not have it any more.
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className="dlg-note">
            Their queue appears alongside your own in Office Dashboard Review. Anything you
            decide is recorded as you, acting on their behalf.
          </div>
        </div>
      )}

      {/* Hand mine over */}
      <div className="dlg-card">
        <div className="dlg-card-head">Hand over my duties</div>

        {!canDelegate ? (
          <div className="dlg-empty">
            Your role holds no approval step and no permissions of its own, so there is
            nothing to hand over.
          </div>
        ) : (
          <form onSubmit={submit} className="dlg-form">
            <div className="dlg-duty">
              {mine.ownStageLabel
                ? <>You handle <strong>{mine.ownStageLabel}</strong>. You can hand that over, along with
                   any other responsibility your role holds — and nothing it does not.</>
                : <>You can hand over the responsibilities your role holds — and nothing it does not.</>}
            </div>

            <label className="dlg-field">
              <span>Who covers for you</span>
              <select value={toUserId} onChange={e => setToUserId(e.target.value)} required>
                <option value="">Choose a colleague…</option>
                {colleagues.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.username}{c.role ? ` — ${c.role}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="dlg-dates">
              <label className="dlg-field">
                <span>From</span>
                <input type="date" value={startsOn} max={endsOn} onChange={e => setStartsOn(e.target.value)} required />
              </label>
              <label className="dlg-field">
                <span>Until</span>
                <input type="date" value={endsOn} min={startsOn} onChange={e => setEndsOn(e.target.value)} required />
              </label>
            </div>

            <div className="dlg-field">
              <span>What to hand over</span>
              <div className="dlg-scope-head">
                <button
                  type="button"
                  className={`dlg-scope-all ${isFull ? 'dlg-scope-all--on' : ''}`}
                  onClick={() => setScopes(isFull
                    ? (offered.some(sc => sc.key === 'approvals') ? ['approvals'] : [])
                    : offered.map(sc => sc.key))}
                >
                  {isFull ? 'Full delegation' : 'Select all'}
                </button>
              </div>
              <div className="dlg-scopes">
                {offered.map(sc => (
                  <button
                    key={sc.key}
                    type="button"
                    className={`dlg-scope ${scopes.includes(sc.key) ? 'dlg-scope--on' : ''}`}
                    onClick={() => toggleScope(sc.key)}
                  >
                    <span className="dlg-scope-check">{scopes.includes(sc.key) ? '✓' : ''}</span>
                    <span>
                      <span className="dlg-scope-label">{sc.label}</span>
                      <span className="dlg-scope-hint">{sc.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="dlg-scope-note">
                {offered.length < SCOPES.length && (
                  <>Only what <strong>{mine.role || 'your role'}</strong> holds is listed — you
                  cannot hand over a responsibility you do not have yourself.{' '}</>
                )}
                {offered.some(sc => sc.key === 'download') && (
                  <>Downloading is granted as a permission only — your stand-in keeps their own
                  role's fees and limits, so delegating never makes documents free.</>
                )}
              </div>
            </div>

            <label className="dlg-field">
              <span>Reason <em>(optional)</em></span>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Annual leave" maxLength={200} />
            </label>

            <div className="dlg-expiry">
              This ends by itself on <strong>{endsOn}</strong> — nobody has to remember to
              switch it off. You can also end it early at any time.
            </div>

            <button type="submit" className="dlg-submit" disabled={saving || !toUserId || scopes.length === 0}>
              {saving ? 'Setting up…' : 'Delegate'}
            </button>
          </form>
        )}
      </div>

      {/* History of what I have handed over */}
      {given.length > 0 && (
        <div className="dlg-card">
          <div className="dlg-card-head">My delegations</div>
          {given.map(row => (
            <div key={row.id} className={`dlg-row ${row.isActive ? '' : 'dlg-row--past'}`}>
              <div>
                <div className="dlg-row-main">
                  {row.toName}
                  {row.isActive
                    ? <span className="dlg-pill dlg-pill--on">Active</span>
                    : <span className="dlg-pill">{row.revoked_at ? 'Ended early' : 'Finished'}</span>}
                </div>
                <div className="dlg-row-sub">
                  {describeScopes(row.isActive && row.effectiveScopes && row.effectiveScopes.length
                    ? row.effectiveScopes : row.scopes)}
                  {' · '}{asDay(row.starts_on)} → {asDay(row.ends_on)}
                  {row.isActive && ` (${daysLeft(row.ends_on)} day${daysLeft(row.ends_on) === 1 ? '' : 's'} left)`}
                  {row.reason ? ` · ${row.reason}` : ''}
                </div>
                {row.isActive && row.lapsedScopes && row.lapsedScopes.length > 0 && (
                  <div className="dlg-lapsed">
                    {describeScopes(row.lapsedScopes)} no longer applies — your role does not have it
                    any more, so it is not being covered.
                  </div>
                )}
              </div>
              {row.isActive && (
                <button type="button" className="dlg-end" onClick={() => end(row)}>End now</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
