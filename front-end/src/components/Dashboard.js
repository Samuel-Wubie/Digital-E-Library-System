import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './Dashboard.css';
import './LibraryNav.css';
import { usePermissions } from './UsePermissions';
import { askReason, askConfirm, showAlert, askPayment, showPaymentReceipt } from './dialogs';

import { API } from '../config';
const CURRENT_YEAR = new Date().getFullYear();
const EARLIEST_YEAR = 1950; // adjust if older records exist in the archive

// ============================================================================
// LIBRARY CATEGORY STRUCTURE
//
// The categories and the lists inside them used to be hardcoded here. They now
// live in the `taxonomy` table and are managed from Admin -> Library structure,
// so adding a category or renaming a topic no longer needs a code change.
//
// A category's `nav` says how it is browsed:
//   report_topic -> numbered topic grid, then the document list
//   map          -> format, then type, then scale, then the document list
//   pub_type     -> one list of publication types, then the documents
//   item         -> one flat list of whatever the admin added
//   none         -> straight to the document list (Books works this way)
// ============================================================================

// Institutional standard: report codes are 3-digit, zero-padded ('001', not
// '1'). The admin types whatever they like; this normalises it for display and
// for the value stored on each document.
function padCode(n) {
  const digits = String(n ?? '').trim();
  return /^\d+$/.test(digits) ? digits.padStart(3, '0') : digits;
}

// The stored report_topic on a document is the code and label joined, e.g.
// "001 Abrasives (Pumice)". Kept as-is so existing records still match; the
// server rewrites documents when an admin renames a topic.
function topicValue(topic) {
  return `${padCode(topic.code)} ${topic.label}`.trim();
}

// Document sensitivity. The stored values are unchanged from the original
// 'normal' / 'medium' / 'strict' — renaming them in the database would have
// meant rewriting every document and every approval rule — so this is purely
// how the three levels read to a person.
const SECURITY_LEVELS = [
  { key: 'normal', label: 'Public',             hint: 'Anyone signed in can request this document.' },
  { key: 'medium', label: 'Confidential',       hint: 'Restricted — requests are reviewed before release.' },
  { key: 'strict', label: 'Highly Confidential', hint: 'Most restricted — handle with care.' },
];

const YEAR_OPTIONS = [];
for (let y = CURRENT_YEAR; y >= EARLIEST_YEAR; y--) YEAR_OPTIONS.push(y);

// ============================================================================
// SHARED HELPERS
// ============================================================================

function buildQueryParams(paramsObj) {
  const qp = new URLSearchParams();
  Object.entries(paramsObj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qp.append(k, v);
  });
  return qp;
}

// Who will review this request, and which step it lands on.
//
// Asked of the server, never worked out here. A step can name specific people
// rather than a role, and roles are renameable: this client used to map
// "my role" to a reviewer role with the three original job titles written in,
// so renaming a role emptied the picker and the request went nowhere.
async function fetchNextReviewers({ userId, action, bookId }) {
  const empty = { stage: null, stageLabel: null, reviewers: [] };
  try {
    const qs = new URLSearchParams({ userId: String(userId), action: action || 'download' });
    if (bookId) qs.append('bookId', String(bookId));
    const res = await fetch(`${API}/api/office-requests/next-reviewers?${qs.toString()}`);
    const data = await res.json();
    if (!res.ok || !data) return empty;
    return {
      stage: data.stage || null,
      stageLabel: data.stageLabel || null,
      reviewers: Array.isArray(data.reviewers) ? data.reviewers : [],
    };
  } catch (err) {
    return empty;
  }
}

