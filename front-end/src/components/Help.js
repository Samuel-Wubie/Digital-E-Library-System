import React, { useState, useMemo } from 'react';
import './Help.css';

// ----------------------------------------------------------------------------
// USER MANUAL
//
// One component, shown in all three workspaces. Every section declares which
// audiences it belongs to, and the signed-in person's role decides what they
// see — a plain member has no business reading about the approval queue, and
// showing it anyway is how manuals get ignored.
//
// ONE LIST, NOT THREE. An earlier version kept a separate set of sections per
// audience and the shared parts drifted apart. Here a section tagged
// ['member','staff','admin'] is written once.
//
// ACCURACY IS THE WHOLE JOB. Every number and rule below was read out of the
// code rather than remembered: the allowance default, the per-page fees, the
// idle timeout, the delegation rules. If you change a rule in the system,
// change the matching step here in the same commit — a manual that has quietly
// gone wrong is worse than no manual, because people trust it.
// ----------------------------------------------------------------------------

// Which version of the manual to show. Roles are administrator-defined, so
// this goes by the role's BEHAVIOUR; the name check is only a fallback for a
// session stored before behaviours existed.
const REVIEWER_ROLES = ['Officer', 'Senior Officer', 'Department Head'];
const ADMIN_ROLES = ['admin', 'administrator', 'manager'];

function normalise(role, behaviour) {
  if (behaviour === 'administrator') return 'admin';
  if (behaviour === 'staff_maker' || behaviour === 'staff_direct') return 'staff';
  if (behaviour === 'member') return 'member';

  const r = String(role || '').trim();
  if (ADMIN_ROLES.includes(r.toLowerCase())) return 'admin';
  if (REVIEWER_ROLES.includes(r)) return 'staff';
  return 'member';
}

const ALL = ['member', 'staff', 'admin'];

// --- Content -----------------------------------------------------------------
// Each section: { title, audiences, intro?, steps: [{ heading, body, note? }] }
// `note` is for the thing people get wrong — rendered as a callout so it is
// not lost inside a paragraph.

