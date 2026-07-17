/**
 * Web Push subscription (ADR-014).
 *
 * Free, no gatekeeper, reaches the learner who installed the app. On iOS it works
 * ONLY when the PWA is added to the home screen — not in a browser tab — so the
 * UI must say so rather than let a learner tap "enable" in Safari and get nothing.
 */

async function isSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscribe() {
  if (!(await isSupported())) throw new Error('Push is not supported on this device.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed.');

  const reg = await navigator.serviceWorker.ready;

  // Fetch the server's VAPID public key.
  const { publicKey } = await fetch('/api/v1/push/key').then((r) => r.json());
  if (!publicKey) throw new Error('Push is not configured on this institution.');

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch('/api/v1/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrf() },
    body: JSON.stringify(sub),
  });

  return true;
}

function csrf() {
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  return token ? { 'x-csrf-token': token } : {};
}

window.lintelPush = { isSupported, subscribe };
