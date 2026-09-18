import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './Dashboard.css';
import './LibraryNav.css';
import { usePermissions } from './UsePermissions';
import { askReason, askConfirm, showAlert } from './dialogs';

import { API } from '../config';
const CURRENT_YEAR = new Date().getFullYear();
const EARLIEST_YEAR = 1950; // adjust if older records exist in the archive

// ============================================================================
// LIBRARY CATEGORY STRUCTURE
// ============================================================================

// Technical Reports — numbered topics, browsed in ascending order.
// Full index taken from Library_.pdf. Append more {number,label} objects
// here if new topics get added later — the grid always sorts ascending.
const TECHNICAL_REPORT_TOPICS = [
  { number: 1,   label: 'Abrasives (Pumice)' },
  { number: 2,   label: 'Kaolin Belesa Feldspar, Quartz' },
  { number: 5,   label: 'Asbestos' },
  { number: 6,   label: 'Baryte' },
  { number: 7,   label: 'Beryl' },
  { number: 8,   label: 'Black Sands' },
  { number: 11,  label: 'Building Material (Pumice)' },
  { number: 14,  label: 'Calcium' },
  { number: 15,  label: 'Carbon Dioxide' },
  { number: 16,  label: 'Cement Raw Material' },
  { number: 18,  label: 'Ceramics' },
  { number: 19,  label: 'Chromite' },
  { number: 20,  label: 'Bentonite & Clay (Kyanite)' },
  { number: 21,  label: 'Coal, Lignite' },
  { number: 24,  label: 'Copper' },
  { number: 27,  label: 'Diatomite' },
  { number: 29,  label: 'Evaporite Minerals' },
  { number: 30,  label: 'Calcitic, Industrial Deposit' },
  { number: 38,  label: 'Gemstones' },
  { number: 40,  label: 'Sheet Glass' },
  { number: 41,  label: 'Gold' },
  { number: 42,  label: 'Graphite and Talc' },
  { number: 43,  label: 'Gypsum, Alluvial' },
  { number: 47,  label: 'Sysertskite' },
  { number: 48,  label: 'Iron Report' },
  { number: 49,  label: 'Lead, Zinc' },
  { number: 50,  label: 'Building Stone, Lime & Limestone Marble' },
  { number: 54,  label: 'Manganese' },
  { number: 57,  label: 'Mica' },
  { number: 58,  label: 'Mineral Water' },
  { number: 63,  label: 'Nickel' },
  { number: 65,  label: 'Olivine' },
  { number: 68,  label: 'Petroleum Oil & Gas' },
  { number: 69,  label: 'Ilmenite, Apatite, Phosphate & Magnetite' },
  { number: 70,  label: 'Pigments' },
  { number: 71,  label: 'Platinum' },
  { number: 73,  label: 'Potash' },
  { number: 76,  label: 'Quartzite' },
  { number: 83,  label: 'Salt' },
  { number: 90,  label: 'Silica, Silicon Dolomite' },
  { number: 92,  label: 'Sodium, Soda' },
  { number: 94,  label: 'Sulphur' },
  { number: 97,  label: 'Tantalum' },
  { number: 102, label: 'Tin' },
  { number: 103, label: 'Titanium' },
  { number: 104, label: 'Travertine' },
  { number: 105, label: 'Tungsten' },
  { number: 106, label: 'Uranium' },
  { number: 107, label: 'Vanadium' },
  { number: 108, label: 'Water' },
  { number: 111, label: 'Zircon' },
  { number: 780, label: 'Bibliography' },
  { number: 790, label: 'Cartography Maps' },
  { number: 800, label: 'Chemistry' },
  { number: 810, label: 'Geochemistry' },
  { number: 820, label: 'Geochronology' },
  { number: 821, label: 'Geology' },
  { number: 822, label: 'Economic Geology' },
  { number: 823, label: 'Engineering' },
  { number: 824, label: 'Structural Geology' },
  { number: 830, label: 'Geomorphology' },
  { number: 840, label: 'Geophysics' },
  { number: 860, label: 'Geothermal' },
  { number: 875, label: 'Glaciation' },
  { number: 880, label: 'Hydrogeology' },
  { number: 900, label: 'Mineralogy' },
  { number: 905, label: 'Mining & Prospecting' },
  { number: 908, label: 'Palaeogeography' },
  { number: 910, label: 'Palaeontology' },
  { number: 912, label: 'Petrology' },
  { number: 914, label: 'Photogeology' },
  { number: 916, label: 'Stratigraphy' },
  { number: 920, label: 'Volcanology' },
].sort((a, b) => a.number - b.number);

