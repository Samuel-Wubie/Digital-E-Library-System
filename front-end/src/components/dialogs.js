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

// ----------------------------------------------------------------------------
// PAYMENT
//
// DEMO. Confirming here marks the download paid — nothing is checked against
// telebirr or CBE. The banner says so plainly, because a payment screen that
// looks real but isn't is the kind of thing people act on.
// ----------------------------------------------------------------------------
// What each gateway asks the payer for. Keeping the wording per-gateway
// matters: a telebirr user expects "phone number", a CBE user expects
// "account number", and asking the wrong one is the fastest way to make a
// demo feel fake.
const GATEWAY_FIELDS = {
  telebirr: {
    accountLabel: 'telebirr phone number',
    accountHint: 'The number registered with telebirr',
    accountPlaceholder: '09xxxxxxxx',
    pinLabel: 'telebirr PIN',
    pinHint: 'The PIN you use to approve a telebirr payment',
  },
  cbe: {
    accountLabel: 'CBE account number',
    accountHint: 'Your Commercial Bank of Ethiopia account',
    accountPlaceholder: '1000xxxxxxxxx',
    pinLabel: 'CBE Birr password',
    pinHint: 'The password you use for CBE Birr',
  },
};

const fieldsFor = (key) => GATEWAY_FIELDS[key] || {
  accountLabel: 'Account number',
  accountHint: 'The account this payment comes from',
  accountPlaceholder: '',
  pinLabel: 'Password',
  pinHint: 'The password for that account',
};

