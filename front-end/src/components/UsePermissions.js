import { useState, useEffect } from 'react';

import { API } from '../config';

// Fallback matrix used only if the backend has never had a matrix saved yet
// (e.g. brand new install, admin hasn't visited Access Control once). Once
// an admin saves anything via AdminDashboard's AccessControlMatrix, this
// fallback is never used again — the real saved matrix always wins.
const FALLBACK_MATRIX = {
  // Users may download: that is the point of the library — they pay the
  // per-page fee and take the document. An admin can still turn it off in
  // Access control, but off-by-default made the whole paid flow invisible.
  User:             { view: true, add: false, edit: false, delete: false, download: true  },
  Officer:          { view: true, add: true,  edit: true,  delete: false, download: true  },
  "Senior Officer": { view: true, add: true,  edit: true,  delete: true,  download: true  },
  "Department Head":{ view: true, add: true,  edit: true,  delete: true,  download: true  },
};

// ----------------------------------------------------------------------------
// usePermissions(role) — fetches the live access-control matrix from the
// backend (the same one AdminDashboard's AccessControlMatrix reads/writes)
// and returns a `can(permission)` checker scoped to the given role.
//
// FIXED: was calling /api/access-control/matrix, which does not exist on
// the server (server.js only defines GET/PUT /api/permissions). That 404
// was silently swallowed by the .catch(), so every role was permanently
// stuck on FALLBACK_MATRIX and admin edits in Access Control never took
// effect anywhere that used this hook (Dashboard.js, OfficeDashboard.js).
// ----------------------------------------------------------------------------
// Pass a userId as well as the role and permissions delegated by a colleague
// on leave are included. Without it you get the role's own permissions only,
// which is what the admin screens want.
export function usePermissions(role, userId) {
  const [matrix, setMatrix] = useState(null);
  const [extra, setExtra] = useState(null);     // from delegation
  const [delegated, setDelegated] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/permissions`)
      .then(res => res.json())
      .then(data => {
        setMatrix(data || FALLBACK_MATRIX);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load access control matrix, using fallback:', err);
        setMatrix(FALLBACK_MATRIX);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!userId) { setExtra(null); setDelegated([]); return; }
    fetch(`${API}/api/permissions/effective?userId=${userId}`)
      .then(res => res.json())
      .then(data => {
        if (!data || data.message) return;
        setExtra(data.permissions || null);
        setDelegated(Array.isArray(data.delegated) ? data.delegated : []);
      })
      .catch(() => {});   // the role's own permissions still apply
  }, [userId]);

  const can = (permission) => {
    if (!matrix || !role) return false;
    const rolePermissions = matrix[role];
    // Delegation is additive, so a granted permission counts even when the
    // person's own role does not have it.
    if (extra && extra[permission]) return true;
    if (!rolePermissions) return false;
    // 'add' is its own permission now. A matrix saved before the split has no
    // 'add' key, so read it as 'edit' until an administrator sets them apart —
    // the server migrates the stored matrix on boot, this covers the gap for
    // anything still serving the old shape.
    if (permission === 'add' && rolePermissions.add === undefined) {
      return !!rolePermissions.edit;
    }
    return !!rolePermissions[permission];
  };

  return { can, loading, matrix, delegated };
}