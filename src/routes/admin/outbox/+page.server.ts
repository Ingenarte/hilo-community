import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';

const PER_PAGE = 50;

export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (locals.user.role !== 'admin') throw error(403, 'Forbidden');

	const status = url.searchParams.get('status') ?? 'all';
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));

	const where: string[] = [];
	if (status === 'pending') where.push('sent_at IS NULL AND attempts = 0');
	else if (status === 'sent') where.push('sent_at IS NOT NULL');
	else if (status === 'failed') where.push('sent_at IS NULL AND attempts > 0');
	const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

	const total = (
		db.prepare(`SELECT COUNT(*) AS n FROM email_outbox ${clause}`).get() as { n: number }
	).n;

	const rows = db
		.prepare(
			`SELECT id, user_id, to_email, subject, send_after, attempts, sent_at, error, created_at
			 FROM email_outbox ${clause}
			 ORDER BY id DESC
			 LIMIT ? OFFSET ?`
		)
		.all(PER_PAGE, (page - 1) * PER_PAGE) as Array<{
		id: number;
		user_id: number | null;
		to_email: string;
		subject: string;
		send_after: number;
		attempts: number;
		sent_at: number | null;
		error: string | null;
		created_at: number;
	}>;

	const counts = {
		all: (db.prepare('SELECT COUNT(*) AS n FROM email_outbox').get() as { n: number }).n,
		pending: (
			db
				.prepare('SELECT COUNT(*) AS n FROM email_outbox WHERE sent_at IS NULL AND attempts = 0')
				.get() as { n: number }
		).n,
		sent: (
			db.prepare('SELECT COUNT(*) AS n FROM email_outbox WHERE sent_at IS NOT NULL').get() as {
				n: number;
			}
		).n,
		failed: (
			db
				.prepare('SELECT COUNT(*) AS n FROM email_outbox WHERE sent_at IS NULL AND attempts > 0')
				.get() as { n: number }
		).n
	};

	return { rows, counts, status, page, perPage: PER_PAGE, total };
};
