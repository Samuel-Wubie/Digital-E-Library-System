import React, { useState, useEffect, useMemo } from 'react';
import './Dashboard.css';
import FilterDropdown from './FilterDropdown';
import { usePermissions } from './UsePermissions';

const Dashboard = ({ user, setUser }) => {
  // --- STATES ---
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  
  // Adjusted form state tracking to match actual database schema
  const [formData, setFormData] = useState({
    title: '', author: '', department: '', location: '', published_year: ''
  });

  const [selectedFile, setSelectedFile] = useState(null);

  const [filters, setFilters] = useState({ 
    title: '', author: '', department: '', location: '', year: '' 
  });

  // --- VIEW MODAL STATES ---
  const [viewModal, setViewModal] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);

  // Reads the ACCESS-CONTROL matrix admins toggle Granted/Denied for
  const { can: canDo } = usePermissions(user?.role);
  const canEdit = canDo('edit');
  const canDelete = canDo('delete');
  const canAdd = canDo('edit'); // adding a new record uses the same 'edit' permission allocation matrix

  const isPrivilegedAdmin = 
    user?.role === 'admin' || 
    user?.role === 'Department Head' || 
    user?.role === 'Senior Officer' ||
    user?.role === 'manager';

  // --- REAL-TIME BACKEND SEARCH PIPELINE ---
  useEffect(() => {
    const fetchBooksFromDatabase = () => {
      setLoading(true);
      
      const queryParams = new URLSearchParams();
      if (filters.title) queryParams.append('title', filters.title);
      if (filters.author) queryParams.append('author', filters.author);
      if (filters.department) queryParams.append('department', filters.department);
      if (filters.location) queryParams.append('location', filters.location);
      if (filters.year) queryParams.append('year', filters.year);

      fetch(`http://localhost:5000/api/books/search?${queryParams.toString()}`)
        .then(res => res.json())
        .then(data => { 
          setBooks(data); 
          setLoading(false); 
        })
        .catch(err => { 
          console.error("Database fetch query failure:", err); 
          setLoading(false); 
        });
    };

    const delayDebounceFn = setTimeout(() => {
      fetchBooksFromDatabase();
    }, 400); // 400ms debounce window to protect system connection pools from typing spikes

    return () => clearTimeout(delayDebounceFn);
  }, [filters]); 

  // --- DYNAMIC FILTER SELECTION LISTS ---
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

  // --- MANDATORY MULTI-TIER MAKER -> CHECKER -> AUTHORIZER INTERCEPTOR PIPELINE ---
  const handleRequestSubmission = async (actionType, targetLabel, contextPayload = {}, uploadedFile = null) => {
    if (!canDo(actionType)) {
      alert(`Access Denied: Your role does not have permission to request a record ${actionType}.`);
      return false;
    }

    const userReason = window.prompt(`Enter your business reason to initiate this ${actionType} request:`);
    if (!userReason) return false;

    const multiPartForm = new FormData();
    multiPartForm.append('makerId', user.id);
    multiPartForm.append('makerRole', user.role);
    multiPartForm.append('requestType', actionType === 'add' || actionType === 'edit' || actionType === 'delete' ? 'permission' : actionType);
    multiPartForm.append('requestedPermission', actionType);
    multiPartForm.append('targetLabel', targetLabel);
    multiPartForm.append('reason', userReason);
    
    if (contextPayload.targetId) {
      multiPartForm.append('targetBookId', contextPayload.targetId);
    } else if (contextPayload.bookId) {
      multiPartForm.append('targetBookId', contextPayload.bookId);
    }

    multiPartForm.append('metaContext', JSON.stringify(contextPayload));

    if (uploadedFile) {
      multiPartForm.append('pdfFile', uploadedFile);
    }

    try {
      const res = await fetch('http://localhost:5000/api/office-requests', {
        method: 'POST',
        body: multiPartForm
      });
      
      if (res.ok) {
        alert("Workflow request initiated successfully! It has been routed to the approval chain.");
        return true;
      } else {
        const errData = await res.json();
        alert(`Pipeline error: ${errData.message}`);
        return false;
      }
    } catch (err) {
      console.error("Failed to generate workflow instance:", err);
      alert("System error tracking the submission workflow instance.");
      return false;
    }
  };

  const executeDownload = async (book) => {
    if (!book.file_path) {
      alert("No file available for download.");
      return;
    }
    await handleRequestSubmission('download', `Download Document: ${book.title}`, {
      bookId: book.id,
      filePath: book.file_path
    });
  };

  const openViewPreview = (book) => {
    if (book.file_path) {
      setSelectedBook(book);
      setViewModal(true);
    } else { 
      alert("No PDF associated with this record."); 
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('http://localhost:5000/api/logout', {
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
    setFormData({ title: '', author: '', department: '', location: '', published_year: '' }); 
    setSelectedFile(null);
    setIsEditing(false); 
    setShowModal(true); 
  };
  
  const handleOpenEdit = (book) => { 
    setFormData({
      title: book.title || '',
      author: book.author || '',
      department: book.department || '',
      location: book.location || '',
      published_year: book.published_year || ''
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
    
    const itemContext = {
      ...formData,
      isEditing: isEditing,
      targetId: isEditing ? currentId : null
    };

    const targetLabel = isEditing ? `Update Record: ${formData.title}` : `Create New Record: ${formData.title}`;
    const actionType = isEditing ? 'edit' : 'add';

    const success = await handleRequestSubmission(actionType, targetLabel, itemContext, selectedFile);
    if (success) {
      setShowModal(false);
      setSelectedFile(null);
    }
  };

  return (
    <div className="dashboard-container-gold">
      <div className="dashboard-main-gold">
        <div className="main-header">
          <h2 className="section-title">Ethiopia Geological Institute Library Records</h2>
          
          <div className="header-action-button-group" style={{ display: 'flex', gap: '12px' }}>
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

            {canAdd && <button className="btn-add-elegant" onClick={handleOpenAdd}>+ New Record</button>}
          </div>
        </div>

        {loading ? <div className="loader-text">Querying Live Vault...</div> : (
          <div className="results-list">
            {books.map(book => {
              const totalPages = book.department === 'Novel' ? 20 : 12; 
              
              return (
                <div key={book.id} className="book-card-gold">
                  <div className="book-left-content">
                    <div className="book-icon-box-gold">📂</div>
                    <div className="book-info">
                      <h3>{book.title}</h3>
                      <div className="info-grid">
                        <span><strong>Author:</strong> {book.author}</span>
                        <span><strong>Dept:</strong> {book.department}</span>
                        <span><strong>Loc:</strong> {book.location}</span>
                        <span><strong>Year:</strong> {book.published_year}</span>
                        <span><strong>Pages:</strong> {book.page_count || totalPages} pages</span>
                      </div>
                    </div>
                  </div>

                  <div className="book-actions">
                    <div className="action-button-row">
                      <button className="btn-view" onClick={() => openViewPreview({ ...book, page_count: book.page_count || totalPages })}>View</button>
                      {canDo('download') && (
                        <button className="btn-download" onClick={() => executeDownload({ ...book, page_count: book.page_count || totalPages })}>Download</button>
                      )}
                    </div>
                    {(canEdit || canDelete) && (
                      <div className="admin-btns">
                        {canEdit && <button className="edit-link" onClick={() => handleOpenEdit(book)}>Edit</button>}
                        {canDelete && <button className="delete-link" onClick={() => handleDelete(book.id)}>Delete</button>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {books.length === 0 && <div className="no-records-msg">No structural assets match your criteria.</div>}
          </div>
        )}
      </div>

      {/* SIDEBAR FILTERS */}
      <div className="dashboard-sidebar-gold">
        <div className="profile-section-gold">
          <div className="avatar-gold">👤</div>
          <h3>{user?.username}</h3>
          <span className="role-tag">{user?.role}</span>
        </div>

        <div className="sidebar-group">
          <h4>Live Server Filter</h4>
          <div className="filter-input-gold">
            <label>Title</label>
            <input placeholder="Search title..." value={filters.title} onChange={e => setFilters({...filters, title: e.target.value})} />
          </div>

          <div className="filter-input-gold">
            <label>Author</label>
            <input placeholder="Search author..." value={filters.author} onChange={e => setFilters({...filters, author: e.target.value})} />
          </div>

          <FilterDropdown label="Department" options={departmentOptions} value={filters.department} className="select-gold" onChange={e => setFilters({...filters, department: e.target.value})} />
          <FilterDropdown label="Location" options={locationOptions} value={filters.location} className="select-gold" onChange={e => setFilters({...filters, location: e.target.value})} />
          <FilterDropdown label="Year" options={yearOptions} value={filters.year} className="select-gold" onChange={e => setFilters({...filters, year: e.target.value})} />

          <button className="btn-reset" onClick={() => setFilters({title:'', author:'', department:'', location:'', year:''})}>Reset Filters</button>
        </div>
        <button className="logout-btn-red" onClick={handleLogout}>Logout System</button>
      </div>

      {/* ── UNRESTRICTED FULL-PAGE PREVIEW MODAL ── */}
      {viewModal && selectedBook && (
        <div className="modal-overlay">
          <div className="modal-content modal-content--viewer" style={{ maxWidth: '1100px', width: '95%', display: 'flex', flexDirection: 'column' }}>
            <div className="viewer-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #ddd' }}>
              <h3 style={{ margin: 0, color: '#1e293b' }}>Document Full View: {selectedBook.title}</h3>
              <button className="close-viewer-btn" onClick={() => setViewModal(false)}>✕ Close Preview</button>
            </div>
            
            <div className="document-scroll-container" style={{ position: 'relative', height: '80vh', backgroundColor: '#525659', marginTop: '10px', borderRadius: '4px', overflow: 'hidden' }}>
              
              {/* Native Document High Compatibility Embed Object */}
              <object
                data={`http://localhost:5000/uploades/${selectedBook.file_path}#toolbar=1&navpanes=1`}
                type="application/pdf"
                width="100%"
                height="100%"
                style={{ border: 'none' }}
              >
                {/* Fallback frame layer if browser plugins block object streams */}
                <iframe
                  src={`http://localhost:5000/uploades/${selectedBook.file_path}#toolbar=1&navpanes=1`}
                  title="PDF Fallback Full View"
                  width="100%"
                  height="100%"
                  style={{ border: 'none' }}
                />
              </object>

            </div>
          </div>
        </div>
      )}

      {/* FORM MODAL */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>{isEditing ? "Request Update Authorization" : "Request Creation Authorization"}</h3>
            <form onSubmit={handleSubmit}>
              <div className="modal-form-body">
                <input placeholder="Title" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} required />
                <input placeholder="Author" value={formData.author} onChange={e => setFormData({...formData, author: e.target.value})} />
                
                <div className="form-row-dual">
                  <input placeholder="Dept" value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} />
                  <input placeholder="Year" value={formData.published_year} onChange={e => setFormData({...formData, published_year: e.target.value})} />
                </div>
                
                <input placeholder="Location" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} />

                <div className="filter-input-gold" style={{ marginTop: '15px', marginBottom: '10px' }}>
                  <label style={{ fontSize: '12px', color: '#b2945b', display: 'block', marginBottom: '4px' }}>
                    {isEditing ? "Replace PDF Document Asset (Optional Context)" : "Upload Document PDF"}
                  </label>
                  <input 
                    type="file" 
                    accept="application/pdf" 
                    onChange={e => setSelectedFile(e.target.files[0])} 
                    required={!isEditing} 
                  />
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
};

export default Dashboard;