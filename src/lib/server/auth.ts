import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { config } from './env';
import { hashPassword, verifyPassword } from './password';
import type { DeviceInfo } from './device';

export type Theme = 'dark' | 'light';
export type Accent = 'violet' | 'cyan' | 'emerald' | 'amber';
export const ACCENTS: Accent[] = ['violet', 'cyan', 'emerald', 'amber'];

export type SessionUser = {
	id: number;
	email: string;
	role: 'user' | 'admin';
	theme: Theme;
	accent: Accent;
	/** Set only on browser sessions: a temporary password must be replaced first. */
	mustChangePassword?: boolean;
};

export function setUserTheme(userId: number, theme: Theme): void {
	db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, userId);
}

export function getUserTheme(userId: number): Theme {
	const row = db.prepare('SELECT theme FROM users WHERE id = ?').get(userId) as
		| { theme: Theme }
		| undefined;
	return row?.theme ?? 'dark';
}

export function setUserAccent(userId: number, accent: Accent): void {
	db.prepare('UPDATE users SET accent = ? WHERE id = ?').run(accent, userId);
}

export const SESSION_COOKIE = 'hilo_session';
// Permanent session: 10 years. Low-security design by spec.
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365 * 10;

/**
 * Render today's "dynamic code" for the operator-configured date format.
 * Replaces the tokens `yyyy`, `yy`, `mm`, `dd` in that order so longer
 * tokens win over their shorter prefixes. Server clock is authoritative.
 */
export function dynamicPasswordForDate(d: Date = new Date()): string {
	const dd = String(d.getDate()).padStart(2, '0');
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const yy = String(d.getFullYear() % 100).padStart(2, '0');
	const yyyy = String(d.getFullYear()).padStart(4, '0');
	return config.authDynamicFormat
		.replace(/yyyy/g, yyyy)
		.replace(/yy/g, yy)
		.replace(/mm/g, mm)
		.replace(/dd/g, dd);
}

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

/**
 * Check whether the dynamic code is valid for today ± tolerance window.
 * Extracted from checkPasswords so it can be reused by checkLogin.
 */
export function checkDynamicCode(input: string): boolean {
	const tolerance = config.authDynamicWindowDays;
	const today = new Date();
	for (let offset = -tolerance; offset <= tolerance; offset++) {
		const d = new Date(today);
		d.setDate(today.getDate() + offset);
		if (safeEqual(input, dynamicPasswordForDate(d))) return true;
	}
	return false;
}

/**
 * Per-user password login (sprint-26may). Replaces checkPasswords + upsertUserByEmail.
 * Returns the session user if credentials are valid, or null otherwise.
 * Each user now has an individual password_hash — no shared fixed password.
 */
export async function checkLogin(
	email: string,
	plainPassword: string,
	dynamicCode: string
): Promise<SessionUser | null> {
	const e = email.toLowerCase().trim();
	const user = db
		.prepare(
			'SELECT id, email, role, theme, accent, password_hash, disabled_at FROM users WHERE email = ?'
		)
		.get(e) as
		| {
				id: number;
				email: string;
				role: 'user' | 'admin';
				theme: Theme;
				accent: Accent;
				password_hash: string | null;
				disabled_at: number | null;
		  }
		| undefined;

	if (!user || user.disabled_at) return null;

	// User has no password_hash yet — cannot log in. Admin bootstrap will set
	// one on next container start; non-admin users need admin to create them.
	if (!user.password_hash) return null;

	const okPwd = await verifyPassword(plainPassword, user.password_hash);
	if (!okPwd) return null;

	if (config.authDynamicFormat !== 'none') {
		if (!checkDynamicCode(dynamicCode)) return null;
	}

	db.prepare('UPDATE users SET last_seen = unixepoch() WHERE id = ?').run(user.id);
	return { id: user.id, email: user.email, role: user.role, theme: user.theme, accent: user.accent };
}

/**
 * Look up a user by email. Returns null if not found or disabled.
 * Does NOT create the user (self-signup is blocked as of sprint-26may).
 */
export function findActiveUserByEmail(email: string): SessionUser | null {
	const e = email.toLowerCase().trim();
	const row = db
		.prepare(
			'SELECT id, email, role, theme, accent, disabled_at FROM users WHERE email = ?'
		)
		.get(e) as
		| {
				id: number;
				email: string;
				role: 'user' | 'admin';
				theme: Theme;
				accent: Accent;
				disabled_at: number | null;
		  }
		| undefined;
	if (!row || row.disabled_at) return null;
	return { id: row.id, email: row.email, role: row.role, theme: row.theme, accent: row.accent };
}

