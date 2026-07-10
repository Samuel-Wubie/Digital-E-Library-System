import React, { useState, useEffect } from 'react';
import './App.css';

// Component Imports cleanly resolved to the components subfolder
import AdminDashboard from './components/admindashboard';
import OfficeWorkspace from './components/OfficeWorkspace';
import SignUp from './components/SignUp';
import ForgotPassword from './components/ForgotPassword';

const h = React.createElement;
const API = "http://localhost:5000";

// ----------------------------------------------------------------------------
// Roles that get the full admin console (AdminDashboard, which itself opens
// on the Library tab first). Every other role is routed to the standalone
// Office Dashboard reviewer screen instead — no admin sidebar, no
// Users/Access control/Audit log tabs, per the integration requirement.
// ----------------------------------------------------------------------------
const ADMIN_CONSOLE_ROLES = ['User', 'admin', 'manager'];

function routeForRole(role) {
  return ADMIN_CONSOLE_ROLES.includes(role) ? 'admin-console' : 'office-dashboard';
}

// ----------------------------------------------------------------------------
// Simple login form. Built fresh since no login screen existed yet in this
// codebase — SignUp.js and ForgotPassword.js were already built as
// standalone screens, but nothing rendered them or decided what to show
// before/after them. This component is also React.createElement only.
// ----------------------------------------------------------------------------
function LoginScreen({ onLoginSuccess, onSwitchToSignup, onSwitchToForgotPassword }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
    h('div', { className: 'login-card' },
      h('div', { className: 'login-header' },
        h('div', { className: 'login-logo' }, 'G'),
        h('h1', { className: 'login-title' }, 'GIE / EGI Library System'),
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
          h('input', {
            id: 'login-password',
            type: 'password',
            className: 'login-input',
            placeholder: 'Enter your password',
            value: password,
            onChange: (e) => setPassword(e.target.value),
            autoComplete: 'current-password'
          })
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

  const handleLoginSuccess = (loggedInUser) => {
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

  if (view === 'admin-console' && user) {
    return h(AdminDashboard, { user, setUser });
  }

  if (view === 'office-dashboard' && user) {
    return h(OfficeWorkspace, { user, setUser });
  }

  // Default: login screen.
  return h(LoginScreen, {
    onLoginSuccess: handleLoginSuccess,
    onSwitchToSignup: () => setView('signup'),
    onSwitchToForgotPassword: () => setView('forgot-password')
  });
}