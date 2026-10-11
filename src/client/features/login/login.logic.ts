/** Text for the `e` query code the server puts on the login redirect; unknown codes read as a wrong token. */
export function loginErrorText(code: string): string {
  if (code === 'rate') return 'Too many attempts. Wait a minute and try again.';
  if (code === 'pair') return 'This QR code was already used or has expired. Ask for a new one.';
  return 'Wrong token.';
}
