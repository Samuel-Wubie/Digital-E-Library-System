import React, { useState, useEffect, useCallback } from 'react';
import './OfficeDashboard.css';
import { usePermissions } from './UsePermissions';

const h = React.createElement;
const API = "http://localhost:5000";

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

const STAGE_SHORT_LABEL = {
  officer: 'Officer',
  senior_officer: 'Sr. Officer',
  authorizer: 'Dept. Head',
};

const CLASS_LABELS = { normal: 'Normal', medium: 'Medium Restriction', strict: 'Strict / Secure' };

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

  const myStage = ROLE_TO_STAGE[currentUser?.role];

  const fetchRequests = useCallback(() => {
    if (!myStage) {
      setError(`Your role (${currentUser?.role || 'unknown'}) does not review requests in the Office Dashboard.`);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    fetch(`${API}/api/office-requests?stage=${myStage}`)
      .then(res => res.json())
      .then(data => { setPendingRequests(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(err => {
        console.error('Failed to load office requests:', err);
        setError('Could not load requests. Please try again.');
        setLoading(false);
      });
  }, [myStage, currentUser]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // History tab: everything this reviewer has personally acted on. There is
  // no single backend filter for "acted on by me", so we fetch broadly by
  // each terminal/forward stage and filter client-side by the matching
  // reviewer-id column for this role.
  useEffect(() => {
    if (activeTab !== 'history' || !myStage) return;
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
  }, [activeTab, myStage, currentUser]);

  const handleAccept = async (requestId) => {
    setActionError('');
    try {
      const res = await fetch(`${API}/api/office-requests/${requestId}/accept`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actingUserId: currentUser.id }),
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

  // chain: the actual stage sequence for THIS request (varies for
  // downloads by security class; fixed for permission requests).
  const renderPipeline = (r) => {
    const chain = r.requestType === 'download' && r.requiredStages && r.requiredStages.length > 0
      ? r.requiredStages
      : PERMISSION_CHAIN;
    const reqIdx = chain.indexOf(r.stage); // -1 once stage is 'approved' or 'rejected'

    const children = [];
    chain.forEach((stageName, i) => {
      let state = 'pending';
      if (r.stage === 'rejected') state = 'rejected-context';
      else if (r.stage === 'approved') state = 'done';
      else if (i < reqIdx) state = 'done';
      else if (i === reqIdx) state = 'current';

      children.push(h('span', { className: 'od-pipe-label', key: `label-${stageName}` }, STAGE_SHORT_LABEL[stageName] || stageName));
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
      h('span', { className: 'od-download-class' }, CLASS_LABELS[r.securityClass] || r.securityClass || 'Normal'),
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
          onClick: () => handleAccept(r.id),
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

  if (!myStage) {
    return h('div', { className: 'office-dashboard-root' },
      h('div', { className: 'od-empty-state' }, error)
    );
  }

  return h('div', { className: 'office-dashboard-root' },
    h('div', { className: 'od-header' },
      h('div', null,
        h('h1', { className: 'od-title' }, 'Office Dashboard'),
        h('p', { className: 'od-subtitle' },
          `Reviewing as ${currentUser.role} \u2014 ${currentUser.username}`
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