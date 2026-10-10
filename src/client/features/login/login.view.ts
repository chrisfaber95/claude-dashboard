// External (not inline) so the page works under the Content-Security-Policy.
const errorCode = new URLSearchParams(location.search).get('e');
const err = document.getElementById('err');

function loginErrorText(code: string): string {
  if (code === 'rate') return 'Too many attempts. Wait a minute and try again.';
  if (code === 'pair') return 'This QR code was already used or has expired. Ask for a new one.';
  return 'Wrong token.';
}

if (errorCode && err) err.textContent = loginErrorText(errorCode);
