import { useState, useEffect } from 'react';

const API = "http://localhost:5000";

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
// Usage in any component:
//   const { can, loading } = usePermissions(user?.role);
//   if (can('edit')) { ... }
//
// This replaces hardcoded checks like `user.role === 'admin'` with the real,
// admin-configurable matrix — so toggling Granted/Denied in Access Control
// actually changes what Officers/Senior Officers/etc. can do everywhere
// that calls this hook, instead of having no effect.
// ----------------------------------------------------------------------------
export function usePermissions(role) {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/access-control/matrix`)
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
    return !!rolePermissions[permission];
  };

  return { can, loading, matrix };
}