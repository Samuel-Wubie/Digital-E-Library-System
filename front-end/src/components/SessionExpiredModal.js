import React from 'react';
import './SessionExpiredModal.css';

const h = React.createElement;

// ----------------------------------------------------------------------------
// SessionExpiredModal — centered dialog shown when the session ends
// (idle timeout or ended by an administrator). Styled after classic
// banking-system session dialogs: title bar, warning line, Login / Exit.
// ----------------------------------------------------------------------------
export default function SessionExpiredModal({ reason, onLogin }) {
  const message = reason === 'forced'
    ? 'YOUR SESSION WAS ENDED BY AN ADMINISTRATOR. PLEASE LOGIN AGAIN.'
    : 'SESSION TIME OUT. PLEASE LOGIN AGAIN.';

  const handleExit = () => {
    window.close();
    // Browsers usually block window.close() for user-opened tabs —
    // fall back to the login screen.
    onLogin();
  };

  return h('div', { className: 'sem-overlay' },
    h('div', { className: 'sem-dialog', role: 'alertdialog', 'aria-modal': true },
      h('div', { className: 'sem-titlebar' }, 'Session Expired'),
      h('div', { className: 'sem-body' },
        h('div', { className: 'sem-heading' }, 'Session Expired'),
        h('div', { className: 'sem-message' },
          h('span', { className: 'sem-icon' }, '!'),
          message
        ),
        h('div', { className: 'sem-actions' },
          h('button', { className: 'sem-btn', onClick: onLogin, autoFocus: true }, 'Login'),
          h('button', { className: 'sem-btn', onClick: handleExit }, 'Exit')
        )
      )
    )
  );
}
