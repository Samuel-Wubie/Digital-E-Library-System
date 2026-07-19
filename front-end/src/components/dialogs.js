import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import './SessionExpiredModal.css';
import './dialogs.css';

// ----------------------------------------------------------------------------
// Styled replacements for window.prompt / window.confirm, matching the
// Session Expired dialog (teal title bar, warning icon, teal buttons).
//
//   const reason = await askReason({ title, message });   → string | null
//   const ok     = await askConfirm({ title, message });  → true | false
//
// They mount themselves over the page and resolve when the user acts, so
// existing async flows only need `await` in place of the old popups.
// ----------------------------------------------------------------------------

function openDialog(renderFn) {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    const close = (value) => {
      root.unmount();
      host.remove();
      resolve(value);
    };
    root.render(renderFn(close));
  });
}

function ReasonDialogUI({ title, message, placeholder, reviewers, reviewerLabel, close }) {
  const [text, setText] = useState('');
  const [reviewerId, setReviewerId] = useState('');

  const hasReviewers = Array.isArray(reviewers) && reviewers.length > 0;
  const canSubmit = text.trim() && (!hasReviewers || reviewerId);

  const submit = () => {
    if (!canSubmit) return;
    if (hasReviewers) close({ reason: text.trim(), reviewerId: reviewerId });
    else close(text.trim());
  };

  return (
    <div className="sem-overlay">
      <div className="sem-dialog" role="dialog" aria-modal={true}>
        <div className="sem-titlebar">{title}</div>
        <div className="sem-body">
          <div className="sem-heading">{title}</div>
          <div className="sem-message dlg-message">
            <span className="sem-icon">!</span>
            {message}
          </div>
          {hasReviewers && (
            <div className="dlg-field">
              <label className="dlg-label">{reviewerLabel || 'Send to'}</label>
              <select
                className="dlg-select"
                value={reviewerId}
                onChange={e => setReviewerId(e.target.value)}
              >
                <option value="">— Select a person —</option>
                {reviewers.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name ? `${u.full_name} (@${u.username})` : `@${u.username}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <textarea
            className="dlg-textarea"
            rows={4}
            autoFocus
            placeholder={placeholder || 'Write your reason here...'}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
          />
          <div className="sem-actions">
            <button className="sem-btn" onClick={submit} disabled={!canSubmit}>Submit</button>
            <button className="sem-btn sem-btn--secondary" onClick={() => close(null)}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialogUI({ title, message, okLabel, cancelLabel, close }) {
  return (
    <div className="sem-overlay">
      <div className="sem-dialog" role="alertdialog" aria-modal={true}>
        <div className="sem-titlebar">{title}</div>
        <div className="sem-body">
          <div className="sem-heading">{title}</div>
          <div className="sem-message dlg-message">
            <span className="sem-icon">!</span>
            <span className="dlg-message-text">{message}</span>
          </div>
          <div className="sem-actions">
            <button className="sem-btn" autoFocus onClick={() => close(true)}>{okLabel || 'OK'}</button>
            <button className="sem-btn sem-btn--secondary" onClick={() => close(false)}>{cancelLabel || 'Cancel'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertDialogUI({ title, message, close }) {
  return (
    <div className="sem-overlay">
      <div className="sem-dialog" role="alertdialog" aria-modal={true}>
        <div className="sem-titlebar">{title}</div>
        <div className="sem-body">
          <div className="sem-heading">{title}</div>
          <div className="sem-message dlg-message">
            <span className="sem-icon">!</span>
            <span className="dlg-message-text">{message}</span>
          </div>
          <div className="sem-actions">
            <button className="sem-btn" autoFocus onClick={() => close(undefined)}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectDialogUI({ title, message, label, options, close }) {
  const [value, setValue] = useState('');
  return (
    <div className="sem-overlay">
      <div className="sem-dialog" role="dialog" aria-modal={true}>
        <div className="sem-titlebar">{title}</div>
        <div className="sem-body">
          <div className="sem-heading">{title}</div>
          <div className="sem-message dlg-message">
            <span className="sem-icon">!</span>
            <span className="dlg-message-text">{message}</span>
          </div>
          <div className="dlg-field">
            <label className="dlg-label">{label || 'Select'}</label>
            <select className="dlg-select" autoFocus value={value} onChange={e => setValue(e.target.value)}>
              <option value="">— Select a person —</option>
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="sem-actions">
            <button className="sem-btn" disabled={!value} onClick={() => close(value)}>Confirm</button>
            <button className="sem-btn sem-btn--secondary" onClick={() => close(null)}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Required single-choice picker (e.g. "forward to which Senior Officer?").
// Resolves with the chosen option's value, or null on cancel.
export function askSelect({ title = 'Select', message, label, options }) {
  return openDialog(close => (
    <SelectDialogUI title={title} message={message} label={label} options={options} close={close} />
  ));
}

// Drop-in replacement for window.alert(). Accepts a plain string or
// { title, message }. Returns a promise (awaiting it is optional).
export function showAlert(messageOrOpts) {
  const opts = typeof messageOrOpts === 'string'
    ? { title: 'Notice', message: messageOrOpts }
    : { title: 'Notice', ...messageOrOpts };
  return openDialog(close => (
    <AlertDialogUI title={opts.title} message={opts.message} close={close} />
  ));
}

// When `reviewers` (array of { id, username, full_name }) is passed, the
// dialog also shows a required "Send to" person picker and resolves with
// { reason, reviewerId } instead of a plain string.
export function askReason({ title = 'Authorization Request', message, placeholder, reviewers, reviewerLabel }) {
  return openDialog(close => (
    <ReasonDialogUI title={title} message={message} placeholder={placeholder}
      reviewers={reviewers} reviewerLabel={reviewerLabel} close={close} />
  ));
}

export function askConfirm({ title = 'Confirm', message, okLabel, cancelLabel }) {
  return openDialog(close => (
    <ConfirmDialogUI title={title} message={message} okLabel={okLabel} cancelLabel={cancelLabel} close={close} />
  ));
}
