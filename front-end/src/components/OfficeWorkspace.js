import React, { useState } from 'react';
import './OfficeWorkspace.css';
import LibraryDashboard from './Dashboard';
import OfficeDashboard from './OfficeDashboard';

const h = React.createElement;

// ----------------------------------------------------------------------------
// Wraps both the Library (book records) page and the Office Dashboard
// (review queue) behind a simple two-tab switcher, for roles that need both
// but should not see the full admin console sidebar (Officer, Senior
// Officer, Department Head).
//
// user/setUser are passed straight through to LibraryDashboard exactly as
// AdminDashboard already does for the admin-console route, so logout and
// all existing Dashboard.js behavior works unchanged here too.
// ----------------------------------------------------------------------------
function OfficeWorkspace({ user, setUser }) {
  const [activeTab, setActiveTab] = useState('library'); // 'library' | 'office'

  // Safety Check: If user session data fails to resolve, render a clean error recovery UI
  if (!user) {
    return h('div', { className: 'office-workspace-error-fallback' },
      h('p', null, 'Loading active workspace profile session...'),
      h('button', { 
        className: 'ow-error-logout-btn', 
        onClick: () => setUser && setUser(null) 
      }, 'Return to Login')
    );
  }

  return h('div', { className: 'office-workspace-root' },
    h('div', { className: 'ow-tab-bar' },
      h('div', { className: 'ow-tab-bar-inner' },
        h('button', {
          className: `ow-tab ${activeTab === 'library' ? 'ow-tab--active' : ''}`,
          onClick: () => setActiveTab('library')
        }, 'Library Interface'),
        
        h('button', {
          className: `ow-tab ${activeTab === 'office' ? 'ow-tab--active' : ''}`,
          onClick: () => setActiveTab('office')
        }, 'Office Dashboard Review')
      )
    ),

    h('div', { className: 'ow-content' },
      activeTab === 'library'
        ? h(LibraryDashboard, { user: user, setUser: setUser })
        : h(OfficeDashboard, { currentUser: user })
    )
  );
}

export default OfficeWorkspace;