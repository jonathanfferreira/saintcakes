// Alerts for new site requests while the team app is open (foreground or background tab).
// Push to a closed browser would need a server-side sender and is intentionally not done here.

export function alertsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}
export function alertsEnabled(): boolean {
  return alertsSupported() && Notification.permission === 'granted';
}
export async function enableAlerts(): Promise<boolean> {
  if (!alertsSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission === 'granted') chime();
  return permission === 'granted';
}

function chime() {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    // Two soft notes; browsers may keep audio muted until the person has interacted with the page.
    [880, 1175].forEach((frequency, index) => {
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      const start = audio.currentTime + index * 0.18;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start); oscillator.stop(start + 0.4);
    });
    window.setTimeout(() => void audio.close(), 1000);
  } catch { /* Sound is a courtesy; the badge and list still show the request. */ }
}

export function announceRequests(count: number) {
  chime();
  if (!alertsEnabled()) return;
  const title = 'Saint Cakes · pedido novo do site';
  const options: NotificationOptions = {
    body: count === 1 ? 'Um cliente enviou uma encomenda pelo site.' : `${count} encomendas novas chegaram pelo site.`,
    icon: '/icons/icon-192.png', tag: 'saint-cakes-requests',
  };
  // Android browsers only show notifications through the service worker.
  const fallback = () => {
    try { const notification = new Notification(title, options); notification.onclick = () => { window.focus(); notification.close(); }; }
    catch { /* The badge and list still show the request. */ }
  };
  if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration().then(registration => registration ? registration.showNotification(title, options) : fallback()).catch(fallback);
  else fallback();
}
