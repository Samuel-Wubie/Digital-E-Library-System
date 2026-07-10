import React, { useState } from 'react';
import './SignUp.css';

const h = React.createElement;
const API = "http://localhost:5000";

// Public self-registration page. Anyone can reach this without logging in.
// The role is always forced to 'User' server-side — this form never sends
// or lets the visitor choose a role, since that decision is intentionally
// not trusted to the client (see /api/auth/signup on the server).
const SignUp = ({ onSignupSuccess, onSwitchToLogin }) => {
  const [formData, setFormData] = useState({
    fullName: '', username: '', email: '', password: '', confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const updateField = (field) => (e) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
    setError('');
  };

  const validate = () => {
    if (!formData.fullName.trim()) return "Full name is required";
    if (!formData.username.trim()) return "Username is required";
    if (formData.username.trim().length < 3) return "Username must be at least 3 characters";
    if (!formData.password) return "Password is required";
    if (formData.password.length < 8) return "Password must be at least 8 characters";
    if (formData.password !== formData.confirmPassword) return "Passwords do not match";
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      return "Please enter a valid email address";
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: formData.fullName.trim(),
          username: formData.username.trim(),
          email: formData.email.trim() || null,
          password: formData.password
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      setSuccess("Account created successfully. You can now log in.");
      setLoading(false);
      if (onSignupSuccess) onSignupSuccess(data);
    } catch (err) {
      console.error("Signup error:", err);
      setError("Could not reach the server. Please check your connection and try again.");
      setLoading(false);
    }
  };

  // --- Render helpers (no JSX — everything below is React.createElement) ---

  const renderField = (label, field, type = 'text', placeholder = '', required = true) =>
    h('div', { className: 'signup-field' },
      h('label', { className: 'signup-label', htmlFor: `signup-${field}` },
        label,
        required ? h('span', { className: 'signup-required' }, ' *') : null
      ),
      h('input', {
        id: `signup-${field}`,
        type,
        className: 'signup-input',
        placeholder,
        value: formData[field],
        onChange: updateField(field),
        autoComplete: type === 'password' ? 'new-password' : 'off'
      })
    );

  const renderAlert = () => {
    if (error) return h('div', { className: 'signup-alert signup-alert--error' }, error);
    if (success) return h('div', { className: 'signup-alert signup-alert--success' }, success);
    return null;
  };

  return h('div', { className: 'signup-page' },
    h('div', { className: 'signup-card' },
      h('div', { className: 'signup-header' },
        h('div', { className: 'signup-logo' }, 'G'),
        h('h1', { className: 'signup-title' }, 'Create your account'),
        h('p', { className: 'signup-subtitle' }, 'Sign up to access the GIE / EGI Library system')
      ),

      renderAlert(),

      h('form', { className: 'signup-form', onSubmit: handleSubmit },
        renderField('Full name', 'fullName', 'text', 'Your full name'),
        renderField('Username', 'username', 'text', 'Choose a username'),
        renderField('Email', 'email', 'email', 'you@example.com (optional)', false),
        renderField('Password', 'password', 'password', 'At least 8 characters'),
        renderField('Confirm password', 'confirmPassword', 'password', 'Re-enter your password'),

        h('button', {
          type: 'submit',
          className: 'signup-submit-btn',
          disabled: loading
        }, loading ? 'Creating account...' : 'Create account')
      ),

      h('div', { className: 'signup-footer' },
        h('span', null, 'Already have an account? '),
        h('button', {
          type: 'button',
          className: 'signup-link-btn',
          onClick: onSwitchToLogin
        }, 'Log in')
      )
    )
  );
};

export default SignUp;