// ============================================================================
// REUSABLE: 5-way filter row (author / title / department / location / year range)
// ============================================================================
function LibFilterRow({ filters, setFilters, departmentOptions, locationOptions }) {
  return (
    <div className="lib-filters-row">
      <div className="lib-filter-field">
        <label>Title</label>
        <input
          placeholder="Search title..."
          value={filters.title}
          onChange={e => setFilters({ ...filters, title: e.target.value })}
        />
      </div>
      <div className="lib-filter-field">
        <label>Author</label>
        <input
          placeholder="Search author..."
          value={filters.author}
          onChange={e => setFilters({ ...filters, author: e.target.value })}
        />
      </div>
      <div className="lib-filter-field">
        <label>Subject</label>
        <input
          placeholder="Search subject..."
          value={filters.subject}
          onChange={e => setFilters({ ...filters, subject: e.target.value })}
        />
      </div>
      <div className="lib-filter-field">
        <label>Call Number</label>
        <input
          placeholder="Search call number..."
          value={filters.callNumber}
          onChange={e => setFilters({ ...filters, callNumber: e.target.value })}
        />
      </div>
      <div className="lib-filter-field">
        <label>Department</label>
        <select value={filters.department} onChange={e => setFilters({ ...filters, department: e.target.value })}>
          <option value="">All</option>
          {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="lib-filter-field">
        <label>Location</label>
        <select value={filters.location} onChange={e => setFilters({ ...filters, location: e.target.value })}>
          <option value="">All</option>
          {locationOptions.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div className="lib-filter-field">
        <label>Published year</label>
        <div className="lib-year-range">
          <select value={filters.yearFrom} onChange={e => setFilters({ ...filters, yearFrom: e.target.value })}>
            <option value="">From</option>
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span>&rarr;</span>
          <select value={filters.yearTo} onChange={e => setFilters({ ...filters, yearTo: e.target.value })}>
            <option value="">To</option>
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <button
        type="button"
        className="lib-filter-reset"
        onClick={() => setFilters({ title: '', author: '', subject: '', callNumber: '', department: '', location: '', yearFrom: '', yearTo: '' })}
      >
        Reset
      </button>
    </div>
  );
}

// ============================================================================
// DOCUMENT LIST PANEL
// Used for both Technical Report topic lists and Map type/scale lists.
// context = { category, reportTopic, mapType, mapFormat, scale }
// ============================================================================
function DocumentListPanel({ title, context, user, canEdit, canDelete, canAdd, canDo, onBack }) {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ title: '', author: '', subject: '', callNumber: '', department: '', location: '', yearFrom: '', yearTo: '' });

  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const [formData, setFormData] = useState({ title: '', author: '', subject: '', call_number: '', department: '', location: '', published_year: '', page_count: '', security_class: 'normal' });
  const [selectedFile, setSelectedFile] = useState(null);

  const [viewModal, setViewModal] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const fetchBooks = useCallback(() => {
    setLoading(true);
    const qp = buildQueryParams({
      title: filters.title,
      author: filters.author,
      subject: filters.subject,
      callNumber: filters.callNumber,
      department: filters.department,
      location: filters.location,
      yearFrom: filters.yearFrom,
      yearTo: filters.yearTo,
      category: context.category,
      reportTopic: context.reportTopic,
      mapType: context.mapType,
      mapFormat: context.mapFormat,
      scale: context.scale,
      pubType: context.pubType,
      classification: context.classification,
    });
    fetch(`${API}/api/books/search?${qp.toString()}`)
      .then(res => res.json())
      .then(data => { setBooks(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(err => { console.error('Database fetch query failure:', err); setLoading(false); });
  }, [filters, context]);

  useEffect(() => {
    const delay = setTimeout(fetchBooks, 350);
    return () => clearTimeout(delay);
  }, [fetchBooks]);

  const departmentOptions = useMemo(() => Array.from(new Set(books.map(b => b.department).filter(Boolean))).sort(), [books]);
  const locationOptions = useMemo(() => Array.from(new Set(books.map(b => b.location).filter(Boolean))).sort(), [books]);

  const handleRequestSubmission = async (actionType, targetLabel, contextPayload = {}, uploadedFile = null) => {
    if (!canDo(actionType)) {
      showAlert(`Access Denied: Your role does not have permission to request a record ${actionType}.`);
      return false;
    }
    const next = await fetchNextReviewers({ userId: user.id, action: actionType });
    const reasonResult = await askReason({
      title: 'Authorization Request',
      message: `ENTER YOUR BUSINESS REASON TO INITIATE THIS ${String(actionType).toUpperCase()} REQUEST.`,
      reviewers: next.reviewers,
      reviewerLabel: next.stageLabel ? `Send to (${next.stageLabel})` : 'Send to',
    });
    if (!reasonResult) return false;
    const userReason = typeof reasonResult === 'string' ? reasonResult : reasonResult.reason;
    const assignedReviewerId = typeof reasonResult === 'string' ? null : reasonResult.reviewerId;

    const multiPartForm = new FormData();
    multiPartForm.append('makerId', user.id);
    multiPartForm.append('makerRole', user.role);
    multiPartForm.append('requestType', actionType === 'add' || actionType === 'edit' || actionType === 'delete' ? 'permission' : actionType);
    multiPartForm.append('requestedPermission', actionType);
    multiPartForm.append('targetLabel', targetLabel);
    multiPartForm.append('reason', userReason);
    if (assignedReviewerId) multiPartForm.append('assignedReviewerId', assignedReviewerId);

    if (contextPayload.targetId) multiPartForm.append('targetBookId', contextPayload.targetId);
    else if (contextPayload.bookId) multiPartForm.append('targetBookId', contextPayload.bookId);

    // Stamp the current library-category context onto every add/edit so the
    // record lands back in the exact same topic/map-type/scale bucket it was
    // created from.
    const mergedContext = {
      ...contextPayload,
      category: context.category,
      reportTopic: context.reportTopic,
      mapType: context.mapType,
      mapFormat: context.mapFormat,
      scale: context.scale,
      pubType: context.pubType,
      classification: context.classification,
    };
    multiPartForm.append('metaContext', JSON.stringify(mergedContext));

    if (uploadedFile) multiPartForm.append('pdfFile', uploadedFile);

    try {
      const res = await fetch(`${API}/api/office-requests`, { method: 'POST', body: multiPartForm });
      if (res.ok) {
        showAlert('Workflow request initiated successfully! It has been routed to the approval chain.');
        return true;
      }
      const errData = await res.json();
      showAlert(`Pipeline error: ${errData.message}`);
      return false;
    } catch (err) {
      console.error('Failed to generate workflow instance:', err);
      showAlert('System error tracking the submission workflow instance.');
      return false;
    }
  };

  // Shared payment step: ask how they want to pay, take it (demo), then open
  // the file. Used by both the self-service path and the approved-request
  // path, so the two can never drift apart.
  const payAndDownload = async (request, quote) => {
    let methods = [{ key: 'telebirr', label: 'telebirr' }, { key: 'cbe', label: 'CBE Birr' }];
    try {
      const mRes = await fetch(`${API}/api/payments/methods`);
      if (mRes.ok) {
        const body = await mRes.json();
        if (Array.isArray(body.methods) && body.methods.length) methods = body.methods;
      }
    } catch { /* the defaults above are fine if the lookup fails */ }

    const choice = await askPayment({
      title: 'Payment',
      book: quote.title,
      pageCount: quote.pageCount,
      feePerPage: quote.feePerPage,
      totalFee: quote.totalFee,
      methods,
    });
    if (!choice) return false;

    const payRes = await fetch(`${API}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: request.id,
        userId: user.id,
        gateway: choice.gateway,
        reference: choice.reference || null,
        payerAccount: choice.payerAccount || null,
      }),
    });
    // Read as text first: an error body is not always JSON, and the 500 here
    // carries the real database reason in `error` while `message` is only the
    // word "Payment failed" — which told nobody anything.
    const raw = await payRes.text();
    let payment = {};
    try { payment = raw ? JSON.parse(raw) : {}; } catch { payment = {}; }
    if (!payRes.ok) {
      showAlert(payment.error
        ? `${payment.message || 'Payment failed'} — ${payment.error}`
        : (payment.message || (raw && raw.trim()) || `Payment failed (HTTP ${payRes.status}).`));
      return false;
    }
    // The receipt comes only now, with the payment actually recorded.
    const methodLabel = (methods.find(m => m.key === choice.gateway) || {}).label || choice.gateway;
    await showPaymentReceipt({
      book: quote.title,
      pageCount: quote.pageCount,
      feePerPage: quote.feePerPage,
      totalFee: quote.totalFee,
      methodLabel,
      account: choice.payerAccount,
    });
    window.open(`${API}${payment.downloadUrl}`, '_blank');
    return true;
  };

  const executeDownload = async (book) => {
    if (!book.file_path) { showAlert('No file available for download.'); return; }
    if (!canDo('download')) { showAlert('Access Denied: Your role does not have permission to download.'); return; }

    // Roles are administrator-defined, so this branches on the role's
    // BEHAVIOUR rather than its name:
    //   staff_direct / administrator — the file, immediately, no fee
    //   staff_maker                  — asks the next step, pays nothing
    //   member                       — monthly allowance, then pays
    // The server enforces all three independently; this only decides which
    // path the screen offers.
    const behaviour = user?.behaviour
      || (user?.role === 'User' ? 'member' : user?.role === 'Officer' ? 'staff_maker' : 'staff_direct');
    const isStaffMaker = behaviour === 'staff_maker';
    const isMember = behaviour === 'member';

    if (!isMember && !isStaffMaker) {
      window.open(`${API}/api/downloads/direct/${book.id}?userId=${user.id}`, '_blank', 'noopener');
      return;
    }

    try {
      // Don't create a duplicate request for a book this maker already asked
      // about. If it has been accepted, carry straight on to the next step.
      const mineRes = await fetch(`${API}/api/office-requests?makerId=${user.id}&requestType=download`);
      const mine = await mineRes.json();
      if (mineRes.ok && Array.isArray(mine)) {
        const existing = mine.find(r => r.targetBookId === book.id && r.stage !== 'rejected' && !(r.stage === 'approved' && r.paymentStatus === 'paid' && !isStaffMaker));
        if (existing && existing.stage === 'approved' && isStaffMaker) {
          window.open(`${API}/api/downloads/${existing.id}/file?userId=${user.id}`, '_blank', 'noopener');
          return;
        }
        if (existing && existing.stage === 'approved') {
          await payAndDownload(existing, {
            title: book.title,
            pageCount: existing.pageCount,
            feePerPage: existing.feePerPage,
            totalFee: existing.totalFee,
          });
          return;
        }
        if (existing) {
          showAlert(`Your request ${existing.requestCode} is still waiting for the officer to authorise it. Once it is accepted, click Download again to pay and download.`);
          return;
        }
      }

      // The quote is user-aware: it says whether this particular person still
      // has allowance left this month.
      const initRes = await fetch(`${API}/api/downloads/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: book.id, userId: user.id }),
      });
      const quote = await initRes.json();
      if (!initRes.ok) { showAlert(quote.message || 'Could not get a download quote.'); return; }

      // ---- Self-service: no officer, just pay ----
      if (!isStaffMaker && !quote.requiresApproval) {
        const left = quote.allowance ? quote.allowance.remaining : null;
        const reqRes = await fetch(`${API}/api/downloads/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookId: book.id, userId: user.id, reason: '' }),
        });
        const request = await reqRes.json();
        if (!reqRes.ok) { showAlert(request.message || 'Could not start this download.'); return; }

        const done = await payAndDownload(request, quote);
        if (done && left !== null) {
          const after = Math.max(left - 1, 0);
          showAlert(after > 0
            ? `Done. You have ${after} more download${after === 1 ? '' : 's'} this month before an officer needs to authorise them.`
            : `Done. That was your last self-service download this month — further downloads will need an officer's authorisation.`);
        }
        return;
      }

      // ---- Needs authorisation ----
      const next = await fetchNextReviewers({ userId: user.id, action: 'download', bookId: book.id });
      // The step's own name, as the administrator named it — not a job title
      // written into this file.
      const sentTo = next.stageLabel || 'the next reviewer';
      const reasonResult = await askReason({
        title: 'Authorisation needed',
        message: isStaffMaker
          ? `"${quote.title}" — your request will be sent to ${sentTo} for acceptance. No fee. Enter your reason for this download.`
          : `"${quote.title}" — you have used all ${quote.allowance?.limit ?? ''} of this month's self-service downloads, so ${sentTo} must authorise this one. Fee once accepted: ${quote.totalFee} ETB (${quote.pageCount} pages @ ${quote.feePerPage}/page). Enter your reason.`,
        reviewers: next.reviewers,
        reviewerLabel: next.stageLabel ? `Send to (${next.stageLabel})` : 'Send to',
      });
      if (!reasonResult) return;
      const reason = typeof reasonResult === 'string' ? reasonResult : reasonResult.reason;
      const assignedReviewerId = typeof reasonResult === 'string' ? null : reasonResult.reviewerId;

      const reqRes = await fetch(`${API}/api/downloads/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: book.id, userId: user.id, reason, assignedReviewerId }),
      });
      const request = await reqRes.json();
      if (!reqRes.ok) { showAlert(request.message || 'Could not submit the download request.'); return; }

      showAlert(isStaffMaker
        ? `Request ${request.request_code} sent to the Senior Officer. Once accepted, click Download again to download.`
        : `Request ${request.request_code} sent to the officer. Once it is authorised, click Download again to pay and download.`);
    } catch (err) {
      console.error('Download flow failed:', err);
      showAlert('System error during the download flow.');
    }
  };

  // Preview URLs are now short-lived signed links fetched from the backend
  // rather than a direct /uploades/<filename> path, so the PDF is no longer
  // readable by anyone who guesses the filename.
  const openViewPreview = async (book) => {
    if (!book.file_path) { showAlert('No PDF associated with this record.'); return; }
    try {
      const res = await fetch(`${API}/api/books/${book.id}/preview?userId=${user.id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showAlert(body.message || 'Could not open this document.');
        return;
      }
      const { url } = await res.json();
      // Local dev returns a relative /uploades path; production returns a
      // full signed URL that already carries its own host.
      setPreviewUrl(url.startsWith('http') ? url : `${API}${url}`);
      setSelectedBook(book);
      setViewModal(true);
    } catch (err) {
      console.error('Preview failed:', err);
      showAlert('Could not open this document.');
    }
  };

  const handleOpenAdd = () => {
    setFormData({ title: '', author: '', subject: '', call_number: '', department: '', location: '', published_year: '', page_count: '', security_class: 'normal' });
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
      published_year: book.published_year || '',
      page_count: book.page_count ? String(book.page_count) : '',
      security_class: book.security_class || 'normal',
    });
    setCurrentId(book.id);
    setSelectedFile(null);
    setIsEditing(true);
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    const targetBook = books.find(b => b.id === id);
    const targetTitle = targetBook ? targetBook.title : `Record ID #${id}`;
    await handleRequestSubmission('delete', `Delete Record: ${targetTitle}`, { bookId: id });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const itemContext = { ...formData, isEditing, targetId: isEditing ? currentId : null };
    const targetLabel = isEditing ? `Update Record: ${formData.title}` : `Create New Record: ${formData.title}`;
    const actionType = isEditing ? 'edit' : 'add';
    const success = await handleRequestSubmission(actionType, targetLabel, itemContext, selectedFile);
    if (success) { setShowModal(false); setSelectedFile(null); }
  };

  return (
    <div>
      <h3 className="lib-panel-title">{title}</h3>

      <LibFilterRow filters={filters} setFilters={setFilters} departmentOptions={departmentOptions} locationOptions={locationOptions} />

      {canAdd && (
        <div style={{ marginBottom: '16px' }}>
          <button className="btn-add-elegant" onClick={handleOpenAdd}>+ New Record</button>
        </div>
      )}

      {loading ? <div className="loader-text">Querying Live Vault...</div> : (
        <div className="results-list">
          {books.map(book => (
            <div key={book.id} className="book-card-gold">
              <div className="book-left-content">
                <div className="book-icon-box-gold">📂</div>
                <div className="book-info">
                  <h3>{book.title}</h3>
                  <div className="info-grid">
                    <span><strong>Author:</strong> {book.author}</span>
                    {book.subject && <span><strong>Subject:</strong> {book.subject}</span>}
                    {book.call_number && <span><strong>Call No.:</strong> {book.call_number}</span>}
                    <span><strong>Dept:</strong> {book.department}</span>
                    <span><strong>Loc:</strong> {book.location}</span>
                    <span><strong>Year:</strong> {book.published_year}</span>
                    <span><strong>Pages:</strong> {book.page_count ? `${book.page_count} pages` : 'not recorded'}</span>
                  </div>
                </div>
              </div>
              <div className="book-actions">
                <div className="action-button-row">
                  <button className="btn-view" onClick={() => openViewPreview(book)}>View</button>
                  {canDo('download') && <button className="btn-download" onClick={() => executeDownload(book)}>Download</button>}
                </div>
                {(canEdit || canDelete) && (
                  <div className="admin-btns">
                    {canEdit && <button className="edit-link" onClick={() => handleOpenEdit(book)}>Edit</button>}
                    {canDelete && <button className="delete-link" onClick={() => handleDelete(book.id)}>Delete</button>}
                  </div>
                )}
              </div>
            </div>
          ))}
          {books.length === 0 && <div className="no-records-msg">No structural assets match your criteria.</div>}
        </div>
      )}

      {viewModal && selectedBook && previewUrl && (
        <div className="modal-overlay">
          <div className="modal-content modal-content--viewer" style={{ maxWidth: '1100px', width: '95%', display: 'flex', flexDirection: 'column' }}>
            <div className="viewer-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #ddd' }}>
              <h3 style={{ margin: 0, color: '#1e293b' }}>Document Full View: {selectedBook.title}</h3>
              <button className="close-viewer-btn" onClick={() => { setViewModal(false); setPreviewUrl(null); }}>✕ Close Preview</button>
            </div>
            <div className="document-scroll-container" style={{ position: 'relative', height: '80vh', backgroundColor: '#525659', marginTop: '10px', borderRadius: '4px', overflow: 'hidden' }}>
              <object data={`${previewUrl}#toolbar=1&navpanes=1`} type="application/pdf" width="100%" height="100%" style={{ border: 'none' }}>
                <iframe src={`${previewUrl}#toolbar=1&navpanes=1`} title="PDF Fallback Full View" width="100%" height="100%" style={{ border: 'none' }} />
              </object>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>{isEditing ? 'Request Update Authorization' : 'Request Creation Authorization'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="modal-form-body">
                <input placeholder="Title" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} required />
                <input placeholder="Author" value={formData.author} onChange={e => setFormData({ ...formData, author: e.target.value })} />
                <input placeholder="Subject" value={formData.subject} onChange={e => setFormData({ ...formData, subject: e.target.value })} />
                <input placeholder="Call Number" value={formData.call_number} onChange={e => setFormData({ ...formData, call_number: e.target.value })} />
                <div className="form-row-dual">
                  <input placeholder="Dept" value={formData.department} onChange={e => setFormData({ ...formData, department: e.target.value })} />
                  <input placeholder="Year" value={formData.published_year} onChange={e => setFormData({ ...formData, published_year: e.target.value })} />
                </div>
                {/* The download fee is pages x the category's rate, so this is
                    what makes one document cost more than another. It used to
                    be absent from this form entirely, so every document was
                    stored with no page count and silently priced as 12. */}
                <div className="filter-input-gold" style={{ marginTop: '4px' }}>
                  <label style={{ fontSize: '12px', color: '#b2945b', display: 'block', marginBottom: '4px' }}>
                    Number of pages
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="e.g. 48"
                    value={formData.page_count}
                    onChange={e => setFormData({ ...formData, page_count: e.target.value })}
                    style={{ width: '100%' }}
                    required
                  />
                  <small style={{ fontSize: '11px', color: '#8a8a85', display: 'block', marginTop: '4px' }}>
                    The download fee is this many pages times the category's rate per page.
                  </small>
                </div>
                <input placeholder="Location" value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
                {/* Sensitivity. Stored values stay 'normal'/'medium'/'strict' —
                    only the wording changed — so every existing document and
                    the whole approval chain keep working untouched. */}
                <div className="filter-input-gold" style={{ marginTop: '15px' }}>
                  <label style={{ fontSize: '12px', color: '#b2945b', display: 'block', marginBottom: '4px' }}>
                    Classification
                  </label>
                  <select
                    value={formData.security_class}
                    onChange={e => setFormData({ ...formData, security_class: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    {SECURITY_LEVELS.map(level => (
                      <option key={level.key} value={level.key}>{level.label}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: '11px', color: '#8a8a85', marginTop: '4px' }}>
                    {SECURITY_LEVELS.find(l => l.key === formData.security_class)?.hint}
                  </div>
                </div>
                <div className="filter-input-gold" style={{ marginTop: '15px', marginBottom: '10px' }}>
                  <label style={{ fontSize: '12px', color: '#b2945b', display: 'block', marginBottom: '4px' }}>
                    {isEditing ? 'Replace Document Asset (Optional)' : 'Upload Document'}
                  </label>
                  <input type="file" onChange={e => setSelectedFile(e.target.files[0])} required={!isEditing} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="save-btn">Submit Request</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN DASHBOARD — Library category navigation shell
// ============================================================================
const Dashboard = ({ user, setUser }) => {
  // view: 'home' | 'tech_topics' | 'tech_list' | 'maps_format' | 'maps_type' | 'maps_scale' | 'map_list' | 'other_pub_types' | 'other_pubs_list' | 'books_list'
  const [view, setView] = useState('home');
  const [navContext, setNavContext] = useState({ category: null, reportTopic: null, mapType: null, mapFormat: null, scale: null, pubType: null, classification: null });
  const [topicSearch, setTopicSearch] = useState('');

  // The library structure, as the admin currently has it configured.
  const [categories, setCategories] = useState([]);
  const [structureLoading, setStructureLoading] = useState(true);
  const [structureError, setStructureError] = useState(null);
  const [activeCategoryKey, setActiveCategoryKey] = useState(null);

  const loadStructure = useCallback(() => {
    setStructureLoading(true);
    setStructureError(null);
    fetch(`${API}/api/taxonomy`)
      .then(async r => {
        // A 404 here means the server is running an older build that has no
        // /api/taxonomy route — almost always a backend that wasn't restarted.
        // Saying "nothing is set up" in that case sends people looking in the
        // wrong place, so the two cases are reported separately.
        if (r.status === 404) throw new Error('OUTDATED_SERVER');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { setCategories(Array.isArray(d.categories) ? d.categories : []); setStructureLoading(false); })
      .catch(err => {
        console.error('Could not load the library structure:', err);
        setStructureError(err.message === 'OUTDATED_SERVER' ? 'outdated' : 'unreachable');
        setStructureLoading(false);
      });
  }, []);

  useEffect(() => { loadStructure(); }, [loadStructure]);

  const activeCategory = useMemo(
    () => categories.find(c => c.key === activeCategoryKey) || null,
    [categories, activeCategoryKey]
  );

  // Children of the active category, split by which list they belong to.
  const childrenOfKind = useCallback(
    (kind) => (activeCategory?.children || []).filter(ch => ch.kind === kind),
    [activeCategory]
  );

  // userId as well as role, so permissions a colleague delegated while on
  // leave are included.
  const { can: canDo, delegated: delegatedPerms } = usePermissions(user?.role, user?.id);
  const canEdit = canDo('edit');
  const canDelete = canDo('delete');
  const canAdd = canDo('add');   // its own permission now, not an alias for edit

  const isPrivilegedAdmin =
    user?.role === 'admin' ||
    user?.role === 'Department Head' ||
    user?.role === 'Senior Officer' ||
    user?.role === 'manager';

  const handleLogout = async () => {
    try {
      await fetch(`${API}/api/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id }),
      });
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    setUser(null);
    localStorage.removeItem('user');
  };

  const goHome = () => {
    setView('home');
    setNavContext({ category: null, reportTopic: null, mapType: null, mapFormat: null, scale: null, pubType: null, classification: null });
    setActiveCategoryKey(null);
    setTopicSearch('');
  };

  // Where a category card leads, decided by how the admin configured it.
  const openCategory = (cat) => {
    setActiveCategoryKey(cat.key);
    const base = { category: cat.key, reportTopic: null, mapType: null, mapFormat: null, scale: null, pubType: null, classification: null };
    setNavContext(base);
    setTopicSearch('');
    if (cat.nav === 'report_topic') setView('tech_topics');
    else if (cat.nav === 'map') setView('maps_format');
    else if (cat.nav === 'pub_type') setView('other_pub_types');
    else if (cat.nav === 'item') setView('items');
    else setView('books_list');
  };

  const filteredTechTopics = useMemo(() => {
    const topics = (activeCategory?.children || [])
      .filter(ch => ch.kind === 'report_topic')
      .slice()
      .sort((a, b) => {
        // Numeric where the codes are numbers, alphabetical otherwise, so a
        // code the admin typed as text doesn't break the ordering.
        const na = Number(a.code), nb = Number(b.code);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return String(a.code || a.label).localeCompare(String(b.code || b.label));
      });
    const q = topicSearch.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter(t => padCode(t.code).includes(q) || t.label.toLowerCase().includes(q));
  }, [topicSearch, activeCategory]);

  const renderBreadcrumb = () => {
    if (view === 'home') return null;
    return (
      <div className="lib-breadcrumb">
        <button className="lib-back-btn" onClick={goHome}>← Library Home</button>
        {view !== 'tech_topics' && view !== 'maps_format' && view !== 'other_pub_types' && view !== 'books_list' && view !== 'items' && (
          <button
            className="lib-back-btn"
            onClick={() => {
              if (view === 'tech_list') setView('tech_topics');
              else if (view === 'maps_type') setView('maps_format');
              else if (view === 'maps_scale') setView('maps_type');
              // Back from a map list lands on the scale picker only if this
              // library actually has scales configured.
              else if (view === 'map_list') setView(childrenOfKind('map_scale').length > 0 ? 'maps_scale' : 'maps_type');
              else if (view === 'other_pubs_list') setView('other_pub_types');
              else if (view === 'item_list') setView('items');
            }}
          >
            ← Back
          </button>
        )}
      </div>
    );
  };

  const renderHome = () => {
    if (structureLoading) return <div className="lib-empty-note">Loading the library…</div>;

    if (structureError) {
      return (
        <div className="lib-empty-note">
          <strong>The library structure could not be loaded — your documents are safe.</strong>
          <div style={{ marginTop: 8 }}>
            {structureError === 'outdated'
              ? 'The server is running an older version that does not have the library-structure API yet. Restart the backend (npm start in the back-end folder) and reload this page.'
              : 'The server could not be reached. Check that the backend is running, then try again.'}
          </div>
          <button className="lib-back-btn" style={{ marginTop: 12 }} onClick={loadStructure}>
            Try again
          </button>
        </div>
      );
    }

    if (categories.length === 0) {
      return (
        <div className="lib-empty-note">
          No library categories have been set up yet. An administrator can add them
          under Admin → Library structure.
        </div>
      );
    }
    return (
      <div className="lib-home-grid">
        {categories.map(cat => (
          <div key={cat.key} className="lib-card" onClick={() => openCategory(cat)}>
            <div className="lib-card-icon">{cat.icon || '📁'}</div>
            <div className="lib-card-title">{cat.label}</div>
            {cat.subtitle && <div className="lib-card-sub">{cat.subtitle}</div>}
          </div>
        ))}
      </div>
    );
  };

  const renderTechTopics = () => (
    <div>
      <h3 className="lib-panel-title">{activeCategory?.label || 'Technical Reports'}</h3>
      <input
        className="lib-search-box"
        placeholder="Search by report name or number..."
        value={topicSearch}
        onChange={e => setTopicSearch(e.target.value)}
      />
      <div className="lib-btn-grid">
        {filteredTechTopics.map(t => (
          <div
            key={t.id}
            className="lib-topic-btn"
            onClick={() => {
              setNavContext({ ...navContext, category: activeCategory.key, reportTopic: topicValue(t) });
              setView('tech_list');
            }}
          >
            <span className="lib-topic-number">{padCode(t.code)}</span>
            <div className="lib-topic-label">{t.label}</div>
          </div>
        ))}
      </div>
      {filteredTechTopics.length === 0 && (
        <div className="lib-empty-note">
          {topicSearch ? 'No matching report topics.' : 'No topics have been added to this category yet.'}
        </div>
      )}
    </div>
  );

  // One flat list — what any category the admin creates gets.
  const renderItems = () => {
    const items = childrenOfKind('item');
    if (items.length === 0) {
      // A category with nothing inside it is just a document list.
      return (
        <DocumentListPanel
          title={activeCategory?.label || 'Documents'}
          context={navContext}
          user={user}
          canEdit={canEdit}
          canDelete={canDelete}
          canAdd={canAdd}
          canDo={canDo}
        />
      );
    }
    return (
      <div>
        <h3 className="lib-panel-title">{activeCategory?.label}</h3>
        <div className="lib-btn-grid">
          {items.map(it => (
            <div
              key={it.id}
              className="lib-format-btn"
              onClick={() => {
                setNavContext({ ...navContext, category: activeCategory.key, classification: it.key });
                setView('item_list');
              }}
            >
              {it.label}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMapsFormat = () => {
    const formats = childrenOfKind('map_format');
    return (
      <div>
        <h3 className="lib-panel-title">{activeCategory?.label || 'Maps'}</h3>
        <div className="lib-btn-grid">
          {formats.map(f => (
            <div
              key={f.id}
              className="lib-format-btn"
              onClick={() => { setNavContext({ ...navContext, category: activeCategory.key, mapFormat: f.key, mapType: null, scale: null }); setView('maps_type'); }}
            >
              {f.label}
            </div>
          ))}
        </div>
        {formats.length === 0 && <div className="lib-empty-note">No formats have been added to this category yet.</div>}
      </div>
    );
  };

  const renderOtherPubTypes = () => {
    const pubTypes = childrenOfKind('pub_type');
    return (
      <div>
        <h3 className="lib-panel-title">{activeCategory?.label || 'Other Publications'}</h3>
        <div className="lib-btn-grid">
          {pubTypes.map(t => (
            <div
              key={t.id}
              className="lib-format-btn"
              onClick={() => {
                setNavContext({ ...navContext, category: activeCategory.key, pubType: t.key });
                setView('other_pubs_list');
              }}
            >
              {t.label}
            </div>
          ))}
        </div>
        {pubTypes.length === 0 && <div className="lib-empty-note">No publication types have been added yet.</div>}
      </div>
    );
  };

  const renderMapsType = () => {
    const types = childrenOfKind('map_type');
    const formatLabel = childrenOfKind('map_format').find(f => f.key === navContext.mapFormat)?.label || '';
    const hasScales = childrenOfKind('map_scale').length > 0;
    return (
      <div>
        <h3 className="lib-panel-title">{activeCategory?.label} — {formatLabel}</h3>
        <div className="lib-btn-grid">
          {types.map(m => (
            <div
              key={m.id}
              className="lib-maptype-btn"
              onClick={() => {
                setNavContext({ ...navContext, mapType: m.key, scale: null });
                setView(hasScales ? 'maps_scale' : 'map_list');
              }}
            >
              {m.label}
            </div>
          ))}
        </div>
        {types.length === 0 && <div className="lib-empty-note">No map types have been added yet.</div>}
      </div>
    );
  };

  const renderMapsScale = () => {
    const scales = childrenOfKind('map_scale');
    const typeLabel = childrenOfKind('map_type').find(m => m.key === navContext.mapType)?.label;
    return (
      <div>
        <h3 className="lib-panel-title">{typeLabel} — Select Scale</h3>
        <div className="lib-btn-grid">
          {scales.map(sc => (
            // The scale is stored on each document as its display text, so the
            // label is the value here, not the key.
            <div key={sc.id} className="lib-scale-btn" onClick={() => { setNavContext({ ...navContext, scale: sc.label }); setView('map_list'); }}>
              {sc.label}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Heading above a document list, built from however the admin has named
  // things rather than from fixed strings.
  const panelTitleForList = () => {
    const categoryLabel = activeCategory?.label || 'Library';
    const nav = activeCategory?.nav;

    if (nav === 'report_topic') return `${categoryLabel} — ${navContext.reportTopic}`;
    if (nav === 'none' || !nav) return categoryLabel;
    if (nav === 'pub_type') {
      const pubLabel = childrenOfKind('pub_type').find(t => t.key === navContext.pubType)?.label;
      return pubLabel ? `${categoryLabel} — ${pubLabel}` : categoryLabel;
    }
    if (nav === 'item') {
      const itemLabel = childrenOfKind('item').find(t => t.key === navContext.classification)?.label;
      return itemLabel ? `${categoryLabel} — ${itemLabel}` : categoryLabel;
    }
    // Maps: type, scale and format together.
    const typeLabel = childrenOfKind('map_type').find(m => m.key === navContext.mapType)?.label || categoryLabel;
    const formatLabel = childrenOfKind('map_format').find(f => f.key === navContext.mapFormat)?.label || '';
    const suffix = formatLabel ? ` (${formatLabel})` : '';
    return navContext.scale ? `${typeLabel} — ${navContext.scale}${suffix}` : `${typeLabel}${suffix}`;
  };

  return (
    <div className="dashboard-container-gold">
      <div className="dashboard-main-gold">
        <div className="main-header">
          <h2 className="section-title">Ethiopia Geological Institute Library Records</h2>
          {isPrivilegedAdmin && (
            <button
              type="button"
              className="btn-add-elegant"
              style={{ backgroundColor: '#1a5e4b', borderColor: '#0d3d31', color: '#fff' }}
              onClick={() => setUser({ ...user })}
            >
              🛡️ Open Management Console
            </button>
          )}
        </div>

        <div className="lib-root">
          {renderBreadcrumb()}
          {view === 'home' && renderHome()}
          {view === 'tech_topics' && renderTechTopics()}
          {view === 'tech_list' && (
            <DocumentListPanel
              title={panelTitleForList()}
              context={navContext}
              user={user}
              canEdit={canEdit}
              canDelete={canDelete}
              canAdd={canAdd}
              canDo={canDo}
            />
          )}
          {view === 'maps_format' && renderMapsFormat()}
          {view === 'maps_type' && renderMapsType()}
          {view === 'maps_scale' && renderMapsScale()}
          {view === 'map_list' && (
            <DocumentListPanel
              title={panelTitleForList()}
              context={navContext}
              user={user}
              canEdit={canEdit}
              canDelete={canDelete}
              canAdd={canAdd}
              canDo={canDo}
            />
          )}
          {view === 'other_pub_types' && renderOtherPubTypes()}
          {view === 'other_pubs_list' && (
            <DocumentListPanel
              title={panelTitleForList()}
              context={navContext}
              user={user}
              canEdit={canEdit}
              canDelete={canDelete}
              canAdd={canAdd}
              canDo={canDo}
            />
          )}
          {view === 'items' && renderItems()}
          {view === 'item_list' && (
            <DocumentListPanel
              title={panelTitleForList()}
              context={navContext}
              user={user}
              canEdit={canEdit}
              canDelete={canDelete}
              canAdd={canAdd}
              canDo={canDo}
            />
          )}
          {view === 'books_list' && (
            <DocumentListPanel
              title={panelTitleForList()}
              context={navContext}
              user={user}
              canEdit={canEdit}
              canDelete={canDelete}
              canAdd={canAdd}
              canDo={canDo}
            />
          )}
        </div>
      </div>

      <div className="dashboard-sidebar-gold">
        <div className="profile-section-gold">
          <div className="avatar-gold">👤</div>
          <h3>{user?.username}</h3>
          <span className="role-tag">{user?.role}</span>
        </div>
        <button className="logout-btn-red" onClick={handleLogout}>Logout System</button>
      </div>
    </div>
  );
};

export default Dashboard;