// Institutional standard: codes are always 3-digit, zero-padded (e.g. '001'
// not '1'). Sorting above stays numeric on t.number; this only affects the
// display string and the report_topic value stored on each book.
function padCode(n) {
  return String(n).padStart(3, '0');
}

const MAP_FORMATS = [
  { key: 'pdf', label: 'PDF' },
  { key: 'jpg', label: 'JPG' },
  { key: 'shapefile', label: 'Shapefile' },
];

const MAP_TYPES = [
  { key: 'geological', label: 'Geological Maps', hasScale: true },
  { key: 'hydrogeological', label: 'Hydrogeological Maps', hasScale: true },
  { key: 'hydrochemical', label: 'Hydrochemical Maps', hasScale: true },
  { key: 'engineering_geological', label: 'Engineering Geological Maps', hasScale: true },
  { key: 'topo', label: 'Topo Maps', hasScale: true },
];

// Same scale list for every map type.
const COMMON_MAP_SCALES = ['1:25,000', '1:50,000', '1:100,000', '1:200,000', '1:250,000', '1:500,000', '1:1,000,000', '1:2,000,000'];

const SCALES_BY_MAP_TYPE = {
  geological: COMMON_MAP_SCALES,
  hydrogeological: COMMON_MAP_SCALES,
  hydrochemical: COMMON_MAP_SCALES,
  engineering_geological: COMMON_MAP_SCALES,
  topo: COMMON_MAP_SCALES,
};

