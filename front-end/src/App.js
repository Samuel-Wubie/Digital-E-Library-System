import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import { useSessionManager } from './components/UseSessionManager';
import SessionExpiredModal from './components/SessionExpiredModal';

// Component Imports cleanly resolved to the components subfolder
import AdminDashboard from './components/admindashboard';
import OfficeWorkspace from './components/OfficeWorkspace';
import UserWorkspace from './components/UserWorkspace';
import SignUp from './components/SignUp';
import ForgotPassword from './components/ForgotPassword';
import libraryImage from './images/liabrary.png';
import gieLogo from './logo.png';

const h = React.createElement;
import { API } from './config';

// ----------------------------------------------------------------------------
// Role routing — each audience gets its own dashboard:
//   admin / manager                          → full admin console
//   User                                     → user workspace (library +
//                                              my requests, no admin tabs)
//   Officer / Senior Officer / Dept Head ... → office workspace (library +
//                                              review queue + my requests)
// ----------------------------------------------------------------------------
// Comparison is case/whitespace-insensitive so 'admin', 'Admin', 'ADMIN',
// 'Manager', etc. all land on the right dashboard regardless of how the
// role string was typed when the account was created.
function routeForRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'admin' || r === 'administrator' || r === 'manager') return 'admin-console';
  if (r === 'user') return 'user-dashboard';
  return 'office-dashboard'; // Officer, Senior Officer, Department Head
}

// ----------------------------------------------------------------------------
// Simple login form. Split-screen layout: left half is the library image,
// right half holds the login card. React.createElement only.
// ----------------------------------------------------------------------------
function LoginScreen({ onLoginSuccess, onSwitchToSignup, onSwitchToForgotPassword }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Username and password are required');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Invalid credentials');
        setLoading(false);
        return;
      }

      onLoginSuccess(data); // { id, username, role }
    } catch (err) {
      console.error('Login error:', err);
      setError('Could not reach the server. Please check your connection and try again.');
      setLoading(false);
    }
  };

  return h('div', { className: 'login-page' },
    // Left half — library image with welcome overlay
    h('div', { className: 'login-branding' },
      h('img', { src: libraryImage, alt: 'Digital Library', className: 'login-branding-image' }),
      h('div', { className: 'login-branding-overlay' },
        h('h2', { className: 'login-branding-title' }, 'GIE Digital Library'),
        h('p', { className: 'login-branding-text' },
          'Technical reports, maps and publications — searchable, secure, and all in one place.')
      )
    ),
    // Right half — login form
    h('div', { className: 'login-form-side' },
      h('div', { className: 'login-card' },
        h('div', { className: 'login-header' },
          h('img', { src: gieLogo, alt: 'Library logo', className: 'login-logo' }),
          h('h1', { className: 'login-title' }, 'GIE Digital Library System'),
          h('p', { className: 'login-subtitle' }, 'Sign in to continue')
        ),

        error ? h('div', { className: 'login-alert' }, error) : null,

        h('form', { className: 'login-form', onSubmit: handleSubmit },
          h('div', { className: 'login-field' },
            h('label', { className: 'login-label', htmlFor: 'login-username' }, 'Username'),
            h('input', {
              id: 'login-username',
              type: 'text',
              className: 'login-input',
              placeholder: 'Enter your username',
              value: username,
              onChange: (e) => setUsername(e.target.value)
            })
          ),
          h('div', { className: 'login-field' },
            h('label', { className: 'login-label', htmlFor: 'login-password' }, 'Password'),
            h('div', { className: 'login-password-wrap' },
              h('input', {
                id: 'login-password',
                type: showPassword ? 'text' : 'password',
                className: 'login-input',
                placeholder: 'Enter your password',
                value: password,
                onChange: (e) => setPassword(e.target.value),
                autoComplete: 'current-password'
              }),
              h('button', {
                type: 'button',
                className: 'login-password-toggle',
                onClick: () => setShowPassword(s => !s),
                title: showPassword ? 'Hide password' : 'Show password'
              }, showPassword ? 'Hide' : 'Show')
            )
          ),
          h('button', {
            type: 'submit',
            className: 'login-submit-btn',
            disabled: loading
          }, loading ? 'Signing in...' : 'Sign in')
        ),

        h('div', { className: 'login-footer' },
          h('button', { type: 'button', className: 'login-link-btn', onClick: onSwitchToForgotPassword },
            'Forgot password?'
          ),
          h('span', { className: 'login-footer-divider' }, '\u00b7'),
          h('button', { type: 'button', className: 'login-link-btn', onClick: onSwitchToSignup },
            'Create an account'
          )
        )
      )
    )
  );
}

