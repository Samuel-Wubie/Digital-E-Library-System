import { useState, useEffect } from 'react';

import { API } from '../config';

// Fallback matrix used only if the backend has never had a matrix saved yet
// (e.g. brand new install, admin hasn't visited Access Control once). Once
// an admin saves anything via AdminDashboard's AccessControlMatrix, this
// fallback is never used again — the real saved matrix always wins.
const FALLBACK_MATRIX = {
  User:             { view: true, edit: false, delete: false, download: false },
  Officer:          { view: true, edit: true,  delete: false, download: true  },
  "Senior Officer": { view: true, edit: true,  delete: true,  download: true  },
  "Department Head":{ view: true, edit: true,  delete: true,  download: true  },
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
export function usePermissions(role) {
  const [matrix, setMatrix] = useState(null);
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

  const can = (permission) => {
    if (!matrix || !role) return false;
    const rolePermissions = matrix[role];
    if (!rolePermissions) return false;
    // The access matrix only stores view/edit/delete/download. "Add" is
    // governed by the same permission as "edit" (see AccessControlMatrix),
    // so map it here — otherwise canDo('add') always returns false.
    const key = permission === 'add' ? 'edit' : permission;
    return !!rolePermissions[key];
  };

  return { can, loading, matrix };
}