const OTHER_PUB_TYPES = [
  { key: 'company_report', label: 'Company Reports' },
  { key: 'journal', label: 'Journals' },
  { key: 'governmental_publication', label: 'Governmental Publications' },
  { key: 'other', label: 'Others' },
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

// Which role reviews this maker's requests first:
// User -> Officer, Officer -> Senior Officer, Senior Officer -> Department Head.
function reviewerRoleForMaker(makerRole) {
  if (makerRole === 'Officer') return 'Senior Officer';
  if (makerRole === 'Senior Officer') return 'Department Head';
  return 'Officer';
}

// Everyone holding that role, for the "send to a specific person" picker.
async function fetchReviewers(role) {
  try {
    const res = await fetch(`${API}/api/users/by-role?role=${encodeURIComponent(role)}`);
    const data = await res.json();
    return res.ok && Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
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
  const [formData, setFormData] = useState({ title: '', author: '', subject: '', call_number: '', department: '', location: '', published_year: '' });
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
    const reviewerRole = reviewerRoleForMaker(user.role);
    const reviewers = await fetchReviewers(reviewerRole);
    const reasonResult = await askReason({
      title: 'Authorization Request',
      message: `ENTER YOUR BUSINESS REASON TO INITIATE THIS ${String(actionType).toUpperCase()} REQUEST.`,
      reviewers,
      reviewerLabel: `Send to (${reviewerRole})`,
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

  const executeDownload = async (book) => {
    if (!book.file_path) { showAlert('No file available for download.'); return; }
    if (!canDo('download')) { showAlert('Access Denied: Your role does not have permission to download.'); return; }

    // Senior Officer, Department Head, admin and manager download directly.
    // Officers are makers: they ask the Senior Officer (checker) with a
    // reason and download free once accepted — never via the authorizer.
    // Regular Users also go through a checker, then pay.
    const isOfficerMaker = user?.role === 'Officer';
    if (user?.role !== 'User' && !isOfficerMaker) {
      window.open(`${API}/api/downloads/direct/${book.id}?userId=${user.id}`, '_blank', 'noopener');
      return;
    }

    try {
      // Maker → checker flow: if this maker already has a request for this
      // book, don't create a duplicate. If the checker accepted it, pay and
      // download now; otherwise it's still waiting.
      const mineRes = await fetch(`${API}/api/office-requests?makerId=${user.id}&requestType=download`);
      const mine = await mineRes.json();
      if (mineRes.ok && Array.isArray(mine)) {
        const existing = mine.find(r => r.targetBookId === book.id && r.stage !== 'rejected' && !(r.stage === 'approved' && r.paymentStatus === 'paid' && !isOfficerMaker));
        if (existing && existing.stage === 'approved' && isOfficerMaker) {
          // Checker accepted — officers download free, no payment step.
          window.open(`${API}/api/downloads/${existing.id}/file?userId=${user.id}`, '_blank', 'noopener');
          return;
        }
        if (existing && existing.stage === 'approved') {
          const payNow = await askConfirm({
            title: 'Download Approved',
            message: `YOUR REQUEST ${existing.requestCode} WAS ACCEPTED BY THE CHECKER.\nFee: ${existing.totalFee} ETB (${existing.pageCount} pages @ ${existing.feePerPage}/page).\n\nPay and download now?`,
            okLabel: 'Pay & Download',
          });
          if (!payNow) return;
          const payRes = await fetch(`${API}/api/payments/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: existing.id, userId: user.id }),
          });
          const payment = await payRes.json();
          if (!payRes.ok) { showAlert(payment.message || 'Payment failed.'); return; }
          window.open(`${API}${payment.downloadUrl}`, '_blank');
          return;
        }
        if (existing) {
          showAlert(`Your request ${existing.requestCode} is still waiting for the checker to accept it. Once accepted, click Download again to pay and download.`);
          return;
        }
      }

      const initRes = await fetch(`${API}/api/downloads/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: book.id }),
      });
      const quote = await initRes.json();
      if (!initRes.ok) { showAlert(quote.message || 'Could not get a download quote.'); return; }

      const reviewerRole = reviewerRoleForMaker(user.role);
      const reviewers = await fetchReviewers(reviewerRole);
      const reasonResult = await askReason({
        title: 'Download Request',
        message: isOfficerMaker
          ? `"${quote.title}" — your request will be sent to the Senior Officer (checker) for acceptance. No fee. Enter your reason for this download.`
          : `"${quote.title}" — ${quote.totalFee} ETB (${quote.pageCount} pages @ ${quote.feePerPage}/page). Your request will be sent to the checker for acceptance. Enter your reason for this download.`,
        reviewers,
        reviewerLabel: `Send to (${reviewerRole})`,
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

      showAlert(isOfficerMaker
        ? `Request ${request.request_code} sent to the Senior Officer with your reason. Once accepted, click Download again to download.`
        : `Request ${request.request_code} sent to the checker with your reason. Once the checker accepts it, click Download again to pay and download.`);
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
      published_year: book.published_year || '',
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
                    <span><strong>Pages:</strong> {book.page_count || 12} pages</span>
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
                <input placeholder="Location" value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
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
  const [navContext, setNavContext] = useState({ category: null, reportTopic: null, mapType: null, mapFormat: null, scale: null, pubType: null });
  const [topicSearch, setTopicSearch] = useState('');

  const { can: canDo } = usePermissions(user?.role);
  const canEdit = canDo('edit');
  const canDelete = canDo('delete');
  const canAdd = canDo('edit');

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

  const goHome = () => { setView('home'); setNavContext({ category: null, reportTopic: null, mapType: null, mapFormat: null, scale: null, pubType: null }); setTopicSearch(''); };

  const filteredTechTopics = useMemo(() => {
    const q = topicSearch.trim().toLowerCase();
    if (!q) return TECHNICAL_REPORT_TOPICS;
    return TECHNICAL_REPORT_TOPICS.filter(t => padCode(t.number).includes(q) || t.label.toLowerCase().includes(q));
  }, [topicSearch]);

  const renderBreadcrumb = () => {
    if (view === 'home') return null;
    return (
      <div className="lib-breadcrumb">
        <button className="lib-back-btn" onClick={goHome}>← Library Home</button>
        {view !== 'tech_topics' && view !== 'maps_format' && view !== 'other_pub_types' && view !== 'books_list' && (
          <button
            className="lib-back-btn"
            onClick={() => {
              if (view === 'tech_list') setView('tech_topics');
              else if (view === 'maps_type') setView('maps_format');
              else if (view === 'maps_scale') setView('maps_type');
              else if (view === 'map_list') setView(navContext.mapType && SCALES_BY_MAP_TYPE[navContext.mapType] ? 'maps_scale' : 'maps_type');
              else if (view === 'other_pubs_list') setView('other_pub_types');
            }}
          >
            ← Back
          </button>
        )}
      </div>
    );
  };

  const renderHome = () => (
    <div className="lib-home-grid">
      <div className="lib-card" onClick={() => setView('tech_topics')}>
        <div className="lib-card-icon">📑</div>
        <div className="lib-card-title">Technical Reports</div>
        <div className="lib-card-sub">Browse by report number</div>
      </div>
      <div className="lib-card" onClick={() => setView('maps_format')}>
        <div className="lib-card-icon">🗺️</div>
        <div className="lib-card-title">Maps</div>
        <div className="lib-card-sub">PDF · JPG · Shapefile</div>
      </div>
      <div className="lib-card" onClick={() => setView('other_pub_types')}>
        <div className="lib-card-icon">📚</div>
        <div className="lib-card-title">Other Publications</div>
        <div className="lib-card-sub">Company · Journals · Government · Others</div>
      </div>
      <div
        className="lib-card"
        onClick={() => {
          setNavContext({ category: 'book', reportTopic: null, mapType: null, mapFormat: null, scale: null });
          setView('books_list');
        }}
      >
        <div className="lib-card-icon">📖</div>
        <div className="lib-card-title">Books</div>
        <div className="lib-card-sub">Search by author, title, subject, call number</div>
      </div>
    </div>
  );

  const renderTechTopics = () => (
    <div>
      <h3 className="lib-panel-title">Technical Reports</h3>
      <input
        className="lib-search-box"
        placeholder="Search by report name or number..."
        value={topicSearch}
        onChange={e => setTopicSearch(e.target.value)}
      />
      <div className="lib-btn-grid">
        {filteredTechTopics.map(t => (
          <div
            key={t.number}
            className="lib-topic-btn"
            onClick={() => {
              setNavContext({ category: 'technical_report', reportTopic: `${padCode(t.number)} ${t.label}`, mapType: null, mapFormat: null, scale: null });
              setView('tech_list');
            }}
          >
            <span className="lib-topic-number">{padCode(t.number)}</span>
            <div className="lib-topic-label">{t.label}</div>
          </div>
        ))}
      </div>
      {filteredTechTopics.length === 0 && <div className="lib-empty-note">No matching report topics.</div>}
    </div>
  );

  const renderMapsFormat = () => (
    <div>
      <h3 className="lib-panel-title">Maps</h3>
      <div className="lib-btn-grid">
        {MAP_FORMATS.map(f => (
          <div
            key={f.key}
            className="lib-format-btn"
            onClick={() => { setNavContext({ ...navContext, category: 'map', mapFormat: f.key, mapType: null, scale: null }); setView('maps_type'); }}
          >
            {f.label}
          </div>
        ))}
      </div>
    </div>
  );

  const renderOtherPubTypes = () => (
    <div>
      <h3 className="lib-panel-title">Other Publications</h3>
      <div className="lib-btn-grid">
        {OTHER_PUB_TYPES.map(t => (
          <div
            key={t.key}
            className="lib-format-btn"
            onClick={() => {
              setNavContext({ category: 'other_publication', reportTopic: null, mapType: null, mapFormat: null, scale: null, pubType: t.key });
              setView('other_pubs_list');
            }}
          >
            {t.label}
          </div>
        ))}
      </div>
    </div>
  );

  const renderMapsType = () => (
    <div>
      <h3 className="lib-panel-title">Maps — {MAP_FORMATS.find(f => f.key === navContext.mapFormat)?.label}</h3>
      <div className="lib-btn-grid">
        {MAP_TYPES.map(m => (
          <div
            key={m.key}
            className="lib-maptype-btn"
            onClick={() => {
              const next = { ...navContext, mapType: m.key, scale: null };
              setNavContext(next);
              setView(m.hasScale ? 'maps_scale' : 'map_list');
            }}
          >
            {m.label}
          </div>
        ))}
      </div>
    </div>
  );

  const renderMapsScale = () => {
    const scales = SCALES_BY_MAP_TYPE[navContext.mapType] || [];
    const typeLabel = MAP_TYPES.find(m => m.key === navContext.mapType)?.label;
    return (
      <div>
        <h3 className="lib-panel-title">{typeLabel} — Select Scale</h3>
        <div className="lib-btn-grid">
          {scales.map(s => (
            <div key={s} className="lib-scale-btn" onClick={() => { setNavContext({ ...navContext, scale: s }); setView('map_list'); }}>
              {s}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const panelTitleForList = () => {
    if (navContext.category === 'technical_report') return `Technical Reports — ${navContext.reportTopic}`;
    if (navContext.category === 'book') return 'Books';
    if (navContext.category === 'other_publication') {
      const pubLabel = OTHER_PUB_TYPES.find(t => t.key === navContext.pubType)?.label || 'Other Publications';
      return `Other Publications — ${pubLabel}`;
    }
    const typeLabel = MAP_TYPES.find(m => m.key === navContext.mapType)?.label || 'Maps';
    const formatLabel = MAP_FORMATS.find(f => f.key === navContext.mapFormat)?.label || '';
    return navContext.scale ? `${typeLabel} — ${navContext.scale} (${formatLabel})` : `${typeLabel} (${formatLabel})`;
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
          {view === 'books_list' && (
            <DocumentListPanel
              title="Books"
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