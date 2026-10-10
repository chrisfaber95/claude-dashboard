// External (not inline) so the page works under the Content-Security-Policy.
const form = document.getElementById('pair') as HTMLFormElement | null;
const err = document.getElementById('err');
const ask = document.getElementById('ask');
const go = document.getElementById('go') as HTMLButtonElement | null;
const code = new URLSearchParams(location.search).get('c') ?? '';

const fail = (text: string) => {
  if (err) err.textContent = text;
  if (go) go.disabled = false;
};

if (form && go && form.dataset.state !== 'ok') {
  // The server found no valid code: say so and offer nothing to press.
  ask?.remove();
  go.remove();
  fail('This QR code was already used or has expired. Ask for a new one.');
} else if (form && go) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    go.disabled = true;
    if (err) err.textContent = '';
    try {
      const response = await fetch('/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ c: code }),
        credentials: 'same-origin',
      });
      // Navigate from here (not a redirect ending a navigation started in another app), so the Strict cookie is sent.
      if (response.ok) location.replace('/');
      else if (response.status === 429) fail('Too many attempts. Wait a minute and try again.');
      else fail('This QR code was already used or has expired. Ask for a new one.');
    } catch {
      fail('Could not reach the dashboard. Try again.');
    }
  });
}
