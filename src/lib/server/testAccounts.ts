/**
 * Accounts on a reserved test domain (default hilo.test, an invalid TLD that
 * can never receive mail). Anything they author never notifies real people,
 * and mail addressed to them is dropped instead of hitting the SMTP server.
 * Lets end-to-end checks run against a live instance without side effects.
 * Override with TEST_EMAIL_DOMAINS="hilo.test,example.test" (comma separated).
 */
function domains(): string[] {
	return (process.env.TEST_EMAIL_DOMAINS ?? 'hilo.test')
		.split(',')
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);
}

export function isTestAccount(email: string | null | undefined): boolean {
	const at = (email ?? '').toLowerCase().lastIndexOf('@');
	if (at < 0) return false;
	const domain = (email as string).toLowerCase().slice(at + 1);
	return domains().includes(domain);
}
