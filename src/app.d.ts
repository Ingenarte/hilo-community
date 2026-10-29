// See https://kit.svelte.dev/docs/types#app
import type { SessionUser } from '$lib/server/auth';
import type { ApiTokenInfo } from '$lib/server/apiTokens';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: SessionUser | null;
			/** Set only for requests authenticated with an API token (/api/v1/*). */
			apiToken?: ApiTokenInfo | null;
		}
		// interface PageData {}
		interface PageState {
			lightbox?: boolean;
		}
		// interface Platform {}
	}
}

export {};
