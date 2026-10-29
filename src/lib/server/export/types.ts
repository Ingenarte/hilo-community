export type ExportFormat = 'md' | 'pdf' | 'docx';
export const EXPORT_FORMATS: ExportFormat[] = ['md', 'pdf', 'docx'];

export type AttachmentKind = 'image' | 'audio' | 'video' | 'other';

export type ExportAttachment = {
	id: number;
	filename: string;
	mime_type: string;
	size_bytes: number;
	stored_name: string;
	kind: AttachmentKind;
	transcript_text: string | null;
	transcript_lang: string | null;
	/** Path of the file inside the ZIP, relative to the ticket folder. */
	assetPath: string;
	/** The file is no longer on disk; it is listed but cannot be included. */
	missing: boolean;
};

export type ExportMessage = {
	id: number;
	created_at: number;
	who: string;
	internal: boolean;
	edited: boolean;
	body: string;
	attachments: ExportAttachment[];
};

export type ExportTicket = {
	id: number;
	title: string;
	owner: string;
	status: string;
	priority: 'urgent' | 'high' | 'normal' | 'low';
	priorityReason: string | null;
	slaDueAt: number | null;
	createdAt: number;
	updatedAt: number;
	projects: string[];
	messages: ExportMessage[];
};
