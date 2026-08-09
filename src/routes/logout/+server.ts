import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE, destroySession } from '$lib/server/auth';
import { clearSessionCookie } from '$lib/server/cookies';

export const POST: RequestHandler = ({ cookies }) => {
	destroySession(cookies.get(SESSION_COOKIE));
	clearSessionCookie(cookies);
	throw redirect(303, '/login');
};

export const GET: RequestHandler = ({ cookies }) => {
	destroySession(cookies.get(SESSION_COOKIE));
	clearSessionCookie(cookies);
	throw redirect(303, '/login');
};
