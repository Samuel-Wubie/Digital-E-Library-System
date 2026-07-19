import React, { useState, useEffect } from 'react';
import './OfficeWorkspace.css';
import LibraryDashboard from './Dashboard';
import NotificationBar from './NotificationBar';
import MyRequests, { PENDING_STAGES } from './MyRequests';
import libraryLogo from '../logo.png';

const h = React.createElement;
import { API } from '../config';

// ----------------------------------------------------------------------------
// UserWorkspace — admin-console-style vertical sidebar for the plain 'User'
// role. Nav items listed down the left: Library Interface and My Requests
// (red badge = their own requests still out for acceptance). Users are
// makers only — no review queue, no admin tabs.
// ----------------------------------------------------------------------------
function UserWorkspace({ user, setUser }) {
  const [activeTab, setActiveTab] = useState('library'); // 'library' | 'myrequests'
  const [myPendingCount, setMyPendingCount] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    const refresh = () => {
      fetch(`${API}/api/office-requests?makerId=${user.id}`)
        .then(r => r.json())
        .then(data => setMyPendingCount(
          (Array.isArray(data) ? data : []).filter(r => PENDING_STAGES.includes(r.stage)).length
        ))
        .catch(() => {});
    };
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [user, activeTab]);

  if (!user) {
    return h('div', { className: 'office-workspace-error-fallback' },
      h('p', null, 'Loading active workspace profile session...'),
      h('button', {
        className: 'ow-error-logout-btn',
        onClick: () => setUser && setUser(null)
      }, 'Return to Login')
    );
  }

  const navItem = (key, label, count) => h('button', {
    className: `ow-side-item ${activeTab === key ? 'ow-side-item--active' : ''}`,
    onClick: () => setActiveTab(key)
  },
    h('span', { className: 'ow-side-item-label' }, label),
    count > 0 && h('span', { className: 'ow-tab-badge' }, count > 9 ? '9+' : count)
  );

  return h('div', { className: 'office-workspace-root' },
    h('aside', { className: 'ow-sidebar' },
      h('div', { className: 'ow-side-brand' },
        h('img', { src: libraryLogo, alt: 'Library logo', className: 'ow-side-logo' }),
        h('div', null,
          h('div', { className: 'ow-side-title' }, 'EGI Library'),
          h('div', { className: 'ow-side-sub' }, 'User workspace')
        ),
        h(NotificationBar, { user, inline: true })
      ),

      h('nav', { className: 'ow-side-nav' },
        navItem('library', 'Library Interface', 0),
        navItem('myrequests', 'My Requests', myPendingCount)
      ),

      h('div', { className: 'ow-side-footer' },
        h('div', { className: 'ow-side-avatar' }, (user.username || 'U').charAt(0).toUpperCase()),
        h('div', null,
          h('div', { className: 'ow-side-username' }, user.username),
          h('div', { className: 'ow-side-userrole' }, user.role)
        )
      )
    ),

    h('div', { className: 'ow-content' },
      activeTab === 'library' && h(LibraryDashboard, { user: user, setUser: setUser }),
      activeTab === 'myrequests' && h(MyRequests, { user: user })
    )
  );
}

export default UserWorkspace;