/**
 * Create a new user with a hashed password. Used by admin when creating users.
 */
export async function createUserWithPassword(
	email: string,
	role: 'user' | 'admin',
	plainPassword: string
): Promise<{ id: number; email: string }> {
	const e = email.toLowerCase().trim();
	const hash = await hashPassword(plainPassword);
	const info = db
		.prepare(
			'INSERT INTO users (email, role, password_hash, last_seen) VALUES (?, ?, ?, unixepoch())'
		)
		.run(e, role, hash);
	return { id: Number(info.lastInsertRowid), email: e };
}

/**
 * Set (or reset) a user's password. Used by admin bootstrap and future
 * password-change flows.
 */
export async function setUserPassword(userId: number, plain: string): Promise<void> {
	const hash = await hashPassword(plain);
	db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
}

/**
 * The user picks a new password while signed in (forced first-login screen or
 * Preferences). Clears the "must change" flag, records the change and signs
 * out every other device; `keepSessionId` is the session that stays.
 * Returns how many other sessions were revoked.
 */
export async function changeUserPassword(
	userId: number,
	plain: string,
	keepSessionId: string
): Promise<number> {
	const hash = await hashPassword(plain);
	return db.transaction(() => {
		db.prepare(
			`UPDATE users
			 SET password_hash = ?, must_change_password = 0, password_changed_at = unixepoch()
			 WHERE id = ?`
		).run(hash, userId);
		return db
			.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
			.run(userId, keepSessionId).changes;
	})();
}

/**
 * Replace the password with a random one nobody knows. Used when an admin
 * resets an account or a user is invited: the old password stops working and
 * the person sets a new one through an emailed one-time link.
 */
export async function invalidatePassword(userId: number): Promise<void> {
	await setUserPassword(userId, randomBytes(24).toString('base64url'));
}

/**
 * Create a new session for the user and return its id.
 *
 * `deviceInfo` is captured from the incoming request so /admin/users can
 * later report which device class (mobile/tablet/desktop) and display
 * mode (browser vs installed PWA) each user is on. It's optional so
 * callers in tests or background scripts don't have to fabricate one.
 */
export function createSession(userId: number, deviceInfo?: DeviceInfo): string {
	const sid = randomBytes(32).toString('base64url');
	if (deviceInfo) {
		db.prepare(
			`INSERT INTO sessions (id, user_id, user_agent, device_class, display_mode, os_hint)
			 VALUES (?, ?, ?, ?, ?, ?)`
		).run(
			sid,
			userId,
			deviceInfo.userAgent,
			deviceInfo.deviceClass,
			deviceInfo.displayMode,
			deviceInfo.osHint
		);
	} else {
		db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run(sid, userId);
	}
	return sid;
}

/**
 * Get the user behind a session id, or null if not found.
 *
 * Every HTTP request (including SSE keep-alive pings) flows through here,
 * so any write hot-paths matter. The `last_seen` UPDATE only fires when
 * the existing value is older than 60s — that keeps the field useful for
 * "last activity" displays without burning a write on every poll.
 */
const SESSION_LAST_SEEN_THROTTLE_SECS = 60;

export function getSessionUser(sid: string | null | undefined): SessionUser | null {
	if (!sid) return null;
	const row = db
		.prepare(
			`SELECT u.id, u.email, u.role, u.theme, u.accent, u.must_change_password, s.last_seen
			 FROM sessions s JOIN users u ON u.id = s.user_id
			 WHERE s.id = ? AND u.disabled_at IS NULL`
		)
		.get(sid) as
		| {
				id: number;
				email: string;
				role: 'user' | 'admin';
				theme: Theme;
				accent: Accent;
				must_change_password: number;
				last_seen: number | null;
		  }
		| undefined;
	if (!row) return null;

	const nowSecs = Math.floor(Date.now() / 1000);
	const lastSeen = row.last_seen ?? 0;
	if (nowSecs - lastSeen >= SESSION_LAST_SEEN_THROTTLE_SECS) {
		db.prepare('UPDATE sessions SET last_seen = unixepoch() WHERE id = ?').run(sid);
	}

	return {
		id: row.id,
		email: row.email,
		role: row.role,
		theme: row.theme,
		accent: row.accent,
		mustChangePassword: row.must_change_password === 1
	};
}

export function destroySession(sid: string | null | undefined): void {
	if (!sid) return;
	db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
}
