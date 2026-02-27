// Registro central do PWA para todas as telas.
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
})();

// Base para fluxo de notificacoes no app.
window.ResenhaPWA = window.ResenhaPWA || {};
window.ResenhaPWA.requestNotificationPermission = async function () {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch (_err) {
    return 'error';
  }
};
