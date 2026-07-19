import { useEffect, useRef, useCallback } from 'react';

import { API } from '../config';

const IDLE_LIMIT_MS = 2 * 60 * 1000;    // auto-logout after 2 min of no activity
const HEARTBEAT_MS  = 25 * 1000;        // tell the server we're alive every 25s
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

// ----------------------------------------------------------------------------
// useSessionManager(user, onSessionEnd) — session management for ALL roles.
// Mount once at the top of the app while a user is logged in. It:
//   1. Auto-logs-out after IDLE_LIMIT_MS of no mouse/keyboard activity.
//   2. Sends a heartbeat every HEARTBEAT_MS so the server's last_active_at
//      stays fresh (powers the admin "Sessions" panel).
//   3. Obeys force-logout: if an admin terminates the session, the next
//      heartbeat response has { forceLogout: true } and the client logs out.
// onSessionEnd(reason) receives 'idle' | 'forced'.
// ----------------------------------------------------------------------------
export function useSessionManager(user, onSessionEnd) {
  const lastActivityRef = useRef(Date.now());
  const endedRef = useRef(false);

  const endSession = useCallback(async (reason) => {
    if (endedRef.current) return;
    endedRef.current = true;
    try {
      await fetch(`${API}/api/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id })
      });
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    onSessionEnd(reason);
  }, [user, onSessionEnd]);

  useEffect(() => {
    if (!user?.id) return;
    endedRef.current = false;
    lastActivityRef.current = Date.now();

    const markActivity = () => { lastActivityRef.current = Date.now(); };
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, markActivity, { passive: true }));

    // Idle check every 30s
    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_LIMIT_MS) {
        endSession('idle'); // App shows the centered Session Expired dialog
      }
    }, 10 * 1000);

    // Heartbeat + force-logout detection
    const beat = async () => {
      try {
        const res = await fetch(`${API}/api/session/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id })
        });
        const data = await res.json();
        if (data.forceLogout) {
          endSession('forced'); // App shows the centered Session Expired dialog
        }
      } catch (err) {
        // Server unreachable — keep the session, try again next beat.
      }
    };
    beat();
    const heartbeatTimer = setInterval(beat, HEARTBEAT_MS);

    return () => {
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, markActivity));
      clearInterval(idleTimer);
      clearInterval(heartbeatTimer);
    };
  }, [user, endSession]);
}
