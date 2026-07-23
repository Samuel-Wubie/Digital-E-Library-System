import React, { useState, useEffect } from 'react';
import './OfficeWorkspace.css';
import LibraryDashboard from './Dashboard';
import OfficeDashboard from './OfficeDashboard';
import NotificationBar from './NotificationBar';
import MyRequests, { PENDING_STAGES } from './MyRequests';
import libraryLogo from '../logo.png';

const h = React.createElement;
import { API } from '../config';

const ROLE_TO_STAGE = {
  'Officer': 'officer',
  'Senior Officer': 'senior_officer',
  'Department Head': 'authorizer',
};

// ----------------------------------------------------------------------------
// OfficeWorkspace — admin-console-style vertical sidebar for Officer,
// Senior Officer and Department Head. Nav items are listed down the left:
// Library Interface, Office Dashboard Review (red badge = requests from
// others awaiting MY acceptance) and My Requests (red badge = MY requests
// still out for acceptance). Both counts refresh every 15s.
// ----------------------------------------------------------------------------
function OfficeWorkspace({ user, setUser }) {
  const [activeTab, setActiveTab] = useState('library'); // 'library' | 'office' | 'myrequests'
  const [reviewCount, setReviewCount] = useState(0);
  const [myPendingCount, setMyPendingCount] = useState(0);

  const myStage = ROLE_TO_STAGE[user?.role];

  useEffect(() => {
    if (!user?.id) return;
    const refresh = () => {
      // Requests from others sitting at MY review stage.
      if (myStage) {
        fetch(`${API}/api/office-requests?stage=${myStage}`)
          .then(r => r.json())
          .then(data => setReviewCount(
            (Array.isArray(data) ? data : []).filter(r =>
              String(r.makerId) !== String(user.id) &&
              (!r.assignedReviewerId || String(r.assignedReviewerId) === String(user.id))
            ).length
          ))
          .catch(() => {});
      }
      // MY requests still waiting for someone's acceptance.
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
  }, [user, myStage, activeTab]);

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

  const badge = (count) => count > 0
    ? h('span', { className: 'ow-tab-badge' }, count > 9 ? '9+' : count)
    : null;

  const navItem = (key, label, count) => h('button', {
    className: `ow-side-item ${activeTab === key ? 'ow-side-item--active' : ''}`,
    onClick: () => setActiveTab(key)
  },
    h('span', { className: 'ow-side-item-label' }, label),
    badge(count)
  );

  return h('div', { className: 'office-workspace-root' },
    h('aside', { className: 'ow-sidebar' },
      h('div', { className: 'ow-side-brand' },
        h('img', { src: libraryLogo, alt: 'Library logo', className: 'ow-side-logo' }),
        h('div', null,
          h('div', { className: 'ow-side-title' }, 'GIE Library'),
          h('div', { className: 'ow-side-sub' }, 'Office workspace')
        ),
        // Bell renders only for maker roles (Officer, Senior Officer);
        // Department Head sees nothing here.
        h(NotificationBar, { user, inline: true })
      ),

      h('nav', { className: 'ow-side-nav' },
        navItem('library', 'Library Interface', 0),
        navItem('office', 'Office Dashboard Review', reviewCount),
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
      activeTab === 'office' && h(OfficeDashboard, { currentUser: user }),
      activeTab === 'myrequests' && h(MyRequests, { user: user })
    )
  );
}

export default OfficeWorkspace;
