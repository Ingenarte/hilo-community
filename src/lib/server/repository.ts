/**
 * Repository pattern — narrow, testable façade over `tickets.ts`.
 *
 * Why this exists:
 *   1. **Dependency inversion** — routes depend on a small interface,
 *      not on the 737-LOC tickets module. Swapping the backing store
 *      (SQLite → Postgres → in-memory mock) becomes a one-file change.
 *   2. **Testability** — `setTicketRepo(new MemoryTicketRepo())` and the
 *      business code runs without SQLite.
 *   3. **Discoverability** — one place to see every persistence operation
 *      the app performs, grouped by aggregate (Ticket / Message / Project).
 *
 * Implementations:
 *   - `SqliteTicketRepo` / `SqliteMessageRepo` / `SqliteProjectRepo`
 *     delegate to the existing module functions. Behaviour is unchanged.
 *   - Custom implementations can be written for tests or alternate stores.
 *
 * Method shapes are derived with `typeof` so the repos always match the
 * real implementations — no type drift.
 */

import * as t from './tickets';

// Convenience: every repo method is just an alias to a module function.
type Fn<F> = F extends (...a: infer A) => infer R ? (...a: A) => R : never;

// ---------------------------------------------------------------------------
//  Ticket repository — read + create + project tagging + access control
// ---------------------------------------------------------------------------

export interface TicketRepository {
	get: Fn<typeof t.getTicket>;
	listForUser: Fn<typeof t.listTicketsForUser>;
	create: Fn<typeof t.createTicket>;
	canAccess: Fn<typeof t.canAccessTicket>;
	getProjectsForTicket: Fn<typeof t.getTicketProjects>;
	setProjectsForTicket: Fn<typeof t.setTicketProjects>;
	resolveProjectNames: Fn<typeof t.resolveProjectNames>;
}

export class SqliteTicketRepo implements TicketRepository {
	get = t.getTicket;
	listForUser = t.listTicketsForUser;
	create = t.createTicket;
	canAccess = t.canAccessTicket;
	getProjectsForTicket = t.getTicketProjects;
	setProjectsForTicket = t.setTicketProjects;
	resolveProjectNames = t.resolveProjectNames;
}

// ---------------------------------------------------------------------------
//  Message repository
// ---------------------------------------------------------------------------

export interface MessageRepository {
	listForTicket: Fn<typeof t.getMessagesForTicket>;
	append: Fn<typeof t.appendMessage>;
	edit: Fn<typeof t.editMessage>;
	softDelete: Fn<typeof t.softDeleteMessage>;
	addAttachment: Fn<typeof t.addAttachment>;
	toggleReaction: Fn<typeof t.toggleReaction>;
}

export class SqliteMessageRepo implements MessageRepository {
	listForTicket = t.getMessagesForTicket;
	append = t.appendMessage;
	edit = t.editMessage;
	softDelete = t.softDeleteMessage;
	addAttachment = t.addAttachment;
	toggleReaction = t.toggleReaction;
}

// ---------------------------------------------------------------------------
//  Project repository
// ---------------------------------------------------------------------------

export interface ProjectRepository {
	list: Fn<typeof t.listProjects>;
	listWithCounts: Fn<typeof t.listProjectsWithCounts>;
	create: Fn<typeof t.createProject>;
	rename: Fn<typeof t.renameProject>;
	delete: Fn<typeof t.deleteProject>;
}

export class SqliteProjectRepo implements ProjectRepository {
	list = t.listProjects;
	listWithCounts = t.listProjectsWithCounts;
	create = t.createProject;
	rename = t.renameProject;
	delete = t.deleteProject;
}

// ---------------------------------------------------------------------------
//  Injection seam
// ---------------------------------------------------------------------------

let tickets: TicketRepository = new SqliteTicketRepo();
let messages: MessageRepository = new SqliteMessageRepo();
let projects: ProjectRepository = new SqliteProjectRepo();

export function setTicketRepo(r: TicketRepository): void { tickets = r; }
export function setMessageRepo(r: MessageRepository): void { messages = r; }
export function setProjectRepo(r: ProjectRepository): void { projects = r; }

export function getTicketRepo(): TicketRepository { return tickets; }
export function getMessageRepo(): MessageRepository { return messages; }
export function getProjectRepo(): ProjectRepository { return projects; }
