// See https://kit.svelte.dev/docs/types#app
import type { SessionUser } from '$lib/server/auth';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: SessionUser | null;
		}
		// interface PageData {}
		// interface Platform {}
	}
}

export {};
