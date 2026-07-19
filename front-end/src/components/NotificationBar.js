import React, { useState, useEffect, useCallback, useRef } from 'react';
import './NotificationBar.css';

const h = React.createElement;
import { API } from '../config';

// Roles that submit requests (makers) and therefore get the notification
// bar. Department Head is the final authorizer — never a maker — and
// admin/manager have their own console, so they are excluded.
const MAKER_ROLES = ['User', 'Officer', 'Senior Officer'];

// ----------------------------------------------------------------------------
// NotificationBar — floating bell + dropdown, mounted once in App.js for any
// logged-in maker. Polls /api/notifications every 15s and shows:
//   - stage updates ("passed the Officer review, now with the Senior Officer")
//   - completion ("all approvals are complete — you can now download / your
//     record was added / updated / deleted")
//   - rejections (outcome only, never the reviewer's reason)
// ----------------------------------------------------------------------------
// `inline` renders the bell in normal page flow (e.g. inside the Office
// Workspace tab bar) instead of floating fixed at the top-right.
export default function NotificationBar({ user, inline = false }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  const isMaker = user && MAKER_ROLES.includes(user.role);

  const fetchNotifications = useCallback(() => {
    if (!user?.id) return;
    fetch(`${API}/api/notifications?userId=${user.id}`)
      .then(res => res.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!isMaker) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [isMaker, fetchNotifications]);

  // Close the panel when clicking anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!isMaker) return null;

  const unread = items.filter(n => !n.is_read);

  const markRead = async (n) => {
    if (n.is_read) return;
    try {
      await fetch(`${API}/api/notifications/${n.id}/read`, { method: 'PUT' });
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
    } catch (err) { /* retry next poll */ }
  };

  const markAllRead = () => { unread.forEach(markRead); };

  const toneFor = (n) => {
    const t = (n.title || '').toLowerCase();
    if (t.includes('reject')) return 'nb-item--rejected';
    if (t.includes('accept') || t.includes('approve')) return 'nb-item--accepted';
    return 'nb-item--info';
  };

  return h('div', { className: `nb-root ${inline ? 'nb-root--inline' : ''}`, ref: panelRef },
    h('button', {
      className: 'nb-bell',
      title: 'My request notifications',
      onClick: () => setOpen(o => !o)
    },
      '🔔',
      unread.length > 0 && h('span', { className: 'nb-badge' }, unread.length > 9 ? '9+' : unread.length)
    ),

    open && h('div', { className: 'nb-panel' },
      h('div', { className: 'nb-panel-header' },
        h('span', { className: 'nb-panel-title' }, 'My requests'),
        unread.length > 0 && h('button', { className: 'nb-mark-all', onClick: markAllRead }, 'Mark all read')
      ),
      h('div', { className: 'nb-list' },
        items.length === 0
          ? h('div', { className: 'nb-empty' }, 'No notifications yet. Updates about your add, edit, delete and download requests will appear here.')
          : items.map(n => h('div', {
              key: n.id,
              className: `nb-item ${toneFor(n)} ${n.is_read ? '' : 'nb-item--unread'}`,
              onClick: () => markRead(n)
            },
              h('div', { className: 'nb-item-title' }, n.title),
              h('div', { className: 'nb-item-message' }, n.message),
              h('div', { className: 'nb-item-time' }, n.created_at ? new Date(n.created_at).toLocaleString() : '')
            ))
      )
    )
  );
}
