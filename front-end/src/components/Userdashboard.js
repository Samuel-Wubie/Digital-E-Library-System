import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './Dashboard.css';
import './UserDashboard.css';
import FilterDropdown from './FilterDropdown';
import { usePermissions } from './UsePermissions';

const h = React.createElement;
import { API } from '../config';

// ============================================================================
// BACKEND CONTRACT — matches the real server.js exactly (verified against
// the actual file, not assumed):
//
// 1. books.security_class: 'normal' | 'medium' | 'strict' (default 'normal')
//
// 2. GET  /api/settings/class-fees -> { normal, medium, strict } (flat ETB
//    per-page numbers, NOT nested { perPage } objects). Admin-editable via
//    PUT /api/settings/class-fees from admindashboard.js.
//
// 3. POST /api/downloads/initiate  { bookId }
//    -> { bookId, title, securityClass, pageCount, feePerPage, totalFee,
//         requiresApproval, approvalChain }
//    Read-only quote — does not create a request.
//
// 4. POST /api/downloads/request  { bookId, userId, reason }
//    Creates the approval_requests row. Normal-class books land on stage
//    'approved' immediately (no chain); medium/strict start at the first
//    stage of chainForClass(securityClass) = ['officer','senior_officer']
//    or ['officer','senior_officer','authorizer']. Response is a raw
//    RETURNING * row — snake_case columns (request.stage, request.id,
//    request.request_code), NOT the camelCase shape GET /api/office-requests
//    returns.
//
// 5. POST /api/payments/checkout  { requestId, userId, gateway }
//    Only works once the request's stage is 'approved'. Marks
//    payment_status = 'paid', returns { success, request, downloadUrl }
//    where downloadUrl is a path (needs the API origin prefixed).
//
// 6. GET  /api/office-requests?makerId={id}&requestType=download
//    Returns this user's download-type requests, camelCase aliased,
//    including targetBookId, securityClass, requiredStages, feePerPage,
//    pageCount, totalFee, paymentStatus.
// ============================================================================

const CLASS_LABELS = {
  normal: 'Normal',
  medium: 'Medium Restriction',
  strict: 'Strict / Secure',
};

const CLASS_BADGE_CLASS = {
  normal: 'ud-badge ud-badge--normal',
  medium: 'ud-badge ud-badge--medium',
  strict: 'ud-badge ud-badge--strict',
};

// Fallback chain shape for the pre-request quote preview (before a request
// row exists to read requiredStages from). Mirrors server.js's
// chainForClass() exactly.
const CLASS_CHAIN = {
  medium: ['officer', 'senior_officer'],
  strict: ['officer', 'senior_officer', 'authorizer'],
};

const STAGE_LABELS = {
  officer: 'Officer',
  senior_officer: 'Senior Officer',
  authorizer: 'Department Head',
};

// Matches server.js's getClassFees() fallback exactly.
const DEFAULT_FEES = { normal: 2, medium: 5, strict: 10 };

function getSecurityClass(book) {
  return book?.security_class || 'normal';
}

function formatBirr(amount) {
  return `ETB ${Number(amount || 0).toFixed(2)}`;
}

