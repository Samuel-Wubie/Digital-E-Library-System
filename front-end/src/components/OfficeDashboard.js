import React, { useState, useEffect, useCallback } from 'react';
import './OfficeDashboard.css';
import { usePermissions } from './UsePermissions';
import { askSelect } from './dialogs';

const h = React.createElement;
import { API } from '../config';

// ----------------------------------------------------------------------------
// Office Dashboard — the reviewer screen for Officers, Senior Officers, and
// Department Heads. Each role only ever sees requests sitting at the stage
// that matches their role:
//   Officer         -> stage === 'officer'
//   Senior Officer  -> stage === 'senior_officer'
//   Department Head -> stage === 'authorizer'  (final step)
//
// For every request, the reviewer sees the maker's full name, username, ID,
// the file/target, the reason given, and (for permission requests) which
// permission is being asked for. Accept moves the request to the next step
// (or finalizes it at Department Head); Reject requires a reason and ends
// the chain immediately.
//
// Download requests use a VARIABLE-length chain (r.requiredStages) instead
// of the fixed 3-step permission chain — 'medium' security class stops
// after Senior Officer with no Department Head step; 'strict' goes through
// all three. The pipeline renderer below reads requiredStages per-row
// rather than assuming everyone uses the same fixed STAGE_ORDER.
//
// Usage:
//   <OfficeDashboard currentUser={{ id, username, role }} />
// ----------------------------------------------------------------------------

const ROLE_TO_STAGE = {
  'Officer': 'officer',
  'Senior Officer': 'senior_officer',
  'Department Head': 'authorizer',
};

const STAGE_LABEL = {
  officer: 'Officer review',
  senior_officer: 'Senior Officer review',
  authorizer: 'Department Head authorization',
  approved: 'Approved',
  rejected: 'Rejected',
};

// Fallbacks only, for the three steps the system shipped with. The live names
// come from /api/workflow — these steps have been renamed (Maker, Checker,
// Authorizer) and an administrator can add more, so nothing may read this.
const STAGE_SHORT_LABEL = {
  officer: 'Officer',
  senior_officer: 'Sr. Officer',
  authorizer: 'Dept. Head',
};

const CLASS_LABELS = { normal: 'Public', medium: 'Confidential', strict: 'Highly Confidential' };

// Fixed full chain for permission (add/edit/delete) requests. Download
// requests instead use r.requiredStages, since that varies by security class.
const PERMISSION_CHAIN = ['officer', 'senior_officer', 'authorizer'];

function formatBirr(amount) {
  return `ETB ${Number(amount || 0).toFixed(2)}`;
}

