import React, { useState, useEffect } from 'react';
import './StatDetailModal.css';

const h = React.createElement;
import { API } from '../config';

// ----------------------------------------------------------------------------
// One shared modal component that renders three different list types
// depending on `kind`:
//   'active-users' -> GET /api/users?filter=active
//   'new-accounts' -> GET /api/users?filter=new30d
//   'audit-events' -> GET /api/audit-logs?limit=50
// ----------------------------------------------------------------------------

const MODAL_CONFIG = {
  'active-users': {
    title: 'Active users',
    subtitle: 'Everyone currently marked Active in the system',
    endpoint: `${API}/api/users?filter=active`,
  },
  'new-accounts': {
    title: 'New accounts (30 days)',
    subtitle: 'Accounts created in the last 30 days',
    endpoint: `${API}/api/users?filter=new30d`,
  },
  'audit-events': {
    title: 'Audit events (24h)',
    subtitle: 'Logged actions across the system in the last 24 hours',
    endpoint: `${API}/api/audit-logs?limit=50`,
  },
};

function formatDate(ts) {
  if (!ts) return '\u2014';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts; // already-formatted string from the server
  return d.toLocaleString();
}

const StatDetailModal = ({ kind, onClose }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 1. We keep this here so the component can safely exit early during render layout checks
  const config = MODAL_CONFIG[kind];

  useEffect(() => {
    // 2. Derive config locally inside the effect block to satisfy dependency rules
    const localConfig = MODAL_CONFIG[kind];
    if (!localConfig) return;
    
    setLoading(true);
    setError('');
    
    fetch(localConfig.endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    })
      .then(res => {
        if (!res.ok) {
          throw new Error(`Server status: ${res.status}`);
        }
        return res.json();
      })
      .then(data => { 
        // FIX: Extract the array safely if the backend wraps logs inside an envelope object
        let extractedRows = [];
        if (Array.isArray(data)) {
          extractedRows = data;
        } else if (data && Array.isArray(data.logs)) {
          extractedRows = data.logs;
        } else if (data && Array.isArray(data.data)) {
          extractedRows = data.data;
        } else if (data && typeof data === 'object') {
          // If it's an object with array fields somewhere, pull the first matching array
          const fallbackKey = Object.keys(data).find(key => Array.isArray(data[key]));
          if (fallbackKey) extractedRows = data[fallbackKey];
        }
        
        setRows(extractedRows); 
        setLoading(false); 
      })
      .catch(err => {
        console.error('Failed to load modal data:', err);
        setError('Could not load this list. Please try again.');
        setLoading(false);
      });
  }, [kind]); // Only re-runs smoothly when the modal 'kind' actually switches

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!config) return null;

  // --- Body renderers per list type ---

  const renderUserRows = () => h('table', { className: 'sdm-table' },
    h('thead', null,
      h('tr', null,
        h('th', null, 'Username'),
        h('th', null, 'Role'),
        h('th', null, 'Department'),
        h('th', null, kind === 'new-accounts' ? 'Created' : 'Last active')
      )
    ),
    h('tbody', null,
      rows.map((u, idx) => h('tr', { key: u.id || `u-${idx}` },
        h('td', { className: 'sdm-cell-strong' }, u.username || u.user || '\u2014'),
        h('td', null, h('span', { className: 'sdm-role-pill' }, u.role || 'User')),
        h('td', null, u.department || '\u2014'),
        h('td', { className: 'sdm-cell-muted' },
          kind === 'new-accounts' ? formatDate(u.created_at) : formatDate(u.last_active_at)
        )
      ))
    )
  );

  const renderAuditRows = () => h('table', { className: 'sdm-table' },
    h('thead', null,
      h('tr', null,
        h('th', null, 'Time'),
        h('th', null, 'Username'),
        h('th', null, 'Role'),
        h('th', null, 'Action'),
        h('th', null, 'Detail')
      )
    ),
    h('tbody', null,
      rows.map((a, idx) => h('tr', { key: a.id || `a-${idx}` },
        // Fallback checks matching Postgres columns: time/created_at, user/username, detail/message
        h('td', { className: 'sdm-cell-muted' }, a.time || formatDate(a.created_at) || '\u2014'),
        h('td', { className: 'sdm-cell-strong' }, a.user || a.username || 'System'),
        h('td', null, a.role && a.role !== '\u2014' ? h('span', { className: 'sdm-role-pill' }, a.role) : '\u2014'),
        h('td', null, h('span', { className: `sdm-action-pill sdm-sev-${a.severity || 'info'}` }, a.action || 'Log')),
        h('td', { className: 'sdm-cell-muted' }, a.detail || a.message || '\u2014')
      ))
    )
  );

  const renderBody = () => {
    if (loading) return h('div', { className: 'sdm-state' }, 'Loading...');
    if (error) return h('div', { className: 'sdm-state sdm-state--error' }, error);
    if (rows.length === 0) return h('div', { className: 'sdm-state' }, 'Nothing to show here right now.');
    return h('div', { className: 'sdm-table-wrap' },
      kind === 'audit-events' ? renderAuditRows() : renderUserRows()
    );
  };

  return h('div', { className: 'sdm-overlay', onClick: onClose },
    h('div', { className: 'sdm-modal', onClick: (e) => e.stopPropagation() },
      h('div', { className: 'sdm-header' },
        h('div', null,
          h('h2', { className: 'sdm-title' }, config.title),
          h('p', { className: 'sdm-subtitle' }, config.subtitle)
        ),
        h('button', { className: 'sdm-close-btn', onClick: onClose, 'aria-label': 'Close' }, '\u2715')
      ),
      h('div', { className: 'sdm-count-row' },
        loading ? '' : `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`
      ),
      renderBody()
    )
  );
};

export default StatDetailModal;