// Three steps, in the order a real payment happens: choose the method, give
// the account it comes from, then approve it. Everything is required — the
// point of the demo is to walk the whole flow, so an empty field stops you and
// says which one, rather than failing at the end with "Payment failed".
//
// THE PIN NEVER LEAVES THE BROWSER. It is checked for "not empty" here and
// then discarded; it is not sent to the server and not stored anywhere. A demo
// that collects a real credential and keeps it is worse than no demo.
function PaymentDialogUI({ title, book, pageCount, feePerPage, totalFee, methods, close }) {
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState('');
  const [account, setAccount] = useState('');
  const [pin, setPin] = useState('');
  const [reference, setReference] = useState('');
  const [problem, setProblem] = useState('');

  const f = fieldsFor(method);
  const money = (v) => `ETB ${Number(v || 0).toFixed(2)}`;
  const methodLabel = (methods.find(m => m.key === method) || {}).label || method;

  const next = () => {
    setProblem('');
    if (step === 1) {
      if (!method) { setProblem('Choose how you want to pay.'); return; }
      setStep(2); return;
    }
    if (step === 2) {
      if (!account.trim()) { setProblem(`Enter your ${f.accountLabel}.`); return; }
      setStep(3); return;
    }
    if (step === 3) {
      if (!pin.trim()) { setProblem(`Enter your ${f.pinLabel} to approve the payment.`); return; }
      // Every field is filled, so hand the payment to the caller. The receipt
      // is NOT shown here: it is a separate dialog the caller opens only after
      // the server has actually recorded the payment. Showing it from inside
      // this dialog meant "Payment successful" appeared before anything was
      // saved, and a failing checkout then contradicted it.
      close({ gateway: method, reference: reference.trim(), payerAccount: account.trim() });
    }
  };

  const back = () => { setProblem(''); setStep(st => Math.max(1, st - 1)); };

  // --- the three steps -------------------------------------------------
  return (
    <div className="sem-overlay">
      <div className="sem-dialog pay-dialog" role="alertdialog" aria-modal={true}>
        <div className="sem-titlebar">{title}</div>
        <div className="sem-body">
          <div className="pay-steps" aria-hidden="true">
            {[1, 2, 3].map(n => (
              <span key={n} className={`pay-step ${step === n ? 'pay-step--on' : ''} ${step > n ? 'pay-step--done' : ''}`}>
                {step > n ? '✓' : n}
              </span>
            ))}
            <span className="pay-step-label">
              {step === 1 ? 'Choose a method' : step === 2 ? `Your ${f.accountLabel}` : 'Approve the payment'}
            </span>
          </div>

          <div className="pay-doc">{book}</div>

          {step === 1 && (
            <>
              <div className="pay-breakdown">
                <div><span>Pages</span><span>{pageCount}</span></div>
                <div><span>Price per page</span><span>{money(feePerPage)}</span></div>
                <div className="pay-total"><span>Total</span><span>{money(totalFee)}</span></div>
              </div>
              <div className="pay-label">Pay with</div>
              <div className="pay-methods">
                {methods.map(m => (
                  <button key={m.key} type="button"
                    className={`pay-method ${method === m.key ? 'pay-method--on' : ''}`}
                    onClick={() => { setMethod(m.key); setProblem(''); }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <label className="pay-ref">
                <span>{f.accountLabel}</span>
                <input
                  value={account}
                  autoFocus
                  inputMode="numeric"
                  onChange={e => { setAccount(e.target.value); setProblem(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') next(); }}
                  placeholder={f.accountPlaceholder}
                  maxLength={40}
                />
                <em className="pay-hint">{f.accountHint}</em>
              </label>
              <label className="pay-ref">
                <span>Transaction number <em>(optional)</em></span>
                <input
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="e.g. CH2408XYZ12"
                  maxLength={80}
                />
                <em className="pay-hint">Kept with the record so finance can match the payment later.</em>
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <div className="pay-confirm">
                Paying <strong>{money(totalFee)}</strong> from <strong>{account.trim()}</strong> via {methodLabel}.
              </div>
              <label className="pay-ref">
                <span>{f.pinLabel}</span>
                <input
                  type="password"
                  value={pin}
                  autoFocus
                  autoComplete="off"
                  onChange={e => { setPin(e.target.value); setProblem(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') next(); }}
                  placeholder="••••"
                  maxLength={20}
                />
                <em className="pay-hint">{f.pinHint}. Not sent anywhere and not stored.</em>
              </label>
            </>
          )}

          {problem && <div className="pay-problem">{problem}</div>}

          <div className="pay-demo">
            Demo payment — no money is taken and nothing is checked with
            telebirr or CBE. The amount is recorded for reporting.
          </div>

          <div className="sem-actions">
            <button className="sem-btn" onClick={next}>
              {step === 3 ? 'Pay now' : 'Continue'}
            </button>
            {step > 1 && (
              <button className="sem-btn sem-btn--secondary" onClick={back}>Back</button>
            )}
            <button className="sem-btn sem-btn--secondary" onClick={() => close(null)}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Resolves to { gateway, reference, payerAccount } once the payer has gone
// through all three steps, or null if they cancelled.
export function askPayment({ title = 'Payment', book, pageCount, feePerPage, totalFee, methods }) {
  return openDialog(close => (
    <PaymentDialogUI title={title} book={book} pageCount={pageCount}
      feePerPage={feePerPage} totalFee={totalFee} methods={methods || []} close={close} />
  ));
}

// Shown AFTER the server has recorded the payment, never before. Resolves when
// the payer is ready for the file.
function PaymentReceiptUI({ book, pageCount, feePerPage, totalFee, methodLabel, account, close }) {
  const money = (v) => `ETB ${Number(v || 0).toFixed(2)}`;
  return (
    <div className="sem-overlay">
      <div className="sem-dialog pay-dialog" role="alertdialog" aria-modal={true}>
        <div className="sem-titlebar">Payment successful</div>
        <div className="sem-body">
          <div className="pay-ok">
            <div className="pay-ok-mark" aria-hidden="true">&#10003;</div>
            <div className="pay-ok-amount">{money(totalFee)} paid</div>
            <div className="pay-ok-sub">{methodLabel}{account ? ` \u00b7 ${account}` : ''}</div>
          </div>
          <div className="pay-breakdown">
            <div><span>Document</span><span>{book}</span></div>
            <div><span>Pages</span><span>{pageCount}</span></div>
            <div><span>Price per page</span><span>{money(feePerPage)}</span></div>
            <div className="pay-total"><span>Total paid</span><span>{money(totalFee)}</span></div>
          </div>
          <div className="pay-demo">
            Demo payment — no money was taken and nothing was checked with
            telebirr or CBE. The amount is recorded for the download report.
          </div>
          <div className="sem-actions">
            <button className="sem-btn" onClick={() => close(true)}>Download the document</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function showPaymentReceipt(props) {
  return openDialog(close => <PaymentReceiptUI {...props} close={close} />);
}