const SECTIONS = [
  {
    title: 'Signing in',
    audiences: ALL,
    intro: 'Getting in, and what ends a session',
    steps: [
      {
        heading: 'Sign in with your username',
        body: 'Use the username your administrator created for you, not your email address. The Show link inside the password box reveals what you have typed if you want to check it before submitting.',
      },
      {
        heading: 'If you have forgotten your password',
        body: 'Use "Forgot password?" on the sign-in page. If that does not get you back in, your administrator can reset it for you from the Users screen.',
      },
      {
        heading: 'You are signed out after two minutes of inactivity',
        body: 'The system signs you out automatically after two minutes with no mouse or keyboard activity, and tells you why when it does. Reading a long document in the viewer counts as inactivity, so if you come back to a "Session expired" message, nothing has gone wrong — sign in again and carry on.',
        note: 'Two minutes is short. If your office finds it disruptive it is a single value in the code (IDLE_LIMIT_MS) your developer can raise.',
      },
      {
        heading: 'Being signed out at some other moment',
        body: 'Either an administrator ended your session from the Sessions screen, or you signed in somewhere else. Signing in again is all that is needed, and nothing you had already submitted is lost.',
      },
    ],
  },

  {
    title: 'Finding a document',
    audiences: ALL,
    intro: 'How the library is arranged, and how to reach one document',
    steps: [
      {
        heading: 'Start at the library home page',
        body: 'The cards are the main parts of the library — Technical Reports, Maps, Books, Other Publications, and anything else your administrator has added. Click one to go in.',
      },
      {
        heading: 'Each part is arranged differently',
        body: 'Technical Reports are listed by numbered topic. Maps ask for a format, then a type, then a scale. Books and Other Publications go straight to a list. The arrangement comes from Library structure, so it can change as your administrator adds to it.',
      },
      {
        heading: 'Search the topic list',
        body: 'The search box above a topic grid matches either the topic number or its name, so "001" and "Abrasives" both find the same topic.',
      },
      {
        heading: 'Filter a document list',
        body: 'Every list has filters across the top: title, author, subject, call number, department, location and year. They apply together, so setting three narrows to documents matching all three. "Reset" clears them at once.',
      },
      {
        heading: 'Preview before you commit',
        body: 'Click a document to open it in the viewer. Previewing is always free and never counts against an allowance. You only pay, or ask for authorisation, when you download a copy.',
      },
    ],
  },

  {
    title: 'How documents are classified',
    audiences: ALL,
    intro: 'Three levels, set per document',
    steps: [
      {
        heading: 'Public',
        body: 'Anyone signed in can request it under the normal rules. Most of the library is public.',
      },
      {
        heading: 'Confidential',
        body: 'Restricted material. The request is reviewed before the document is released, and the reviewer sees the classification next to your reason.',
      },
      {
        heading: 'Highly Confidential',
        body: 'The most restricted level. Be specific about why you need it — a vague reason on a highly confidential document is the commonest cause of a rejection.',
      },
      {
        heading: 'Where it comes from',
        body: 'Classification is a field on the document record, set when it is added or edited. Everything already in the library started as Public; an administrator raises individual documents from there.',
      },
    ],
  },

  {
    title: 'Your monthly allowance',
    audiences: ['member'],
    intro: 'How many documents you can take without asking anyone',
    steps: [
      {
        heading: 'What the allowance is',
        body: 'A set number of downloads each calendar month that you can take yourself — you pay the fee, but need nobody\'s approval. The panel at the bottom of the sidebar shows how many you have left.',
      },
      {
        heading: 'How many you get',
        body: 'Two per month unless your administrator has changed it. They can set any number, and setting it to zero means every download needs authorisation — a deliberate configuration, not a fault.',
      },
      {
        heading: 'When it resets',
        body: 'On the 1st of each month, counted from the start of the calendar month rather than a rolling thirty days. Unused downloads do not carry over.',
      },
      {
        heading: 'What counts against it',
        body: 'Only completed downloads. Previewing a document, opening the viewer, or having a request still waiting all cost nothing.',
      },
    ],
  },

  {
    title: 'Paying for a download',
    audiences: ['member'],
    intro: 'What you are charged, and how the payment step works',
    steps: [
      {
        heading: 'The fee is per page',
        body: 'Each part of the library has its own price per page, set by your administrator. Out of the box maps are 5 Birr a page, and technical reports, books and other publications are 2 Birr a page. A part priced at zero is free.',
      },
      {
        heading: 'What the payment box shows',
        body: 'The document title, its page count, the price per page and the total. Check the page count against what you expect before confirming — the total is simply pages times rate.',
      },
      {
        heading: 'Choose telebirr or CBE Birr',
        body: 'Pick the method you used and enter the transaction number if you have one. That number is stored with the download record, which is what lets the finance office match a payment to a document later.',
      },
      {
        heading: 'This is a demonstration payment step',
        body: 'Confirming records the download as paid. No money moves and nothing is verified against telebirr or CBE — the system takes your word for it.',
        note: 'Because nothing is verified, the amounts in the download report are what was owed, not proof it was received. Treat the report as a billing list to reconcile against your real telebirr and CBE statements.',
      },
    ],
  },

  {
    title: 'When you need authorisation',
    audiences: ['member'],
    intro: 'What happens once the allowance is used up',
    steps: [
      {
        heading: 'Download asks for a reason instead',
        body: 'Past your allowance, clicking Download opens a reason box rather than the payment box. What you write is what the officer reads when deciding, so say what you need the document for.',
      },
      {
        heading: 'You can send it to a specific person',
        body: 'If the reason box offers a reviewer list, choosing someone sends the request to them by name. It then appears only in their queue — so if they are away, pick someone else or leave it unassigned.',
      },
      {
        heading: 'Wait for the notification',
        body: 'The bell tells you when a decision is made. Clicking Download again before then just reminds you the request is still waiting; it does not create a second one.',
      },
      {
        heading: 'After it is accepted, pay and download',
        body: 'Open the same document and click Download again. This time it goes to the payment step and the file follows. The fee still applies — authorisation and payment are separate things.',
      },
      {
        heading: 'If it is rejected',
        body: 'You are told the outcome but not the reviewer\'s reason, which stays in the record for other reviewers. You can submit a fresh request with a fuller justification.',
      },
    ],
  },

  {
    title: 'Tracking what you have asked for',
    audiences: ['member', 'staff'],
    intro: 'My Requests is the record of everything you have submitted',
    steps: [
      {
        heading: 'What the list shows',
        body: 'Every request you have made, its code, the document, and which step it has reached. The code is worth quoting if you need to ask an administrator about a specific one.',
      },
      {
        heading: 'Reading the stage',
        body: 'A request moves along the approval chain one step at a time, and the stage names the step it is waiting at. "Approved" means it cleared every step; "Rejected" means it stopped at one.',
      },
      {
        heading: 'A request you no longer need',
        body: 'There is no cancel button yet. Leave it — an unused approved request does nothing on its own, and nothing is charged until you download.',
      },
    ],
  },

  {
    title: 'Reviewing requests',
    audiences: ['staff'],
    intro: 'The queue, and what each decision does',
    steps: [
      {
        heading: 'Your queue',
        body: 'Office Dashboard Review holds the requests waiting on you, and the badge beside the tab counts them. Which requests reach you is decided by Roles & workflow: a step names the people who handle it, and you see the requests sitting at any step you are named on — whatever your job title is. If a step names nobody, everyone holding its role sees it instead.',
      },
      {
        heading: 'Requests sent to you by name',
        body: 'A request addressed to you specifically appears only in your queue. Nobody else can act on it, except whoever is covering for you under a delegation.',
      },
      {
        heading: 'What you are deciding',
        body: 'Each row shows who asked, which document, the reason they gave, the document\'s classification, and the fee if there is one. The reason is the point of the step; if it does not justify the classification, that is grounds to reject.',
      },
      {
        heading: 'Accepting',
        body: 'The request moves to the next step in the chain, or to approved if yours was the last, and the person is notified. You are recorded as having accepted it.',
      },
      {
        heading: 'Rejecting needs a reason',
        body: 'The reason is required and is kept in the record for other reviewers and in the audit log. The person who asked is told their request was not approved, but not what you wrote.',
      },
      {
        heading: 'You cannot decide your own request',
        body: 'If you submitted it, the system refuses to let you accept or reject it even if you staff that step. Someone else has to.',
      },
    ],
  },

  {
    title: 'Getting documents for your own work',
    audiences: ['staff'],
    intro: 'Staff roles are never charged; which path you get depends on your role',
    steps: [
      {
        heading: 'If your role asks first',
        body: 'Click Download, give a reason, and it goes to whoever staffs the next step. Once accepted, click Download again and the file comes. You pay nothing at any point.',
      },
      {
        heading: 'If your role downloads directly',
        body: 'Download hands you the file immediately — no request, no fee. Every one is still recorded against your name in the download report, so "no approval" is not "no record".',
      },
      {
        heading: 'Which one you have',
        body: 'It is set by your role\'s behaviour in Roles & workflow, not by its name. Your administrator can tell you, or you can click Download and see which of the two happens.',
      },
    ],
  },

  {
    title: 'Going on leave: handing over your duties',
    audiences: ['staff'],
    intro: 'Cover for a fixed period, without sharing your password',
    steps: [
      {
        heading: 'Open Delegation and choose a colleague',
        body: 'Anyone but yourself. The delegation itself carries the authority, so your stand-in does not need to already hold your role.',
      },
      {
        heading: 'Set the dates',
        body: 'A delegation runs between two dates. It does nothing before the start and nothing after the end, so you never have to remember to switch it off. That is deliberate: an open-ended handover is one that quietly outlives the leave.',
      },
      {
        heading: 'Choose what to hand over',
        body: 'Tick only what the cover actually needs: Approvals (deciding on requests at your step), Add records, Edit records, Delete records, Download. "Select all" is there when you want a full handover. Handing over nothing is refused.',
      },
      {
        heading: 'You can only hand over what you hold',
        body: 'The list shows what your own role holds and nothing else. If your role cannot delete records there is no Delete box to tick — and the server refuses it too, not just the screen.',
      },
      {
        heading: 'Borrowed authority cannot be passed on',
        body: 'If someone has delegated to you, you cannot delegate that onward. Only what your own role holds is yours to give.',
      },
      {
        heading: 'Ending it early',
        body: '"End now" on the row stops it immediately. Only you, or an administrator, can end a delegation you gave; the person covering cannot extend or end it themselves. Decisions they have already made stand.',
      },
      {
        heading: 'If a responsibility stops applying',
        body: 'If an administrator removes a permission from your role while a delegation is running, that part of the handover stops working and the row says so. The rest keeps going. You can never lend a right you no longer have.',
      },
    ],
  },

  {
    title: 'Covering for a colleague',
    audiences: ['staff'],
    intro: 'What changes while you are standing in for someone',
    steps: [
      {
        heading: 'Their queue joins yours',
        body: 'Requests waiting at their step appear in Office Dashboard Review alongside your own for as long as the delegation runs. The Delegation page lists who you are covering and when it ends.',
      },
      {
        heading: 'Decisions are recorded as you, on their behalf',
        body: 'The audit log says so explicitly — "rejected at stage officer on behalf of [name]". Nothing is recorded as though they did it themselves.',
      },
      {
        heading: 'It ends on its own',
        body: 'On the end date their queue simply stops appearing. Anything still waiting goes back to them.',
      },
      {
        heading: 'Extra permissions, not a different role',
        body: 'A delegation grants permissions; it does not turn you into them. If a Department Head delegates Download to you then you can download — but at your own role\'s fees and limits, not theirs.',
      },
    ],
  },

  {
    title: 'The library structure',
    audiences: ['admin'],
    intro: 'The parts of the library and the lists inside them',
    steps: [
      {
        heading: 'What you can change',
        body: 'The cards on the library home page, and the lists inside them — report topics, map formats, types and scales, publication types. Add new entries and rename existing ones.',
      },
      {
        heading: 'Nothing here deletes',
        body: 'Use Hide to take an entry out of circulation. It stops being offered for new documents, but documents already filed under it keep working. Deleting would orphan records that may be someone\'s only copy of a survey.',
      },
      {
        heading: 'Renaming is safe',
        body: 'When you rename a report topic or a scale, every document filed under the old name is updated in the same step and the system tells you how many it moved. You do not need to re-file anything.',
      },
      {
        heading: 'Each part carries its own price',
        body: 'A category has a price per page. Set it when you create the category, or change it later under Download fees.',
      },
    ],
  },

  {
    title: 'Download fees',
    audiences: ['admin'],
    intro: 'What members are charged, per page, per part of the library',
    steps: [
      {
        heading: 'Prices are per page, per category',
        body: 'A member downloading a 40-page map at 5 Birr a page is charged 200. Staff roles are never charged, whatever the price.',
      },
      {
        heading: 'Free is a real setting',
        body: 'Zero means free and is kept as zero — it is not treated as "unset" and quietly replaced with the default. A new category created without a price gets 2 Birr a page.',
      },
      {
        heading: 'Changing a price is not retrospective',
        body: 'Past downloads keep the fee charged at the time, which is what makes the download report reconcilable months later.',
      },
    ],
  },

  {
    title: 'Access control',
    audiences: ['admin'],
    intro: 'What each role may do',
    steps: [
      {
        heading: 'Five permissions',
        body: 'View, Add, Edit, Delete and Download. Click a cell to grant or revoke it; the change saves immediately.',
      },
      {
        heading: 'Add and Edit are separate',
        body: 'A role can be allowed to file new records without being allowed to change existing ones — useful for a cataloguer who should not be able to rewrite history. They used to be one permission; every role now has Add set wherever it had Edit, which preserves the old behaviour until you choose to separate them.',
      },
      {
        heading: 'If someone says the Download button is missing',
        body: 'This is the first place to look. The button only renders for a role with Download granted.',
        note: 'These permissions decide what the screens offer, not what the server will refuse. Someone able to reach the API directly is not stopped by this matrix — see Known limitations.',
      },
      {
        heading: 'Workflow responsibility',
        body: 'The lower half says who handles each step of the approval chain. Tick the people: a step belongs to the people named on it, whatever role they hold, so you can move a step from one person to another without touching anybody\'s job title. Leave everyone unticked and the step falls back to a role, which means anyone holding that role can pick it up. A step with neither stalls every request that reaches it, so do not leave one empty.',
        note: 'Readers cannot be ticked. A member-behaviour account never sees an approval queue, so naming one would stop every request at that step — the system refuses it.',
      },
    ],
  },

  {
    title: 'Roles and the approval chain',
    audiences: ['admin'],
    intro: 'Both are editable; neither is fixed in the code any more',
    steps: [
      {
        heading: 'Behaviour is what matters, not the name',
        body: 'Every role has a behaviour, and that is what the system branches on. A role called "Archivist" does nothing predictable until you say which behaviour it has.',
      },
      {
        heading: 'The four behaviours',
        body: 'Member — browses, gets the monthly allowance, then pays and needs authorisation. Staff (asks) — requests with a reason, pays nothing, someone further along must accept. Staff (direct) — downloads immediately, no request, no fee, still recorded. Administrator — the full console.',
      },
      {
        heading: 'Adding a role',
        body: 'Give it a name and a behaviour, then grant it permissions under Access control and, if it reviews requests, assign it a step under Roles & workflow. A new role starts with nothing granted.',
      },
      {
        heading: 'Renaming a role carries everything with it',
        body: 'Accounts holding it, its workflow step, its permissions and any delegations all move to the new name in one step, and the audit log reports what moved.',
      },
      {
        heading: 'Removing a role',
        body: 'You must say which role its accounts move to. Its workflow step is switched off, its permissions row is dropped, and any live cover for it is ended — all reported back to you. The built-in roles cannot be removed, only renamed or hidden.',
      },
      {
        heading: 'Editing the chain itself',
        body: 'Steps can be added, renamed, reordered and switched off. A request already in flight keeps the chain it started with, so changing the chain does not strand anything mid-review.',
      },
    ],
  },

  {
    title: 'Users and sessions',
    audiences: ['admin'],
    intro: 'Accounts, and who is signed in right now',
    steps: [
      {
        heading: 'Creating and changing accounts',
        body: 'Create an account, set its role, and reset a password for someone locked out. Clicking a username opens that account\'s details — full name, email and what was captured at sign-up.',
      },
      {
        heading: 'Sessions',
        body: 'Everyone currently signed in, with how long they have been idle. Force logout ends a session, and they are signed out within about a minute.',
      },
    ],
  },

  {
    title: 'Reports and records',
    audiences: ['admin'],
    intro: 'Four different views of what has happened',
    steps: [
      {
        heading: 'Download report',
        body: 'Pick two dates to see every download in that period: who took it, which document, which part of the library, the specifics (a map\'s scale, a report\'s topic) and what was paid. Click a name to open that account. Export CSV gives the finance office a spreadsheet.',
      },
      {
        heading: 'What the money column means',
        body: 'It totals what was charged. Because the payment step is a demonstration, this is a list of amounts owed rather than confirmed receipts — reconcile it against your telebirr and CBE statements.',
      },
      {
        heading: 'Documents',
        body: 'The most-downloaded documents as a column chart. Each document keeps its own colour even as the ranking changes, so you can follow one over time. Documents nobody has downloaded are left out.',
      },
      {
        heading: 'Audit log',
        body: 'Every action worth recording, newest first: sign-ins, approvals and rejections with their reasons, structure and fee changes, role changes, delegations given and ended. This is the record to reach for when someone asks who did what.',
      },
      {
        heading: 'Approval queue',
        body: 'Requests currently in flight across the whole chain, so you can see where things are stuck without asking each reviewer.',
      },
    ],
  },

  {
    title: 'If something is not working',
    audiences: ALL,
    intro: 'The common ones, and what actually causes them',
    steps: [
      {
        heading: 'There is no Download button',
        body: 'Your role has not been granted Download. An administrator turns it on under Access control.',
      },
      {
        heading: 'The library page is empty',
        body: 'Either the page could not reach the server, or no categories have been set up. The message on the page says which. If it mentions restarting, tell your administrator.',
      },
      {
        heading: 'A document will not open',
        body: 'The record may have no file attached, or the file is missing from storage. Tell an administrator which document it was — the title is enough.',
      },
      {
        heading: 'A change an administrator made has not appeared',
        body: 'Most screens read their settings once when they load. Switching away and back, or reloading the page, picks up the new value.',
      },
      {
        heading: 'Nobody can act on a request',
        body: 'The step it is waiting at probably has nobody assigned — no people ticked and no role — or the only person named on it is away with no delegation. Open Roles & workflow: each step says who handles it, and an unassigned one is marked in red. Tick somebody, or set up cover under Delegation.',
      },
      {
        heading: 'A stand-in cannot do something they were given',
        body: 'Open Delegation and look at the row. If a responsibility stopped applying because the giver\'s role lost that permission, the row says so.',
      },
    ],
  },

  {
    title: 'Known limitations',
    audiences: ['admin'],
    intro: 'Worth knowing before this system holds anything sensitive',
    steps: [
      {
        heading: 'Payments are not verified',
        body: 'Confirming a payment records it as paid. Nothing is checked with telebirr or CBE, so the download report lists what was owed, not what was received.',
      },
      {
        heading: 'Permissions guard the screens, not the API',
        body: 'Access control decides what the interface offers. The download endpoints do not re-check it, so someone able to call the API directly is not stopped by it.',
      },
      {
        heading: 'There is no authentication on the API',
        body: 'Requests are not authenticated, and the password-reset and role-change endpoints can be called without signing in. Anyone who can reach the server can take an administrator account. This needs fixing before the system is exposed beyond a trusted network.',
        note: 'This is the most serious item here. Everything built on roles above assumes someone using the browser, not someone calling the server directly.',
      },
      {
        heading: 'A request cannot be withdrawn',
        body: 'Once submitted, only a reviewer can close a request by accepting or rejecting it. There is no cancel for the person who made it.',
      },
    ],
  },

  {
    title: 'Glossary',
    audiences: ALL,
    intro: 'Words this system uses in a particular way',
    steps: [
      { heading: 'Allowance', body: 'The number of downloads a member can take each calendar month without authorisation.' },
      { heading: 'Behaviour', body: 'What a role actually does — member, staff (asks), staff (direct) or administrator. Set per role, and what the system branches on rather than the role\'s name.' },
      { heading: 'Chain, step', body: 'The sequence of reviews a request passes through. Each step is staffed by the people named on it, or — if nobody is named — by everyone holding its role.' },
      { heading: 'Classification', body: 'How restricted a document is: Public, Confidential or Highly Confidential.' },
      { heading: 'Delegation', body: 'A dated handover of some or all of your responsibilities to a colleague, which ends by itself.' },
      { heading: 'Maker', body: 'Whoever submitted a request. A maker cannot decide their own request.' },
      { heading: 'Scope', body: 'One responsibility within a delegation — approvals, add, edit, delete or download.' },
      { heading: 'Taxonomy', body: 'The library\'s structure: the categories and the lists inside them.' },
    ],
  },
];

