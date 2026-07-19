import React, { useState } from 'react';
import './ForgotPassword.css';
import libraryLogo from '../logo.png';

const h = React.createElement;
import { API } from '../config';

// Simplified in-app password reset — no email sending, no token, no expiry.
// Step 1: verify the account by username (email optional extra check).
// Step 2: set a new password directly for that account.
//
// NOTE ON SECURITY: this is intentionally weaker than a real token-based
// email reset. Anyone who knows a valid username (and, if set, the matching
// email) can reset that account's password through this flow. That's an
// accepted tradeoff for a simple internal tool, but it should not be used
// as-is for anything holding sensitive data without adding a real
// verification step (e.g. emailing a one-time code) first.
const ForgotPassword = ({ onResetSuccess, onSwitchToLogin }) => {
  const [step, setStep] = useState('verify'); // 'verify' | 'reset'
  const [verifiedUser, setVerifiedUser] = useState(null);

  const [verifyData, setVerifyData] = useState({ username: '', email: '' });
  const [resetData, setResetData] = useState({ newPassword: '', confirmPassword: '' });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const updateVerifyField = (field) => (e) => {
    setVerifyData(prev => ({ ...prev, [field]: e.target.value }));
    setError('');
  };

  const updateResetField = (field) => (e) => {
    setResetData(prev => ({ ...prev, [field]: e.target.value }));
    setError('');
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');

    if (!verifyData.username.trim()) {
      setError("Username is required");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/verify-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: verifyData.username.trim(),
          email: verifyData.email.trim() || null
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Could not verify that account.");
        setLoading(false);
        return;
      }

      setVerifiedUser(data);
      setStep('reset');
      setLoading(false);
    } catch (err) {
      console.error("Verify account error:", err);
      setError("Could not reach the server. Please check your connection and try again.");
      setLoading(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');

    if (!resetData.newPassword) {
      setError("New password is required");
      return;
    }
    if (resetData.newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (resetData.newPassword !== resetData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: verifiedUser.id,
          newPassword: resetData.newPassword
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Could not reset the password. Please try again.");
        setLoading(false);
        return;
      }

      setSuccess("Password updated. You can now log in with your new password.");
      setLoading(false);
      if (onResetSuccess) onResetSuccess(verifiedUser);
    } catch (err) {
      console.error("Reset password error:", err);
      setError("Could not reach the server. Please check your connection and try again.");
      setLoading(false);
    }
  };

  // --- Render helpers (no JSX — everything below is React.createElement) ---

  const renderAlert = () => {
    if (error) return h('div', { className: 'fp-alert fp-alert--error' }, error);
    if (success) return h('div', { className: 'fp-alert fp-alert--success' }, success);
    return null;
  };

  const renderVerifyStep = () => h('form', { className: 'fp-form', onSubmit: handleVerify },
    h('div', { className: 'fp-field' },
      h('label', { className: 'fp-label', htmlFor: 'fp-username' },
        'Username', h('span', { className: 'fp-required' }, ' *')
      ),
      h('input', {
        id: 'fp-username',
        type: 'text',
        className: 'fp-input',
        placeholder: 'Enter your username',
        value: verifyData.username,
        onChange: updateVerifyField('username')
      })
    ),
    h('div', { className: 'fp-field' },
      h('label', { className: 'fp-label', htmlFor: 'fp-email' }, 'Email (optional)'),
      h('input', {
        id: 'fp-email',
        type: 'email',
        className: 'fp-input',
        placeholder: 'Adds an extra check, if you have one on file',
        value: verifyData.email,
        onChange: updateVerifyField('email')
      })
    ),
    h('button', {
      type: 'submit',
      className: 'fp-submit-btn',
      disabled: loading
    }, loading ? 'Checking...' : 'Continue')
  );

  const renderResetStep = () => h('form', { className: 'fp-form', onSubmit: handleReset },
    h('div', { className: 'fp-verified-banner' },
      h('span', { className: 'fp-verified-check' }, '\u2713'),
      h('span', null, 'Account verified: ', h('strong', null, verifiedUser?.username))
    ),
    h('div', { className: 'fp-field' },
      h('label', { className: 'fp-label', htmlFor: 'fp-new-password' },
        'New password', h('span', { className: 'fp-required' }, ' *')
      ),
      h('input', {
        id: 'fp-new-password',
        type: 'password',
        className: 'fp-input',
        placeholder: 'At least 8 characters',
        value: resetData.newPassword,
        onChange: updateResetField('newPassword'),
        autoComplete: 'new-password'
      })
    ),
    h('div', { className: 'fp-field' },
      h('label', { className: 'fp-label', htmlFor: 'fp-confirm-password' },
        'Confirm new password', h('span', { className: 'fp-required' }, ' *')
      ),
      h('input', {
        id: 'fp-confirm-password',
        type: 'password',
        className: 'fp-input',
        placeholder: 'Re-enter your new password',
        value: resetData.confirmPassword,
        onChange: updateResetField('confirmPassword'),
        autoComplete: 'new-password'
      })
    ),
    h('button', {
      type: 'submit',
      className: 'fp-submit-btn',
      disabled: loading
    }, loading ? 'Updating...' : 'Set new password')
  );

  return h('div', { className: 'fp-page' },
    h('div', { className: 'fp-card' },
      h('div', { className: 'fp-header' },
        h('img', { src: libraryLogo, alt: 'Library logo', className: 'fp-logo' }),
        h('h1', { className: 'fp-title' }, step === 'verify' ? 'Reset your password' : 'Choose a new password'),
        h('p', { className: 'fp-subtitle' },
          step === 'verify'
            ? 'Enter your username to get started. No email will be sent.'
            : 'Pick a new password for your account.'
        )
      ),

      renderAlert(),

      step === 'verify' ? renderVerifyStep() : renderResetStep(),

      h('div', { className: 'fp-footer' },
        h('button', {
          type: 'button',
          className: 'fp-link-btn',
          onClick: onSwitchToLogin
        }, '\u2190 Back to login')
      )
    )
  );
};

export default ForgotPassword;