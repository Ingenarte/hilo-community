// Deadline-reminder rules and limits shared by the server and the Preferences form.
// Client-safe: no server imports.

export type ReminderPrefs = {
	/** IANA time zone; null falls back to the user's email schedule zone or the server default. */
	tz: string | null;
	/** Bit mask of working days: bit0 Monday .. bit6 Sunday (31 = Monday to Friday). */
	workDays: number;
	/** Working hours as minutes from midnight. */
	workStart: number;
	workEnd: number;
	dueSoonEnabled: boolean;
	/** How many hours before the deadline the alert is sent. */
	dueSoonHours: number;
	digestEnabled: boolean;
	digestTime: number;
	overdueEnabled: boolean;
	/** 0 Sunday .. 6 Saturday. */
	overdueWeekday: number;
	overdueTime: number;
};

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
	tz: null,
	workDays: 31,
	workStart: 9 * 60,
	workEnd: 18 * 60,
	dueSoonEnabled: true,
	dueSoonHours: 24,
	digestEnabled: true,
	digestTime: 9 * 60,
	overdueEnabled: true,
	overdueWeekday: 2,
	overdueTime: 9 * 60
};

export const DUE_SOON_HOUR_CHOICES = [4, 8, 12, 24, 48, 72] as const;

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** JS weekday (0 Sunday .. 6 Saturday) to the work-days bit. */
export function workDayBit(jsWeekday: number): number {
	return 1 << ((jsWeekday + 6) % 7);
}

export function isWorkDay(workDays: number, jsWeekday: number): boolean {
	return (workDays & workDayBit(jsWeekday)) !== 0;
}

export function minutesToHHMM(min: number): string {
	const h = Math.floor(min / 60);
	const m = min % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hhmmToMinutes(v: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
	if (!m) return null;
	const h = Number(m[1]);
	const mi = Number(m[2]);
	if (h > 23 || mi > 59) return null;
	return h * 60 + mi;
}

export function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

export type PrefsError = { field: string; message: string };

/** Validates a full set of preferences; returns the first problem found. */
export function validateReminderPrefs(p: ReminderPrefs): PrefsError | null {
	const minute = (n: number) => Number.isInteger(n) && n >= 0 && n <= 1439;
	if (p.tz !== null && (p.tz.length > 64 || !isValidTimeZone(p.tz))) {
		return { field: 'tz', message: 'Unknown time zone.' };
	}
	if (!Number.isInteger(p.workDays) || p.workDays < 1 || p.workDays > 127) {
		return { field: 'workDays', message: 'Pick at least one working day.' };
	}
	if (!minute(p.workStart) || !minute(p.workEnd) || p.workEnd <= p.workStart) {
		return { field: 'workHours', message: 'Working hours must end after they start.' };
	}
	if (!Number.isInteger(p.dueSoonHours) || p.dueSoonHours < 1 || p.dueSoonHours > 168) {
		return { field: 'dueSoonHours', message: 'Choose between 1 and 168 hours.' };
	}
	if (!minute(p.digestTime)) return { field: 'digestTime', message: 'Invalid time.' };
	if (!Number.isInteger(p.overdueWeekday) || p.overdueWeekday < 0 || p.overdueWeekday > 6) {
		return { field: 'overdueWeekday', message: 'Invalid weekday.' };
	}
	if (!minute(p.overdueTime)) return { field: 'overdueTime', message: 'Invalid time.' };
	return null;
}