const INTRO = {
  member: 'How to find documents, what a download costs, and what to do when you need more than your monthly allowance.',
  staff: 'How to review the requests that reach you, how to get documents for your own work, and how to hand your duties over when you are away.',
  admin: 'How to run the library: its structure, its prices, its roles and chain, its people, and the records.',
};

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// --- Component ---------------------------------------------------------------

export default function Help({ role, behaviour }) {
  const kind = normalise(role, behaviour);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());

  const mine = useMemo(() => SECTIONS.filter(s => s.audiences.includes(kind)), [kind]);

  // Search matches headings AND bodies, because people search for the words in
  // their problem ("expired", "missing button"), not for the section title
  // somebody else chose.
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return mine;
    return mine
      .map(section => {
        if (section.title.toLowerCase().includes(q)) return section;
        const steps = section.steps.filter(st =>
          st.heading.toLowerCase().includes(q) ||
          st.body.toLowerCase().includes(q) ||
          (st.note || '').toLowerCase().includes(q)
        );
        return steps.length ? { ...section, steps } : null;
      })
      .filter(Boolean);
  }, [q, mine]);

  const toggle = (title) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  };

  // While searching, every match is open. Hunting through collapsed results is
  // worse than having no search at all.
  const isOpen = (title) => (q ? true : open.has(title));
  const hits = results.reduce((n, s) => n + s.steps.length, 0);

  const jumpTo = (title) => {
    setOpen(prev => new Set(prev).add(title));
    const el = document.getElementById(`help-${slug(title)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="help-root">
      <div className="help-head">
        <h2>Help &amp; user manual</h2>
        <p>{INTRO[kind]}</p>
        <span className="help-role">You are signed in as <strong>{role}</strong></span>
      </div>

      <div className="help-search">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search the manual — try allowance, rejected, leave"
          aria-label="Search the manual"
        />
        {q !== '' && (
          <span className="help-search-count">
            {hits === 0
              ? 'Nothing matched'
              : `${hits} ${hits === 1 ? 'entry' : 'entries'} in ${results.length} ${results.length === 1 ? 'section' : 'sections'}`}
          </span>
        )}
      </div>

      {q === '' && (
        <nav className="help-contents" aria-label="Contents">
          {mine.map(s => (
            <button key={s.title} type="button" className="help-contents-link" onClick={() => jumpTo(s.title)}>
              {s.title}
            </button>
          ))}
        </nav>
      )}

      {q !== '' && results.length === 0 && (
        <div className="help-empty">
          Nothing in your version of the manual matches that. Try a single word, or
          clear the search to browse the sections.
        </div>
      )}

      {results.map(section => {
        const openNow = isOpen(section.title);
        return (
          <section
            key={section.title}
            id={`help-${slug(section.title)}`}
            className={`help-card ${openNow ? 'help-card--open' : ''}`}
          >
            <button
              type="button"
              className="help-card-head"
              aria-expanded={openNow}
              onClick={() => toggle(section.title)}
            >
              <span className="help-card-title">
                {section.title}
                {section.intro && <span className="help-card-intro">{section.intro}</span>}
              </span>
              <span className="help-chevron" aria-hidden="true">{openNow ? '−' : '+'}</span>
            </button>

            {openNow && (
              <ol className="help-steps">
                {section.steps.map((step, i) => (
                  <li key={step.heading}>
                    <span className="help-step-num">{i + 1}</span>
                    <div className="help-step-text">
                      <div className="help-step-heading">{step.heading}</div>
                      <div className="help-step-body">{step.body}</div>
                      {step.note && <div className="help-step-note">{step.note}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}

      <div className="help-foot">
        Still stuck? Ask your system administrator — and say which page you were on
        and what you clicked, so they can find it quickly.
      </div>
    </div>
  );
}
