(() => {
  const storageKey = 'rap.authToast';
  const liveRegion = document.createElement('div');
  liveRegion.className = 'auth-toast-region';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  document.body.append(liveRegion);

  let timer;

  function show(message) {
    clearTimeout(timer);
    const toast = document.createElement('div');
    toast.className = 'auth-toast';

    const text = document.createElement('span');
    text.textContent = message;

    const close = document.createElement('button');
    close.className = 'auth-toast-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Đóng thông báo');
    close.textContent = '×';

    function dismiss() {
      clearTimeout(timer);
      toast.remove();
    }

    close.addEventListener('click', dismiss);
    toast.append(text, close);
    liveRegion.replaceChildren(toast);
    timer = setTimeout(dismiss, 5000);
  }

  function queue(message) {
    try {
      sessionStorage.setItem(storageKey, message);
    } catch {
      // Sign-in can still navigate when browser storage is unavailable.
    }
  }

  function showPending() {
    let message;
    try {
      message = sessionStorage.getItem(storageKey);
      sessionStorage.removeItem(storageKey);
    } catch {
      return;
    }
    if (message) show(message);
  }

  window.authToast = { show, queue, showPending };
})();