function OfficeDashboard({ currentUser }) {
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'history'
  const [pendingRequests, setPendingRequests] = useState([]);
  const [historyRequests, setHistoryRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState('');

  // Loaded once here and reused per-request below: a permission-type
  // request is checked against the MAKER's role (the person asking to gain
  // add/edit/delete), not the reviewing Officer/Senior Officer/Dept Head's
  // own role — they're reviewing someone else's request for a capability,
  // not exercising it themselves. We only need the raw matrix object; the
  // role argument here doesn't matter since we look up r.makerRole directly.
  const { matrix: accessMatrix } = usePermissions(currentUser?.role);

  // Every queue this person can work: their own step, plus any they are
  // covering while a colleague is on leave. Resolved by the server, because
  // roles and steps are administrator-defined and a stand-in has more than
  // one queue.
  const [myStages, setMyStages] = useState(null);

  // The live chain, so step names on screen are the ones the administrator
  // typed rather than the three the system shipped with.
  const [workflowSteps, setWorkflowSteps] = useState([]);
  useEffect(() => {
    fetch(`${API}/api/workflow`)
      .then(r => r.json())
      .then(d => setWorkflowSteps(Array.isArray(d.steps) ? d.steps : []))
      .catch(() => {});
  }, []);
  const stepLabel = (key) => {
    const st = workflowSteps.find(s => s.key === key);
    return (st && st.label) || STAGE_SHORT_LABEL[key] || key;
  };

  // The stage sequence for THIS request. Every request now stores the chain it
  // was created with — which varies by action and by classification — so that
  // is the first choice; the live chain and then the original three are only
  // fallbacks for rows written before required_stages existed.
  const chainFor = (r) => {
    if (r.requiredStages && r.requiredStages.length > 0) return r.requiredStages;
    if (workflowSteps.length > 0) return workflowSteps.map(s => s.key);
    return PERMISSION_CHAIN;
  };

  useEffect(() => {
    if (!currentUser?.id) return;
    fetch(`${API}/api/office-requests/my-stages?userId=${currentUser.id}`)
      .then(r => r.json())
      .then(d => setMyStages(d && Array.isArray(d.stages) ? d : { stages: [], delegated: [] }))
      .catch(() => setMyStages({ stages: [], delegated: [] }));
  }, [currentUser]);

  const myStage = myStages?.ownStage || null;
  const stages = myStages?.stages || [];
  const delegated = myStages?.delegated || [];

  const fetchRequests = useCallback(() => {
    if (!myStages) return;                 // still resolving
    if (stages.length === 0) {
      // Not about the role any more: a step belongs to the people named on it,
      // so the reason there is no queue is that nobody named this person.
      setError('You are not assigned to any approval step, so there is nothing here to review. An administrator assigns people to steps under Roles & workflow.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    Promise.all(stages.map(st =>
      fetch(`${API}/api/office-requests?stage=${st}`).then(r => r.json()).catch(() => [])
    ))
      .then(lists => {
        // One request can only sit at one stage, but de-duplicate anyway so a
        // repeated stage in the list cannot show the same row twice.
        const seen = new Set();
        const mine = [];
        lists.flat().forEach(r => {
          if (!r || seen.has(r.id)) return;
          seen.add(r.id);
          // Addressed to me, to nobody in particular, or to the colleague I
          // am covering for.
          const assignedElsewhere = r.assignedReviewerId &&
            String(r.assignedReviewerId) !== String(currentUser.id);
          if (assignedElsewhere && !delegated.length) return;
          mine.push(r);
        });
        setPendingRequests(mine);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load office requests:', err);
        setError('Could not load requests. Please try again.');
        setLoading(false);
      });
  }, [myStages, stages, delegated, currentUser]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // History tab: everything this reviewer has personally acted on. There is
  // no single backend filter for "acted on by me", so we fetch broadly by
  // each terminal/forward stage and filter client-side by the matching
  // reviewer-id column for this role.
  useEffect(() => {
    if (activeTab !== 'history' || stages.length === 0) return;
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/office-requests?stage=approved`).then(r => r.json()),
      fetch(`${API}/api/office-requests?stage=rejected`).then(r => r.json()),
    ]).then(([approved, rejected]) => {
      const all = [...(approved || []), ...(rejected || [])];
      const idKey = myStage === 'officer' ? 'officerId'
                  : myStage === 'senior_officer' ? 'seniorOfficerId'
                  : 'deptHeadId';
      const mine = all.filter(r => String(r[idKey]) === String(currentUser.id) || r.stage === 'rejected');
      setHistoryRequests(mine);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load history:', err);
      setLoading(false);
    });
  }, [activeTab, stages, myStage, currentUser]);

  const handleAccept = async (r) => {
    setActionError('');

    // If accepting forwards the request to another stage (not final),
    // the reviewer must pick the specific person at the next stage —
    // exactly like the maker did when submitting.
    let nextReviewerId = null;
    const chain = chainFor(r);
    const idx = chain.indexOf(r.stage);
    const isFinal = idx === -1 || idx === chain.length - 1;

    if (!isFinal) {
      const nextStage = chain[idx + 1];
      // Who staffs the next step, asked of the workflow. This used to list
      // everyone holding that step's role, which named the wrong people as
      // soon as a step belonged to named staff instead of a job title.
      const nextLabel = stepLabel(nextStage);
      try {
        const staffRes = await fetch(`${API}/api/workflow/step-staff?stepKey=${encodeURIComponent(nextStage)}`);
        const payload = await staffRes.json();
        const staff = staffRes.ok && Array.isArray(payload.staff) ? payload.staff : [];
        const options = staff
          .filter(u => String(u.id) !== String(currentUser.id))
          .map(u => ({ value: String(u.id), label: u.full_name ? `${u.full_name} (@${u.username})` : `@${u.username}` }));
        if (options.length > 0) {
          const picked = await askSelect({
            title: 'Forward Request',
            message: `${r.requestCode} — accept and forward to whom for ${nextLabel}?`,
            label: `Send to (${nextLabel})`,
            options,
          });
          if (!picked) return; // cancelled
          nextReviewerId = picked;
        }
      } catch (err) {
        console.error('Could not load next reviewers:', err);
      }
    }

    try {
      const res = await fetch(`${API}/api/office-requests/${r.id}/accept`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actingUserId: currentUser.id, nextReviewerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.message || 'Could not accept this request.');
        return;
      }
      fetchRequests();
    } catch (err) {
      console.error(err);
      setActionError('Could not reach the server. Please try again.');
    }
  };

  const handleRejectConfirm = async (requestId) => {
    if (!rejectReason.trim()) {
      setActionError('A reason is required to reject a request.');
      return;
    }
    setActionError('');
    try {
      const res = await fetch(`${API}/api/office-requests/${requestId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actingUserId: currentUser.id, rejectReason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.message || 'Could not reject this request.');
        return;
      }
      setRejectingId(null);
      setRejectReason('');
      fetchRequests();
    } catch (err) {
      console.error(err);
      setActionError('Could not reach the server. Please try again.');
    }
  };

  // --- Render helpers (React.createElement only, no JSX) ---

  const renderPipeline = (r) => {
    const chain = chainFor(r);
    const reqIdx = chain.indexOf(r.stage); // -1 once stage is 'approved' or 'rejected'

    const children = [];
    chain.forEach((stageName, i) => {
      let state = 'pending';
      if (r.stage === 'rejected') state = 'rejected-context';
      else if (r.stage === 'approved') state = 'done';
      else if (i < reqIdx) state = 'done';
      else if (i === reqIdx) state = 'current';

      children.push(h('span', { className: 'od-pipe-label', key: `label-${stageName}` }, stepLabel(stageName)));
      children.push(h('span', { className: `od-pipe-dot od-pipe-dot--${state}`, key: `dot-${stageName}` }));
      if (i < chain.length - 1) {
        children.push(h('span', { className: 'od-pipe-line', key: `line-${stageName}` }));
      }
    });

    return h('div', { className: 'od-pipeline' }, ...children);
  };

  const renderMakerInfo = (r) => h('div', { className: 'od-maker-card' },
    h('div', { className: 'od-maker-grid' },
      h('div', { className: 'od-maker-field' },
        h('span', { className: 'od-maker-label' }, 'Full name'),
        h('span', { className: 'od-maker-value' }, r.makerFullName || '\u2014')
      ),
      h('div', { className: 'od-maker-field' },
        h('span', { className: 'od-maker-label' }, 'Username'),
        h('span', { className: 'od-maker-value' }, r.makerUsername || '\u2014')
      ),
      h('div', { className: 'od-maker-field' },
        h('span', { className: 'od-maker-label' }, 'User ID'),
        h('span', { className: 'od-maker-value od-maker-id' }, `#${r.makerId}`)
      )
    )
  );

  // Fee/security-class context, shown only for download requests — this is
  // what the reviewer actually needs to know when deciding whether to
  // approve a paid download: what class it is and what it'll cost the
  // requester once approved.
  const renderDownloadContext = (r) => {
    if (r.requestType !== 'download') return null;
    return h('div', { className: 'od-download-context' },
      h('span', { className: 'od-download-class' }, CLASS_LABELS[r.securityClass] || r.securityClass || 'Public'),
      r.totalFee != null && h('span', { className: 'od-download-fee' },
        `${formatBirr(r.totalFee)} (${r.pageCount ?? '?'} pages @ ${formatBirr(r.feePerPage)}/page)`),
      r.paymentStatus && h('span', { className: `od-download-payment od-download-payment--${r.paymentStatus}` },
        r.paymentStatus === 'paid' ? 'Paid' : 'Unpaid')
    );
  };

  const renderRequestCard = (r, isHistory) => {
    const isRejecting = rejectingId === r.id;
    const isPermission = r.requestType === 'permission';

    // Matrix conflict check: this permission-type request asks for a
    // capability that's currently Denied for the maker's role in Access
    // Control. The chain still lets every reviewer see and reject it, but
    // Accept is blocked here AND on the server, so the UI can't be tricked
    // into showing it as actionable when the backend would refuse it.
    const matrixDenied = isPermission && accessMatrix &&
      accessMatrix[r.makerRole] && accessMatrix[r.makerRole][r.requestedPermission] === false;

    return h('div', { key: r.id, className: 'od-request-card' },
      h('div', { className: 'od-request-top' },
        h('div', { className: 'od-request-meta-row' },
          h('span', { className: 'od-request-code' }, r.requestCode),
          h('span', { className: `od-type-pill ${isPermission ? 'od-type-pill--permission' : 'od-type-pill--download'}` },
            isPermission ? `Permission: ${r.requestedPermission}` : 'Download'
          ),
          isHistory ? h('span', { className: `od-stage-pill od-stage-pill--${r.stage}` }, STAGE_LABEL[r.stage]) : null
        ),
        h('div', { className: 'od-request-target' }, r.targetLabel),
        renderDownloadContext(r)
      ),

      renderMakerInfo(r),

      h('div', { className: 'od-reason-block' },
        h('span', { className: 'od-reason-label' }, 'Reason for request'),
        h('p', { className: 'od-reason-text' }, r.reason)
      ),

      !isHistory ? renderPipeline(r) : null,

      (r.stage === 'rejected' && (r.officerRejectReason || r.seniorOfficerRejectReason || r.deptHeadRejectReason)) ?
        h('div', { className: 'od-rejection-note' },
          h('strong', null, 'Rejected: '),
          r.officerRejectReason || r.seniorOfficerRejectReason || r.deptHeadRejectReason
        ) : null,

      !isHistory ? h('div', { className: 'od-actions-row' },
        matrixDenied ? h('div', { className: 'od-matrix-conflict' },
          h('strong', null, 'Cannot accept: '),
          `'${r.requestedPermission}' is currently Denied for ${r.makerRole} in Access Control. `,
          'An admin must grant it there before this can be approved.'
        ) : null,

        h('button', {
          className: 'od-btn od-btn--accept',
          onClick: () => handleAccept(r),
          disabled: matrixDenied,
          title: matrixDenied ? 'Blocked by Access Control matrix' : undefined
        }, myStage === 'authorizer' ? 'Authorize' : 'Accept & forward'),

        isRejecting ? h('div', { className: 'od-reject-inline' },
          h('input', {
            autoFocus: true,
            className: 'od-reject-input',
            placeholder: 'Reason for rejection',
            value: rejectReason,
            onChange: (e) => setRejectReason(e.target.value)
          }),
          h('button', {
            className: 'od-btn od-btn--confirm-reject',
            onClick: () => handleRejectConfirm(r.id)
          }, 'Confirm'),
          h('button', {
            className: 'od-btn od-btn--cancel',
            onClick: () => { setRejectingId(null); setRejectReason(''); setActionError(''); }
          }, 'Cancel')
        ) : h('button', {
          className: 'od-btn od-btn--reject',
          onClick: () => { setRejectingId(r.id); setActionError(''); }
        }, 'Reject')
      ) : null
    );
  };

  const list = activeTab === 'pending' ? pendingRequests : historyRequests;

  // Someone covering for a colleague has queues even though their own role
  // may staff no step, so this guards on the full list.
  if (stages.length === 0) {
    return h('div', { className: 'office-dashboard-root' },
      h('div', { className: 'od-empty-state' }, error || 'Loading\u2026')
    );
  }

  return h('div', { className: 'office-dashboard-root' },
    h('div', { className: 'od-header' },
      h('div', null,
        h('h1', { className: 'od-title' }, 'Office Dashboard'),
        // The step, not the job title: a person is named on a step, and that
        // is what decides what appears below.
        h('p', { className: 'od-subtitle' },
          myStage
            ? `Reviewing ${myStages.ownStageLabel || stepLabel(myStage)} \u2014 ${currentUser.username}`
            : `Reviewing \u2014 ${currentUser.username}`
        ),
        // Say plainly whose queue is mixed in, so a decision taken on someone
        // else's behalf is never taken by accident.
        delegated.length > 0 && h('div', { className: 'od-delegation-banner' },
          delegated.map(d =>
            h('div', { key: d.stage },
              `Also covering ${d.stageLabel} for ${d.fromName} until ${String(d.endsOn).slice(0, 10)}`
            )
          )
        )
      )
    ),

    h('div', { className: 'od-tabs' },
      h('button', {
        className: `od-tab ${activeTab === 'pending' ? 'od-tab--active' : ''}`,
        onClick: () => setActiveTab('pending')
      }, `Pending (${pendingRequests.length})`),
      h('button', {
        className: `od-tab ${activeTab === 'history' ? 'od-tab--active' : ''}`,
        onClick: () => setActiveTab('history')
      }, 'History')
    ),

    actionError ? h('div', { className: 'od-action-error' }, actionError) : null,

    loading ? h('div', { className: 'od-empty-state' }, 'Loading...') :
    error ? h('div', { className: 'od-empty-state od-empty-state--error' }, error) :
    list.length === 0 ? h('div', { className: 'od-empty-state' },
      activeTab === 'pending' ? 'No requests waiting on you right now.' : 'No reviewed requests yet.'
    ) :
    h('div', { className: 'od-request-list' }, list.map(r => renderRequestCard(r, activeTab === 'history')))
  );
}

export default OfficeDashboard;