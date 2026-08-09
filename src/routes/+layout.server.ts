import type { LayoutServerLoad } from './$types';
import { config } from '$lib/server/env';
import { db } from '$lib/server/db';
import { getUnreadTotal } from '$lib/server/reads';

export const load: LayoutServerLoad = ({ locals }) => {
	// Sprint D: surface the user's real unread total so the layout can
	// drive title/favicon/OS-badge from the DB instead of an in-memory
	// session counter that drifts whenever the user reloads.
	const unreadTotal = locals.user
		? getUnreadTotal(locals.user.id, locals.user.email, locals.user.role)
		: 0;

	// Sprint-35jun: load seen_install_help_at for the first-login help modal.
	// null = never seen (trigger auto-open); number = already dismissed.
	let seenInstallHelpAt: number | null = null;
	if (locals.user) {
		const row = db
			.prepare('SELECT seen_install_help_at FROM users WHERE id = ?')
			.get(locals.user.id) as { seen_install_help_at: number | null } | undefined;
		seenInstallHelpAt = row?.seen_install_help_at ?? null;
	}

	return {
		user: locals.user,
		brand: config.brand,
		theme: locals.user?.theme ?? 'dark',
		accent: locals.user?.accent ?? 'violet',
		unreadTotal,
		seenInstallHelpAt: locals.user ? seenInstallHelpAt : undefined
	};
};
