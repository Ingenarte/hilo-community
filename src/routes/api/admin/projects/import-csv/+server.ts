import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createProject } from '$lib/server/tickets';
import { audit } from '$lib/server/audit';

/**
 * POST /api/admin/projects/import-csv
 *
 * Body: `text/csv` with one project name per row. The first column is the
 * name; any further columns are ignored. Header row is auto-detected and
 * skipped if the first row's first cell is exactly "name" (case insensitive).
 *
 * Returns `{ ok, created: number, skipped: number, errors: [...] }`.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

	const text = await request.text();
	if (!text.trim()) return json({ error: 'Empty body' }, { status: 400 });

	const rows = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	const cells = rows.map((row) => {
		// Split on commas not inside quotes (very small CSV — not the full RFC).
		const out: string[] = [];
		let cur = '';
		let inQuote = false;
		for (const ch of row) {
			if (ch === '"') inQuote = !inQuote;
			else if (ch === ',' && !inQuote) {
				out.push(cur.trim());
				cur = '';
			} else cur += ch;
		}
		out.push(cur.trim());
		return out;
	});

	const start = cells[0]?.[0]?.toLowerCase() === 'name' ? 1 : 0;
	let created = 0;
	let skipped = 0;
	const errors: Array<{ row: number; name: string; error: string }> = [];
	for (let i = start; i < cells.length; i++) {
		const name = cells[i][0]?.replace(/^"|"$/g, '');
		if (!name) {
			skipped += 1;
			continue;
		}
		try {
			createProject(name);
			created += 1;
		} catch (err) {
			const msg = (err as Error).message;
			if (/already exists/i.test(msg)) skipped += 1;
			else errors.push({ row: i + 1, name, error: msg });
		}
	}

	audit('projects.csv-imported', {
		actor: locals.user,
		detail: { created, skipped, errors: errors.length }
	});
	return json({ ok: true, created, skipped, errors });
};
