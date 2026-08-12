'use client';

// Browser-side push enrolment. Everything here needs window APIs:
// permission prompt, service worker registration, PushManager.

import { useEffect, useState } from 'react';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type State = 'checking' | 'unsupported' | 'ios-needs-install' | 'denied' | 'off' | 'on';

export function PushControls({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<State>('checking');
  const [msg, setMsg] = useState<string>('');

  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    // Safari only exposes Push to installed (home-screen) web apps
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState(isIos && !standalone ? 'ios-needs-install' : 'unsupported');
      return;
    }
    if (isIos && !standalone) { setState('ios-needs-install'); return; }
    if (Notification.permission === 'denied') { setState('denied'); return; }

    navigator.serviceWorker.getRegistration().then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    });
  }, []);

  async function enable() {
    setMsg('');
    try {
      if (!vapidPublicKey) throw new Error('VAPID public key set nahi hai (NEXT_PUBLIC_VAPID_PUBLIC_KEY)');

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState('denied'); return; }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error(await res.text());

      setState('on');
      setMsg('Is device par notifications on ho gayin.');
    } catch (e) {
      setMsg(`Nahi ho saka: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function disable() {
    setMsg('');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('off');
      setMsg('Is device par notifications band.');
    } catch (e) {
      setMsg(`Nahi ho saka: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function test() {
    setMsg('Bhej rahe hain…');
    const res = await fetch('/api/push/test', { method: 'POST' });
    const json = await res.json();
    setMsg(json.skipped
      ? `Kuch nahi gaya: ${json.skipped}`
      : `${json.sent} device(s) par bheji, ${json.failed} fail.`);
  }

  return (
    <div>
      {state === 'checking' && <p className="muted">Check kar rahe hain…</p>}

      {state === 'ios-needs-install' && (
        <p className="muted small">
          iPhone/iPad par notifications tabhi chalti hain jab ye app home screen par install ho.
          Safari mein <strong>Share → Add to Home Screen</strong> karein, phir home screen wale
          icon se kholain aur yahan wapas aayein.
        </p>
      )}

      {state === 'unsupported' && (
        <p className="muted">Is browser mein Web Push support nahi hai.</p>
      )}

      {state === 'denied' && (
        <p className="muted small">
          Notifications block ho chuki hain. Browser ki site settings se permission
          allow karein, phir page reload karein.
        </p>
      )}

      {state === 'off' && <button onClick={enable} className="btn">Enable notifications</button>}

      {state === 'on' && (
        <div className="btn-row">
          <button onClick={test} className="btn">Test notification</button>
          <button onClick={disable} className="btn btn--subtle">Is device par band karo</button>
        </div>
      )}

      {msg && <p className="muted small">{msg}</p>}
    </div>
  );
}
