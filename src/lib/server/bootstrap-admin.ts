import { db } from './db';
import { invalidatePassword } from './auth';
import { enqueueWelcomeEmail } from './welcome';
import { WELCOME_TTL_SECONDS, createPasswordToken, passwordLinkUrl } from './passwordTokens';
import { log } from './logger'; // logger.ts exports `log`, not `logger`

async function sendInvite(userId: number, email: string, role: 'user' | 'admin'): Promise<void> {
	// No password is ever generated or emailed: the old one (if any) stops
	// working and the person chooses theirs through a one-time link.
	await invalidatePassword(userId);
	const token = createPasswordToken(userId, 'welcome', WELCOME_TTL_SECONDS);
	await enqueueWelcomeEmail({
		toEmail: email,
		userId,
		role,
		setPasswordUrl: passwordLinkUrl(token),
		ttlSeconds: WELCOME_TTL_SECONDS
	});
}

export async function bootstrapAdminPassword(adminId: number, adminEmail: string): Promise<void> {
	try {
		await sendInvite(adminId, adminEmail, 'admin');
		log.info('admin.password.bootstrapped', { adminEmail });
	} catch (err) {
		log.error('admin.password.bootstrap.failed', { err: String(err) });
	}
}

/**
 * Pre-existing non-admin users that were created under the old shared-password
 * scheme. Same idea as the admin bootstrap: they get a one-time link to choose
 * a password. Runs once per user; idempotent on subsequent boots.
 */
export async function bootstrapLegacyUsers(): Promise<void> {
	const rows = db
		.prepare(
			`SELECT id, email, role FROM users
			 WHERE password_hash IS NULL AND disabled_at IS NULL AND role = 'user'`
		)
		.all() as Array<{ id: number; email: string; role: 'user' | 'admin' }>;
	for (const row of rows) {
		try {
			await sendInvite(row.id, row.email, row.role);
			log.info('user.password.bootstrapped', { email: row.email });
		} catch (err) {
			log.error('user.password.bootstrap.failed', { email: row.email, err: String(err) });
		}
	}
}
