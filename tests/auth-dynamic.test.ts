import { describe, it, expect, vi } from 'vitest';

// Stub the env module so we don't need a .env or the env vars set in CI.
vi.mock('../src/lib/server/env', () => ({
	config: {
		publicBaseUrl: 'http://localhost:5180',
		brand: 'Hilo',
		adminEmail: 'admin@example.com',
		authFixedPassword: 'xyz',
		authDynamicFormat: 'ddmmyy',
		authDynamicWindowDays: 1,
		sessionSecret: 'unit-test-secret',
		smtp: {
			host: 'smtp.example.com',
			port: 587,
			secure: false,
			user: 'u',
			pass: 'p',
			from: 'noreply@example.com'
		},
		maxUploadMb: 20,
		uploadDir: './uploads',
		databasePath: ':memory:'
	}
}));

// Stub the db module so importing auth doesn't try to open SQLite.
vi.mock('../src/lib/server/db', () => ({
	db: {
		prepare: () => ({
			run: () => ({ changes: 0, lastInsertRowid: 0 }),
			get: () => undefined,
			all: () => []
		}),
		pragma: () => undefined
	}
}));

import { dynamicPasswordForDate } from '../src/lib/server/auth';

describe('dynamicPasswordForDate', () => {
	it('renders ddmmyy for 22 May 2026', () => {
		const d = new Date(2026, 4, 22); // 22 May 2026 (month is 0-indexed)
		expect(dynamicPasswordForDate(d)).toBe('220526');
	});

	it('renders ddmmyy with leading zeros', () => {
		const d = new Date(2026, 0, 3); // 3 Jan 2026
		expect(dynamicPasswordForDate(d)).toBe('030126');
	});

	it('renders yy = 00 for year ending in 2000', () => {
		const d = new Date(2000, 0, 1);
		expect(dynamicPasswordForDate(d)).toBe('010100');
	});
});
