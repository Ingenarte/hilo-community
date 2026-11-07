import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';
import {
	channelsForUser,
	decideChannels,
	getDefaultMode,
	getEmailDailyCap,
	setDefaultMode,
	setEmailDailyCap
} from '../src/lib/server/deliveryPolicy';

describe('decideChannels', () => {
	it('auto: push when available, otherwise email, never both', () => {
		expect(decideChannels('auto', true)).toEqual({ email: false, push: true });
		expect(decideChannels('auto', false)).toEqual({ email: true, push: false });
	});
	it('email only ignores push', () => {
		expect(decideChannels('email', true)).toEqual({ email: true, push: false });
	});
	it('push first falls back to email without a subscription', () => {
		expect(decideChannels('push', true)).toEqual({ email: false, push: true });
		expect(decideChannels('push', false)).toEqual({ email: true, push: false });
	});
});

describe('settings and per-user override', () => {
	it('defaults to auto with no daily cap, and persists changes', () => {
		expect(getDefaultMode()).toBe('auto');
		expect(getEmailDailyCap()).toBe(false);
		setDefaultMode('email');
		setEmailDailyCap(true);
		expect(getDefaultMode()).toBe('email');
		expect(getEmailDailyCap()).toBe(true);
		setDefaultMode('auto');
		setEmailDailyCap(false);
	});
	it('a user override wins over the default; without VAPID everyone is email', () => {
		db.prepare(`DELETE FROM users WHERE email = 'dp-user@hilo.test'`).run();
		const id = Number(db.prepare(`INSERT INTO users (email, role) VALUES ('dp-user@hilo.test','user')`).run().lastInsertRowid);
		expect(channelsForUser(id)).toEqual({ email: true, push: false });
		db.prepare('UPDATE users SET notify_mode = ? WHERE id = ?').run('email', id);
		expect(channelsForUser(id).email).toBe(true);
	});
});
