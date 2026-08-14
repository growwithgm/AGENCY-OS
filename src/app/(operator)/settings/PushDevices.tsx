'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Where a device actually starts receiving notifications.
 *
 * Everything upstream — signals, windows, the peak blackout — is server
 * truth, but none of it reaches a phone until that phone registers the
 * service worker and subscribes. This panel is that step, and it reports
 * the device's real state rather than the server's hopes.
 */

type Status =
  | 'checking'      // still asking the browser
  | 'unsupported'   // this browser cannot do web push
  | 'unconfigured'  // the server has no VAPID keys
  | 'off'           // supported, not subscribed
  | 'on'            // subscribed on this device
  | 'denied'        // notifications blocked in browser settings
  | 'working';      // a change is in flight

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushDevices({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [status, setStatus] = useState<Status>('checking');
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!vapidPublicKey) return setStatus('unconfigured');
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return setStatus('unsupported');
      }
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        const subscription = await registration.pushManager.getSubscription();
        if (cancelled) return;
        if (Notification.permission === 'denied') return setStatus('denied');
        setStatus(subscription ? 'on' : 'off');
      } catch {
        if (!cancelled) setStatus('unsupported');
      }
    })();
    return () => { cancelled = true; };
  }, [vapidPublicKey]);

  const enable = useCallback(async () => {
    if (!vapidPublicKey) return;
    setStatus('working');
    setTestResult(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setStatus('denied');

      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!response.ok) throw new Error('subscribe failed');
      setStatus('on');
    } catch {
      setStatus('off');
      setTestResult('Could not enable notifications on this device. Try again.');
    }
  }, [vapidPublicKey]);

  const disable = useCallback(async () => {
    setStatus('working');
    setTestResult(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setStatus('off');
    } catch {
      setStatus('on');
    }
  }, []);

  const sendTest = useCallback(async () => {
    setTestResult('Sending…');
    try {
      const response = await fetch('/api/push/test', { method: 'POST' });
      const result = await response.json();
      setTestResult(
        result.sent > 0
          ? 'Sent. It should be on your screen now.'
          : `Nothing arrived: ${result.skipped ?? `${result.failed} failed`}.`,
      );
    } catch {
      setTestResult('The test could not be sent.');
    }
  }, []);

  return (
    <div className="rows__row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 220px' }}>
        <div className="small" style={{ fontWeight: 500 }}>This device</div>
        <p className="tiny dim" style={{ marginTop: 3, maxWidth: '60ch' }}>
          {status === 'checking' && 'Checking whether this device is set up…'}
          {status === 'unsupported' && 'This browser cannot receive push notifications. Chrome, Edge and Firefox can; on iPhone the site must be added to the home screen first.'}
          {status === 'unconfigured' && 'Push keys (VAPID) are not configured on the server, so no device can subscribe yet.'}
          {status === 'off' && 'Not receiving notifications yet. Enable to get attention signals and client requests here.'}
          {status === 'on' && 'This device is subscribed. Notifications obey the windows and the peak blackout above.'}
          {status === 'denied' && 'Notifications are blocked for this site in the browser. Allow them in the browser’s site settings, then try again.'}
          {status === 'working' && 'One moment…'}
        </p>
        {testResult && <p className="tiny" style={{ marginTop: 4 }}>{testResult}</p>}
      </div>

      <span className="row" style={{ gap: 6 }}>
        {status === 'on' && (
          <button type="button" className="btn btn--sm" onClick={sendTest}>Send a test</button>
        )}
        {(status === 'off' || status === 'on') && (
          <button
            type="button"
            className="choice"
            aria-pressed={status === 'on'}
            onClick={status === 'on' ? disable : enable}
          >
            {status === 'on' ? 'On' : 'Off'}
          </button>
        )}
      </span>
    </div>
  );
}