const UserDashboard = ({ user, setUser }) => {
  // --- CORE LIBRARY STATE (same shape as Dashboard.js) ---
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const [formData, setFormData] = useState({
    title: '', author: '', subject: '', call_number: '', department: '', location: '', published_year: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [filters, setFilters] = useState({
    title: '', author: '', subject: '', callNumber: '', department: '', location: '', year: ''
  });
  const [viewModal, setViewModal] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);

  // --- DOWNLOAD WORKFLOW STATE ---
  const [fees, setFees] = useState(DEFAULT_FEES);
  const [myRequests, setMyRequests] = useState([]);
  const [activeTab, setActiveTab] = useState('library'); // 'library' | 'requests'
  const [flow, setFlow] = useState(null);
  // flow shape: { book, step: 'reason'|'pending'|'rejected'|'fee'|'payment', requestId, request }
  const [reasonText, setReasonText] = useState('');
  const [flowError, setFlowError] = useState('');
  const [flowBusy, setFlowBusy] = useState(false);
  const [seenIds, setSeenIds] = useState(() => {
    try {
      const raw = localStorage.getItem(`ud_seen_requests_${user?.id}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const { can: canDo } = usePermissions(user?.role);
  const canEdit = canDo('edit');
  const canDelete = canDo('delete');
  const canAdd = canDo('edit');
  const baseCanDownload = canDo('download');

  const isPrivilegedAdmin =
    user?.role === 'admin' ||
    user?.role === 'Department Head' ||
    user?.role === 'Senior Officer' ||
    user?.role === 'manager';

  // --- FETCH BOOKS (unchanged pipeline from Dashboard.js) ---
  useEffect(() => {
    const fetchBooksFromDatabase = () => {
      setLoading(true);
      const queryParams = new URLSearchParams();
      if (filters.title) queryParams.append('title', filters.title);
      if (filters.author) queryParams.append('author', filters.author);
      if (filters.subject) queryParams.append('subject', filters.subject);
      if (filters.callNumber) queryParams.append('callNumber', filters.callNumber);
      if (filters.department) queryParams.append('department', filters.department);
      if (filters.location) queryParams.append('location', filters.location);
      if (filters.year) queryParams.append('year', filters.year);

      fetch(`${API}/api/books/search?${queryParams.toString()}`)
        .then(res => res.json())
        .then(data => { setBooks(data); setLoading(false); })
        .catch(err => { console.error("Database fetch query failure:", err); setLoading(false); });
    };
    const delayDebounceFn = setTimeout(fetchBooksFromDatabase, 400);
    return () => clearTimeout(delayDebounceFn);
  }, [filters]);

  // --- FETCH FEE SCHEDULE (admin-configurable, flat per-class numbers) ---
  useEffect(() => {
    fetch(`${API}/api/settings/class-fees`)
      .then(res => res.json())
      .then(data => { if (data) setFees({ ...DEFAULT_FEES, ...data }); })
      .catch(() => { /* keep DEFAULT_FEES fallback silently */ });
  }, []);

  // --- POLL THIS USER'S OWN DOWNLOAD REQUESTS ---
  const fetchMyRequests = useCallback(() => {
    if (!user?.id) return;
    fetch(`${API}/api/office-requests?makerId=${user.id}&requestType=download`)
      .then(res => res.json())
      // Defensive client-side filter in case an older server build ignores
      // the requestType param and returns permission requests too.
      .then(data => setMyRequests(Array.isArray(data) ? data.filter(r => r.requestType === 'download') : []))
      .catch(err => console.error("Failed to load my download requests:", err));
  }, [user]);

  useEffect(() => {
    fetchMyRequests();
    const interval = setInterval(fetchMyRequests, 15000);
    return () => clearInterval(interval);
  }, [fetchMyRequests]);

  const persistSeenIds = (ids) => {
    setSeenIds(ids);
    try { localStorage.setItem(`ud_seen_requests_${user?.id}`, JSON.stringify(ids)); } catch { /* noop */ }
  };

  const unseenResolvedCount = useMemo(() => {
    return myRequests.filter(r =>
      (r.stage === 'approved' || r.stage === 'rejected') && !seenIds.includes(r.id)
    ).length;
  }, [myRequests, seenIds]);

  const markAllSeen = () => {
    persistSeenIds(myRequests.map(r => r.id));
  };

  // --- FILTER OPTIONS (unchanged) ---
  const departmentOptions = useMemo(() => {
    const values = books.map(b => b.department).filter(Boolean);
    return Array.from(new Set(values)).sort();
  }, [books]);

  const locationOptions = useMemo(() => {
    const values = books.map(b => b.location).filter(Boolean);
    return Array.from(new Set(values)).sort();
  }, [books]);

  const yearOptions = useMemo(() => {
    const values = books.map(b => b.published_year).filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => b - a);
  }, [books]);

  // --- FIND THE MOST RECENT DOWNLOAD REQUEST FOR A GIVEN BOOK ---
  const getRequestForBook = (bookId) => {
    const matches = myRequests.filter(r => String(r.targetBookId) === String(bookId));
    if (matches.length === 0) return null;
    return matches.reduce((latest, r) => (!latest || r.id > latest.id ? r : latest), null);
  };

  const chargeablePages = (book) => book?.page_count || 1;

  const feeForBook = (book) => {
    const cls = getSecurityClass(book);
    const rate = fees[cls] || 0;
    return chargeablePages(book) * rate;
  };

  // --- WORKFLOW ENTRY POINT ---
  const handleDownloadClick = (book) => {
    if (!baseCanDownload) {
      alert("Access Denied: Your role does not have download permission.");
      return;
    }
    if (!book.file_path) {
      alert("No file available for download.");
      return;
    }

    const cls = getSecurityClass(book);
    setFlowError('');

    if (cls === 'normal') {
      // No request exists yet — created lazily when they hit "Proceed to Payment".
      setFlow({ book, step: 'fee' });
      return;
    }

    const existing = getRequestForBook(book.id);
    const chain = (existing && existing.requiredStages) || CLASS_CHAIN[cls] || [];

    if (existing && existing.stage === 'rejected') {
      setFlow({ book, step: 'rejected', requestId: existing.id, request: existing });
      return;
    }

    if (existing && chain.includes(existing.stage)) {
      setFlow({ book, step: 'pending', requestId: existing.id, request: existing });
      return;
    }

    if (existing && existing.stage === 'approved' && existing.paymentStatus !== 'paid') {
      setFlow({ book, step: 'fee', requestId: existing.id });
      return;
    }

    // No active request yet (or the previous one was already paid) —
    // start a fresh one with a reason.
    setReasonText('');
    setFlow({ book, step: 'reason' });
  };

  const closeFlow = () => {
    setFlow(null);
    setReasonText('');
    setFlowError('');
    setFlowBusy(false);
  };

  // Medium/strict path: create the request, then wait for approval.
  const submitReasonAndCreateRequest = async () => {
    if (!reasonText.trim()) {
      setFlowError('Please enter a reason for this request.');
      return;
    }
    setFlowBusy(true);
    setFlowError('');
    const book = flow.book;

    try {
      const res = await fetch(`${API}/api/downloads/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: book.id, userId: user.id, reason: reasonText.trim() }),
      });
      const request = await res.json(); // raw snake_case row
      if (!res.ok) {
        setFlowError(request.message || 'Could not submit the request.');
        setFlowBusy(false);
        return;
      }
      setFlowBusy(false);
      closeFlow();
      fetchMyRequests();
    } catch (err) {
      console.error(err);
      setFlowError('System error submitting the request. Please try again.');
      setFlowBusy(false);
    }
  };

  // Normal-class path: no approval needed, but a request row still has to
  // exist before payment (the server checks stage === 'approved' at
  // checkout time). Create it here if we don't already have one, then move
  // to the payment step.
  const proceedToPayment = async () => {
    if (flow.requestId) {
      setFlow(prev => ({ ...prev, step: 'payment' }));
      return;
    }
    setFlowBusy(true);
    setFlowError('');
    const book = flow.book;
    try {
      const res = await fetch(`${API}/api/downloads/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: book.id, userId: user.id, reason: '' }),
      });
      const request = await res.json(); // raw snake_case row
      if (!res.ok) {
        setFlowError(request.message || 'Could not start the download request.');
        setFlowBusy(false);
        return;
      }
      setFlowBusy(false);
      setFlow(prev => ({ ...prev, step: 'payment', requestId: request.id }));
    } catch (err) {
      console.error(err);
      setFlowError('System error starting the request. Please try again.');
      setFlowBusy(false);
    }
  };

  const handlePay = async (gateway) => {
    setFlowBusy(true);
    setFlowError('');
    const { requestId } = flow;

    try {
      const res = await fetch(`${API}/api/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, userId: user.id, gateway }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFlowError(data.message || 'Payment could not be completed.');
        setFlowBusy(false);
        return;
      }
      if (data.downloadUrl) {
        window.open(`${API}${data.downloadUrl}`, '_blank', 'noopener');
      }
      setFlowBusy(false);
      closeFlow();
      fetchMyRequests();
    } catch (err) {
      console.error(err);
      setFlowError('System error processing payment. Please try again.');
      setFlowBusy(false);
    }
  };

  // --- LOGOUT / CRUD helpers (unchanged from Dashboard.js) ---
  const handleLogout = async () => {
    try {
      await fetch(`${API}/api/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id })
      });
    } catch (err) {
      console.error("Logout request failed:", err);
    }
    setUser(null);
    localStorage.removeItem('user');
  };

  const handleOpenAdd = () => {
    setFormData({ title: '', author: '', subject: '', call_number: '', department: '', location: '', published_year: '' });
    setSelectedFile(null);
    setIsEditing(false);
    setShowModal(true);
  };

  const handleOpenEdit = (book) => {
    setFormData({
      title: book.title || '',
      author: book.author || '',
      subject: book.subject || '',
      call_number: book.call_number || '',
      department: book.department || '',
      location: book.location || '',
      published_year: book.published_year || ''
    });
    setCurrentId(book.id);
    setSelectedFile(null);
    setIsEditing(true);
    setShowModal(true);
  };

  const submitCrudRequest = async (actionType, targetLabel, contextPayload = {}, uploadedFile = null) => {
    if (!canDo(actionType)) {
      alert(`Access Denied: Your role does not have permission to request a record ${actionType}.`);
      return false;
    }
    const userReason = window.prompt(`Enter your business reason to initiate this ${actionType} request:`);
    if (!userReason) return false;

    const body = new FormData();
    body.append('makerId', user.id);
    body.append('makerRole', user.role);
    body.append('requestType', 'permission');
    body.append('requestedPermission', actionType);
    body.append('targetLabel', targetLabel);
    body.append('reason', userReason);
    if (contextPayload.targetId) body.append('targetBookId', contextPayload.targetId);
    else if (contextPayload.bookId) body.append('targetBookId', contextPayload.bookId);
    body.append('metaContext', JSON.stringify(contextPayload));
    if (uploadedFile) body.append('pdfFile', uploadedFile);

    try {
      const res = await fetch(`${API}/api/office-requests`, { method: 'POST', body });
      if (res.ok) {
        alert("Workflow request initiated successfully! It has been routed to the approval chain.");
        return true;
      }
      const errData = await res.json();
      alert(`Pipeline error: ${errData.message}`);
      return false;
    } catch (err) {
      console.error("Failed to generate workflow instance:", err);
      alert("System error tracking the submission workflow instance.");
      return false;
    }
  };

  const handleDelete = async (id) => {
    const targetBook = books.find(b => b.id === id);
    const targetTitle = targetBook ? targetBook.title : `Record ID #${id}`;
    await submitCrudRequest('delete', `Delete Record: ${targetTitle}`, { bookId: id });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const itemContext = { ...formData, isEditing, targetId: isEditing ? currentId : null };
    const targetLabel = isEditing ? `Update Record: ${formData.title}` : `Create New Record: ${formData.title}`;
    const actionType = isEditing ? 'edit' : 'add';
    const success = await submitCrudRequest(actionType, targetLabel, itemContext, selectedFile);
    if (success) { setShowModal(false); setSelectedFile(null); }
  };

  const openViewPreview = (book) => {
    if (book.file_path) { setSelectedBook(book); setViewModal(true); }
    else { alert("No PDF associated with this record."); }
  };

  // --- RENDER HELPERS ---

  const renderClassBadge = (cls) =>
    h('span', { className: CLASS_BADGE_CLASS[cls] || CLASS_BADGE_CLASS.normal }, CLASS_LABELS[cls] || 'Normal');

  const renderDownloadButtonLabel = (book) => {
    const cls = getSecurityClass(book);
    if (cls === 'normal') return 'Download';
    const existing = getRequestForBook(book.id);
    if (existing) {
      const chain = existing.requiredStages || CLASS_CHAIN[cls] || [];
      if (existing.stage === 'approved' && existing.paymentStatus !== 'paid') return 'Pay & Download';
      if (existing.stage === 'rejected') return 'View rejection';
      if (chain.includes(existing.stage)) {
        return `Pending: ${STAGE_LABELS[existing.stage] || existing.stage}`;
      }
    }
    return 'Request Download';
  };

  const renderBookCard = (book) => {
    const totalPages = book.page_count || (book.department === 'Novel' ? 20 : 12);
    const cls = getSecurityClass(book);
    return h('div', { key: book.id, className: 'book-card-gold' },
      h('div', { className: 'book-left-content' },
        h('div', { className: 'book-icon-box-gold' }, '📂'),
        h('div', { className: 'book-info' },
          h('div', { className: 'ud-title-row' },
            h('h3', null, book.title),
            renderClassBadge(cls)
          ),
          h('div', { className: 'info-grid' },
            h('span', null, h('strong', null, 'Author: '), book.author),
            book.subject && h('span', null, h('strong', null, 'Subject: '), book.subject),
            book.call_number && h('span', null, h('strong', null, 'Call No.: '), book.call_number),
            h('span', null, h('strong', null, 'Dept: '), book.department),
            h('span', null, h('strong', null, 'Loc: '), book.location),
            h('span', null, h('strong', null, 'Year: '), book.published_year),
            h('span', null, h('strong', null, 'Pages: '), `${totalPages} pages`)
          )
        )
      ),
      h('div', { className: 'book-actions' },
        h('div', { className: 'action-button-row' },
          h('button', { className: 'btn-view', onClick: () => openViewPreview({ ...book, page_count: totalPages }) }, 'View'),
          baseCanDownload && h('button', {
            className: 'btn-download',
            onClick: () => handleDownloadClick({ ...book, page_count: totalPages })
          }, renderDownloadButtonLabel(book))
        ),
        (canEdit || canDelete) && h('div', { className: 'admin-btns' },
          canEdit && h('button', { className: 'edit-link', onClick: () => handleOpenEdit(book) }, 'Edit'),
          canDelete && h('button', { className: 'delete-link', onClick: () => handleDelete(book.id) }, 'Delete')
        )
      )
    );
  };

  // --- Download workflow modal (reason / pending / rejected / fee / payment) ---

  const renderReasonStep = () => {
    const cls = getSecurityClass(flow.book);
    const chain = CLASS_CHAIN[cls] || [];
    return h('div', { className: 'modal-content ud-flow-modal' },
      h('h3', null, `Request Download: ${flow.book.title}`),
      h('p', { className: 'ud-flow-subtitle' },
        `This document is ${CLASS_LABELS[cls]}. Your request will be routed through: `,
        chain.map(s => STAGE_LABELS[s]).join(' → '),
        '.'
      ),
      h('textarea', {
        className: 'ud-reason-textarea',
        rows: 4,
        placeholder: 'Explain why you need this document...',
        value: reasonText,
        onChange: e => setReasonText(e.target.value)
      }),
      flowError && h('div', { className: 'ud-flow-error' }, flowError),
      h('div', { className: 'modal-footer' },
        h('button', { type: 'button', onClick: closeFlow, disabled: flowBusy }, 'Cancel'),
        h('button', {
          type: 'button',
          className: 'save-btn',
          onClick: submitReasonAndCreateRequest,
          disabled: flowBusy
        }, flowBusy ? 'Submitting...' : 'Submit Request')
      )
    );
  };

  const renderPendingStep = () => {
    const { request, book } = flow;
    const cls = getSecurityClass(book);
    const chain = request.requiredStages || CLASS_CHAIN[cls] || [];
    return h('div', { className: 'modal-content ud-flow-modal' },
      h('h3', null, `Pending Approval: ${book.title}`),
      h('div', { className: 'ud-stage-pipeline' },
        chain.map((stage, i) => {
          const idx = chain.indexOf(request.stage);
          let state = 'pending';
          if (i < idx) state = 'done';
          else if (i === idx) state = 'current';
          return h('div', { key: stage, className: 'ud-pipe-step' },
            h('span', { className: `ud-pipe-dot ud-pipe-dot--${state}` }),
            h('span', { className: 'ud-pipe-label' }, STAGE_LABELS[stage])
          );
        })
      ),
      h('p', { className: 'ud-flow-subtitle' }, `Currently awaiting review by: ${STAGE_LABELS[request.stage] || request.stage}.`),
      h('div', { className: 'modal-footer' },
        h('button', { type: 'button', onClick: closeFlow }, 'Close')
      )
    );
  };

  const renderRejectedStep = () => {
    const { request, book } = flow;
    const reason = request.officerRejectReason || request.seniorOfficerRejectReason || request.deptHeadRejectReason || 'No reason recorded.';
    return h('div', { className: 'modal-content ud-flow-modal' },
      h('h3', null, `Request Rejected: ${book.title}`),
      h('div', { className: 'ud-rejection-box' },
        h('strong', null, 'Reason: '), reason
      ),
      h('div', { className: 'modal-footer' },
        h('button', { type: 'button', onClick: closeFlow }, 'Close'),
        h('button', {
          type: 'button',
          className: 'save-btn',
          onClick: () => { setReasonText(''); setFlow({ book, step: 'reason' }); }
        }, 'Submit New Request')
      )
    );
  };

  const renderFeeStep = () => {
    const { book } = flow;
    const cls = getSecurityClass(book);
    const pages = chargeablePages(book);
    const rate = fees[cls] || 0;
    const total = pages * rate;
    return h('div', { className: 'modal-content ud-flow-modal' },
      h('h3', null, `Download Fee: ${book.title}`),
      h('div', { className: 'billing-receipt-card' },
        h('div', { className: 'receipt-line' }, h('span', null, 'Document class'), renderClassBadge(cls)),
        h('div', { className: 'receipt-line' }, h('span', null, 'Pages'), h('span', null, pages)),
        h('div', { className: 'receipt-line' }, h('span', null, 'Rate per page'), h('span', null, formatBirr(rate))),
        h('hr', { className: 'receipt-divider' }),
        h('div', { className: 'receipt-line total-amount-line' }, h('span', null, 'Total'), h('span', null, formatBirr(total)))
      ),
      flowError && h('div', { className: 'ud-flow-error' }, flowError),
      h('div', { className: 'modal-footer' },
        h('button', { type: 'button', onClick: closeFlow, disabled: flowBusy }, 'Cancel'),
        h('button', { type: 'button', className: 'save-btn', onClick: proceedToPayment, disabled: flowBusy },
          flowBusy ? 'Starting...' : 'Proceed to Payment')
      )
    );
  };

  const renderPaymentStep = () => h('div', { className: 'modal-content ud-flow-modal modal-content--billing' },
    h('h3', null, 'Choose Payment Method'),
    flowError && h('div', { className: 'ud-flow-error' }, flowError),
    h('div', { className: 'payment-gateways-container' },
      h('h4', null, 'Available gateways'),
      h('div', { className: 'gateway-buttons-grid' },
        h('button', { className: 'pay-btn-telebirr', disabled: flowBusy, onClick: () => handlePay('telebirr') },
          flowBusy ? 'Processing...' : 'Telebirr'),
        h('button', { className: 'pay-btn-cbe', disabled: flowBusy, onClick: () => handlePay('cbe') },
          flowBusy ? 'Processing...' : 'CBE Birr')
      )
    ),
    h('div', { className: 'modal-footer' },
      h('button', { type: 'button', onClick: closeFlow, disabled: flowBusy }, 'Cancel')
    )
  );

  const renderFlowModal = () => {
    if (!flow) return null;
    let body;
    if (flow.step === 'reason') body = renderReasonStep();
    else if (flow.step === 'pending') body = renderPendingStep();
    else if (flow.step === 'rejected') body = renderRejectedStep();
    else if (flow.step === 'fee') body = renderFeeStep();
    else if (flow.step === 'payment') body = renderPaymentStep();
    else return null;
    return h('div', { className: 'modal-overlay' }, body);
  };

  // --- My Requests tab ---

  const renderMyRequestsPanel = () => {
    const pending = myRequests.filter(r => r.stage !== 'approved' && r.stage !== 'rejected');
    const resolved = myRequests.filter(r => r.stage === 'approved' || r.stage === 'rejected');

    const renderRow = (r) => {
      const cls = r.securityClass || 'normal';
      const chain = r.requiredStages || CLASS_CHAIN[cls] || [];
      const isPaid = r.paymentStatus === 'paid';
      return h('div', { key: r.id, className: 'ud-request-row' },
        h('div', { className: 'ud-request-row-top' },
          h('span', { className: 'ud-request-code' }, r.requestCode),
          renderClassBadge(cls),
          h('span', { className: `ud-status-pill ud-status-pill--${r.stage}` },
            r.stage === 'approved' ? (isPaid ? 'Approved · Paid' : 'Approved · Awaiting payment')
              : r.stage === 'rejected' ? 'Rejected'
              : `Awaiting ${STAGE_LABELS[r.stage] || r.stage}`)
        ),
        h('div', { className: 'ud-request-target' }, r.targetLabel),
        r.totalFee != null && h('div', { className: 'ud-request-fee' }, `${formatBirr(r.totalFee)} (${r.pageCount} pages @ ${formatBirr(r.feePerPage)}/page)`),
        chain.length > 0 && r.stage !== 'rejected' && h('div', { className: 'ud-stage-pipeline ud-stage-pipeline--sm' },
          chain.map((stage, i) => {
            const idx = chain.indexOf(r.stage);
            const done = r.stage === 'approved' ? true : i < idx;
            const current = r.stage !== 'approved' && i === idx;
            const state = done ? 'done' : current ? 'current' : 'pending';
            return h('span', { key: stage, className: `ud-pipe-dot ud-pipe-dot--${state}`, title: STAGE_LABELS[stage] });
          })
        ),
        r.stage === 'rejected' && h('div', { className: 'ud-rejection-box ud-rejection-box--sm' },
          h('strong', null, 'Reason: '),
          r.officerRejectReason || r.seniorOfficerRejectReason || r.deptHeadRejectReason || 'No reason recorded.'
        ),
        r.stage === 'approved' && !isPaid && h('button', {
          className: 'btn-download ud-inline-pay-btn',
          onClick: () => {
            const book = books.find(b => b.id === r.targetBookId) || { id: r.targetBookId, title: r.targetLabel, page_count: r.pageCount || 1, security_class: cls };
            setFlow({ book, step: 'fee', requestId: r.id });
          }
        }, 'Pay & Download')
      );
    };

    return h('div', { className: 'ud-requests-panel' },
      h('div', { className: 'ud-requests-section' },
        h('h4', null, `Pending (${pending.length})`),
        pending.length === 0 ? h('p', { className: 'ud-empty-note' }, 'No pending requests.') : pending.map(renderRow)
      ),
      h('div', { className: 'ud-requests-section' },
        h('h4', null, `Resolved (${resolved.length})`),
        resolved.length === 0 ? h('p', { className: 'ud-empty-note' }, 'No resolved requests yet.') : resolved.map(renderRow)
      )
    );
  };

  // --- MAIN RENDER ---

  return h('div', { className: 'dashboard-container-gold' },
    h('div', { className: 'dashboard-main-gold' },
      h('div', { className: 'main-header' },
        h('h2', { className: 'section-title' }, 'Ethiopia Geological Institute Library Records'),
        h('div', { className: 'header-action-button-group', style: { display: 'flex', gap: '12px', alignItems: 'center' } },
          h('button', {
            type: 'button',
            className: `ud-tab-btn ${activeTab === 'library' ? 'ud-tab-btn--active' : ''}`,
            onClick: () => setActiveTab('library')
          }, 'Library'),
          h('button', {
            type: 'button',
            className: `ud-tab-btn ${activeTab === 'requests' ? 'ud-tab-btn--active' : ''}`,
            onClick: () => { setActiveTab('requests'); markAllSeen(); }
          },
            'My Requests',
            unseenResolvedCount > 0 && h('span', { className: 'ud-notif-dot' }, unseenResolvedCount)
          ),
          isPrivilegedAdmin && h('button', {
            type: 'button',
            className: 'btn-add-elegant',
            style: { backgroundColor: '#1a5e4b', borderColor: '#0d3d31', color: '#fff' },
            onClick: () => setUser({ ...user })
          }, '🛡️ Open Management Console'),
          canAdd && h('button', { className: 'btn-add-elegant', onClick: handleOpenAdd }, '+ New Record')
        )
      ),

      activeTab === 'requests'
        ? renderMyRequestsPanel()
        : (loading
          ? h('div', { className: 'loader-text' }, 'Querying Live Vault...')
          : h('div', { className: 'results-list' },
            books.map(renderBookCard),
            books.length === 0 && h('div', { className: 'no-records-msg' }, 'No structural assets match your criteria.')
          ))
    ),

    // SIDEBAR FILTERS
    h('div', { className: 'dashboard-sidebar-gold' },
      h('div', { className: 'profile-section-gold' },
        h('div', { className: 'avatar-gold' }, '👤'),
        h('h3', null, user?.username),
        h('span', { className: 'role-tag' }, user?.role)
      ),
      h('div', { className: 'sidebar-group' },
        h('h4', null, 'Live Server Filter'),
        h('div', { className: 'filter-input-gold' },
          h('label', null, 'Title'),
          h('input', { placeholder: 'Search title...', value: filters.title, onChange: e => setFilters({ ...filters, title: e.target.value }) })
        ),
        h('div', { className: 'filter-input-gold' },
          h('label', null, 'Author'),
          h('input', { placeholder: 'Search author...', value: filters.author, onChange: e => setFilters({ ...filters, author: e.target.value }) })
        ),
        h('div', { className: 'filter-input-gold' },
          h('label', null, 'Subject'),
          h('input', { placeholder: 'Search subject...', value: filters.subject, onChange: e => setFilters({ ...filters, subject: e.target.value }) })
        ),
        h('div', { className: 'filter-input-gold' },
          h('label', null, 'Call Number'),
          h('input', { placeholder: 'Search call number...', value: filters.callNumber, onChange: e => setFilters({ ...filters, callNumber: e.target.value }) })
        ),
        h(FilterDropdown, { label: 'Department', options: departmentOptions, value: filters.department, className: 'select-gold', onChange: e => setFilters({ ...filters, department: e.target.value }) }),
        h(FilterDropdown, { label: 'Location', options: locationOptions, value: filters.location, className: 'select-gold', onChange: e => setFilters({ ...filters, location: e.target.value }) }),
        h(FilterDropdown, { label: 'Year', options: yearOptions, value: filters.year, className: 'select-gold', onChange: e => setFilters({ ...filters, year: e.target.value }) }),
        h('button', { className: 'btn-reset', onClick: () => setFilters({ title: '', author: '', subject: '', callNumber: '', department: '', location: '', year: '' }) }, 'Reset Filters')
      ),
      h('button', { className: 'logout-btn-red', onClick: handleLogout }, 'Logout System')
    ),

    // PREVIEW MODAL (unchanged from Dashboard.js)
    viewModal && selectedBook && h('div', { className: 'modal-overlay' },
      h('div', { className: 'modal-content modal-content--viewer', style: { maxWidth: '1100px', width: '95%', display: 'flex', flexDirection: 'column' } },
        h('div', { className: 'viewer-header' },
          h('h3', { style: { margin: 0, color: '#1e293b' } }, `Document Full View: ${selectedBook.title}`),
          h('button', { className: 'close-viewer-btn', onClick: () => setViewModal(false) }, '✕ Close Preview')
        ),
        h('div', { className: 'document-scroll-container', style: { position: 'relative', height: '80vh', backgroundColor: '#525659', marginTop: '10px', borderRadius: '4px', overflow: 'hidden' } },
          h('object', {
            data: `${API}/uploades/${selectedBook.file_path}#toolbar=1&navpanes=1`,
            type: 'application/pdf',
            width: '100%',
            height: '100%',
            style: { border: 'none' }
          },
            h('iframe', {
              src: `${API}/uploades/${selectedBook.file_path}#toolbar=1&navpanes=1`,
              title: 'PDF Fallback Full View',
              width: '100%',
              height: '100%',
              style: { border: 'none' }
            })
          )
        )
      )
    ),

    // ADD/EDIT FORM MODAL (unchanged from Dashboard.js)
    showModal && h('div', { className: 'modal-overlay' },
      h('div', { className: 'modal-content' },
        h('h3', null, isEditing ? 'Request Update Authorization' : 'Request Creation Authorization'),
        h('form', { onSubmit: handleSubmit },
          h('div', { className: 'modal-form-body' },
            h('input', { placeholder: 'Title', value: formData.title, onChange: e => setFormData({ ...formData, title: e.target.value }), required: true }),
            h('input', { placeholder: 'Author', value: formData.author, onChange: e => setFormData({ ...formData, author: e.target.value }) }),
            h('input', { placeholder: 'Subject', value: formData.subject, onChange: e => setFormData({ ...formData, subject: e.target.value }) }),
            h('input', { placeholder: 'Call Number', value: formData.call_number, onChange: e => setFormData({ ...formData, call_number: e.target.value }) }),
            h('div', { className: 'form-row-dual' },
              h('input', { placeholder: 'Dept', value: formData.department, onChange: e => setFormData({ ...formData, department: e.target.value }) }),
              h('input', { placeholder: 'Year', value: formData.published_year, onChange: e => setFormData({ ...formData, published_year: e.target.value }) })
            ),
            h('input', { placeholder: 'Location', value: formData.location, onChange: e => setFormData({ ...formData, location: e.target.value }) }),
            h('div', { className: 'filter-input-gold', style: { marginTop: '15px', marginBottom: '10px' } },
              h('label', { style: { fontSize: '12px', color: '#b2945b', display: 'block', marginBottom: '4px' } },
                isEditing ? 'Replace PDF Document Asset (Optional Context)' : 'Upload Document PDF'),
              h('input', {
                type: 'file',
                accept: 'application/pdf',
                onChange: e => setSelectedFile(e.target.files[0]),
                required: !isEditing
              })
            )
          ),
          h('div', { className: 'modal-footer' },
            h('button', { type: 'button', onClick: () => setShowModal(false) }, 'Cancel'),
            h('button', { type: 'submit', className: 'save-btn' }, 'Submit Request')
          )
        )
      )
    ),

    renderFlowModal()
  );
};

export default UserDashboard;