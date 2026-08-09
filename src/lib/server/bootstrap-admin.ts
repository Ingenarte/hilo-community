import { db } from './db';
import { generateRandomPassword } from './password';
import { setUserPassword } from './auth';
import { enqueueWelcomeEmail } from './welcome';
import { log } from './logger'; // logger.ts exports `log`, not `logger`

export async function bootstrapAdminPassword(adminId: number, adminEmail: string): Promise<void> {
	try {
		const pwd = generateRandomPassword();
		await setUserPassword(adminId, pwd);
		await enqueueWelcomeEmail({
			toEmail: adminEmail,
			userId: adminId,
			generatedPassword: pwd,
			role: 'admin'
		});
		log.info('admin.password.bootstrapped', { adminEmail });
	} catch (err) {
		log.error('admin.password.bootstrap.failed', { err: String(err) });
	}
}

/**
 * Pre-existing non-admin users that were created under the old shared-password
 * scheme. Same idea as the admin bootstrap: generate a random password, hash it,
 * email it. Runs once per user; idempotent on subsequent boots.
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
			const pwd = generateRandomPassword();
			await setUserPassword(row.id, pwd);
			await enqueueWelcomeEmail({
				toEmail: row.email,
				userId: row.id,
				generatedPassword: pwd,
				role: row.role
			});
			log.info('user.password.bootstrapped', { email: row.email });
		} catch (err) {
			log.error('user.password.bootstrap.failed', { email: row.email, err: String(err) });
		}
	}
}