// ----------------------------------------------------------------------------
// App — top-level view switcher. view is one of:
//   'login' | 'signup' | 'forgot-password' | 'admin-console' | 'office-dashboard'
// Persists the logged-in user to localStorage so a page refresh doesn't
// force a re-login, matching the localStorage.removeItem('user') already
// used in Dashboard.js's logout handler.
// ----------------------------------------------------------------------------
export default function App() {
  const [view, setView] = useState('login');
  const [user, setUser] = useState(null);

  // Restore session on load, if one exists.
  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      try {
        const parsedUser = JSON.parse(stored);
        setUser(parsedUser);
        setView(routeForRole(parsedUser.role));
      } catch (err) {
        console.error('Failed to parse stored user, clearing it:', err);
        localStorage.removeItem('user');
      }
    }
  }, []);

  // Session management for ALL roles: idle auto-logout + heartbeat +
  // admin force-logout, active whenever anyone is logged in. When the
  // session ends, a centered "Session Expired" dialog is shown over the
  // login screen (sessionExpired holds the reason: 'idle' | 'forced').
  const [sessionExpired, setSessionExpired] = useState(null);
  const handleSessionEnd = useCallback((reason) => {
    setUser(null);
    localStorage.removeItem('user');
    setView('login');
    setSessionExpired(reason || 'idle');
  }, []);
  useSessionManager(user, handleSessionEnd);

  const handleLoginSuccess = (loggedInUser) => {
    setSessionExpired(null);
    setUser(loggedInUser);
    localStorage.setItem('user', JSON.stringify(loggedInUser));
    setView(routeForRole(loggedInUser.role));
  };

  const handleSignupSuccess = () => {
    setView('login');
  };

  const handleResetSuccess = () => {
    setView('login');
  };

  // Watch for changes and clear storage when logging out
  useEffect(() => {
    if (user === null && view !== 'login' && view !== 'signup' && view !== 'forgot-password') {
      localStorage.removeItem('user');
      setView('login');
    }
  }, [user, view]);

  if (view === 'signup') {
    return h(SignUp, {
      onSignupSuccess: handleSignupSuccess,
      onSwitchToLogin: () => setView('login')
    });
  }

  if (view === 'forgot-password') {
    return h(ForgotPassword, {
      onResetSuccess: handleResetSuccess,
      onSwitchToLogin: () => setView('login')
    });
  }

  // Admin console: admin/manager only — they are not makers, so no bell.
  if (view === 'admin-console' && user) {
    return h(AdminDashboard, { user, setUser });
  }

  // Office workspace mounts the bell inside its own tab bar, next to the
  // "Office Dashboard Review" tab — no floating copy needed here.
  if (view === 'office-dashboard' && user) {
    return h(OfficeWorkspace, { user, setUser });
  }

  // User workspace: library + My Requests, bell inline in its tab bar.
  if (view === 'user-dashboard' && user) {
    return h(UserWorkspace, { user, setUser });
  }

  // Default: login screen (with the Session Expired dialog on top when the
  // previous session timed out or was ended by an administrator).
  return h(React.Fragment, null,
    sessionExpired && h(SessionExpiredModal, {
      reason: sessionExpired,
      onLogin: () => setSessionExpired(null)
    }),
    h(LoginScreen, {
      onLoginSuccess: handleLoginSuccess,
      onSwitchToSignup: () => setView('signup'),
      onSwitchToForgotPassword: () => setView('forgot-password')
    })
  );
}