// public/notifications.js
(async function () {
  // SAFETY CHECK: Only proceed if Push API & Notifications exist
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    console.warn("Push notifications not supported on this device/browser.");
    return;
  }

  const BACKEND = 'https://datamall-backend.onrender.com'; // your backend

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  try {
    // Fetch VAPID key
    const vapidRes = await fetch(`${BACKEND}/vapid_public_key`);
    if (!vapidRes.ok) throw new Error('Failed to fetch VAPID key');
    const { publicKey } = await vapidRes.json();

    // Request permission safely
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Register service worker
    const reg = await navigator.serviceWorker.register('/sw.js');
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    // Send subscription to backend
    const body = {
      endpoint: sub.endpoint,
      keys: sub.toJSON().keys,
      user_id: localStorage.getItem('admin') ? JSON.parse(localStorage.getItem('admin')).id : null
    };

    const res = await fetch(`${BACKEND}/save-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn('save-subscription failed', res.status, text);
    } else {
      console.log('Subscription saved on server');
    }
  } catch (e) {
    console.warn('Notifications init failed', e);
  }
})();

