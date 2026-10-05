// External (not inline) so the page works under the Content-Security-Policy.
const e = new URLSearchParams(location.search).get('e');
const err = document.getElementById('err');
if (e && err) err.textContent = e === 'rate' ? 'Too many attempts. Wait a minute and try again.' : 'Wrong token.';
