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

const STAGE_ORDER = ['officer', 'senior_officer', 'authorizer', 'approved'];

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

  const renderPipelineDot = (stageName, requestStage) => {
    const order = STAGE_ORDER;
    const reqIdx = order.indexOf(requestStage === 'rejected' ? -1 : requestStage);
    const thisIdx = order.indexOf(stageName);
    let state = 'pending';
    if (requestStage === 'rejected') state = 'rejected-context';
    else if (thisIdx < reqIdx) state = 'done';
    else if (thisIdx === reqIdx) state = 'current';

    return h('span', { className: `od-pipe-dot od-pipe-dot--${state}`, key: stageName });
  };

  const renderPipeline = (requestStage) => h('div', { className: 'od-pipeline' },
    h('span', { className: 'od-pipe-label' }, 'Officer'),
    renderPipelineDot('officer', requestStage),
    h('span', { className: 'od-pipe-line' }),
    renderPipelineDot('senior_officer', requestStage),
    h('span', { className: 'od-pipe-label' }, 'Sr. Officer'),
    h('span', { className: 'od-pipe-line' }),
    renderPipelineDot('authorizer', requestStage),
    h('span', { className: 'od-pipe-label' }, 'Dept. Head')
  );

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
        h('div', { className: 'od-request-target' }, r.targetLabel)
      ),

      renderMakerInfo(r),

      h('div', { className: 'od-reason-block' },
        h('span', { className: 'od-reason-label' }, 'Reason for request'),
        h('p', { className: 'od-reason-text' }, r.reason)
      ),

      !isHistory ? renderPipeline(r.stage) : null,

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