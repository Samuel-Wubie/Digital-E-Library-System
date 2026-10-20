import React, { useState, useEffect } from 'react';
import './OfficeWorkspace.css';
import LibraryDashboard from './Dashboard';
import NotificationBar from './NotificationBar';
import MyRequests, { PENDING_STAGES } from './MyRequests';
import Help from './Help';
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
  const [allowance, setAllowance] = useState(null);

  // How many self-service downloads are left this month. Refreshed whenever
  // the tab changes, so it is current after a download without a page reload.
  useEffect(() => {
    if (!user?.id) return;
    fetch(`${API}/api/downloads/allowance?userId=${user.id}`)
      .then(r => r.json())
      .then(d => setAllowance(d && d.applies ? d : null))
      .catch(() => {});
  }, [user, activeTab]);

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
          h('div', { className: 'ow-side-title' }, 'GIE Library'),
          h('div', { className: 'ow-side-sub' }, 'User workspace')
        ),
        h(NotificationBar, { user, inline: true })
      ),

      h('nav', { className: 'ow-side-nav' },
        navItem('library', 'Library Interface', 0),
        navItem('myrequests', 'My Requests', myPendingCount),
        navItem('help', 'Help & Manual', 0)
      ),

      allowance && h('div', { className: 'ow-allowance' },
        h('div', { className: 'ow-allowance-label' }, 'Downloads this month'),
        h('div', { className: 'ow-allowance-value' },
          `${allowance.remaining} of ${allowance.limit} left`
        ),
        h('div', { className: 'ow-allowance-bar' },
          h('div', {
            className: 'ow-allowance-fill',
            style: { width: `${allowance.limit ? (allowance.used / allowance.limit) * 100 : 0}%` }
          })
        ),
        h('div', { className: 'ow-allowance-note' },
          allowance.remaining > 0
            ? 'Pay the page fee and download straight away.'
            : 'Further downloads need an officer to authorise them.'
        )
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
      activeTab === 'myrequests' && h(MyRequests, { user: user }),
      activeTab === 'help' && h(Help, { role: user.role, behaviour: user.behaviour })
    )
  );
}

export default UserWorkspace;
