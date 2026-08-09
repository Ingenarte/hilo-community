/**
 * Email delivery schedules. Each user picks one; outbound notifications are
 * either sent immediately or queued until the next business-hours window in
 * the user's chosen region.
 *
 * Business hours = Mon-Fri, 09:00 – 18:00 local time.
 *
 * The presets below cover the major regions. Operators / users can also set
 * a custom IANA timezone string (e.g. 'America/Argentina/Buenos_Aires') by
 * writing it directly to `users.email_schedule` — anything that isn't a
 * preset key is treated as a tz id.
 */

export type SchedulePreset = {
	key: string;
	label: string;
	tz: string | null; // null = immediate
};

export const SCHEDULES: SchedulePreset[] = [
	{ key: 'immediate', label: 'Send immediately', tz: null },
	{ key: 'americas-east', label: 'Americas East (New York) · 9–18 Mon–Fri', tz: 'America/New_York' },
	{ key: 'americas-west', label: 'Americas West (Los Angeles) · 9–18 Mon–Fri', tz: 'America/Los_Angeles' },
	{ key: 'americas-south', label: 'South America (Buenos Aires) · 9–18 Mon–Fri', tz: 'America/Argentina/Buenos_Aires' },
	{ key: 'europe-west', label: 'Europe West (London) · 9–18 Mon–Fri', tz: 'Europe/London' },
	{ key: 'europe-central', label: 'Europe Central (Berlin) · 9–18 Mon–Fri', tz: 'Europe/Berlin' },
	{ key: 'africa', label: 'Africa (Lagos) · 9–18 Mon–Fri', tz: 'Africa/Lagos' },
	{ key: 'asia-south', label: 'South Asia (Mumbai) · 9–18 Mon–Fri', tz: 'Asia/Kolkata' },
	{ key: 'asia-southeast', label: 'Southeast Asia (Singapore) · 9–18 Mon–Fri', tz: 'Asia/Singapore' },
	{ key: 'asia-east', label: 'East Asia (Tokyo) · 9–18 Mon–Fri', tz: 'Asia/Tokyo' },
	{ key: 'oceania', label: 'Oceania (Sydney) · 9–18 Mon–Fri', tz: 'Australia/Sydney' }
];

const SCHEDULE_INDEX = new Map(SCHEDULES.map((s) => [s.key, s]));

export function timezoneFor(scheduleKey: string): string | null {
	if (scheduleKey === 'immediate') return null;
	const preset = SCHEDULE_INDEX.get(scheduleKey);
	if (preset) return preset.tz;
	// Anything else: assume it's a raw IANA tz. Sanity-check it can be parsed.
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: scheduleKey });
		return scheduleKey;
	} catch {
		return null; // unknown → fall back to immediate
	}
}

const WEEKDAYS_INT: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6
};

type Parts = { weekday: number; year: number; month: number; day: number; hour: number; minute: number };

function parseInTz(d: Date, tz: string): Parts {
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		weekday: 'short',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	const parts = fmt.formatToParts(d);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	const hourRaw = get('hour');
	// `Intl` sometimes returns "24" for midnight depending on locale config — normalise.
	const hour = Number(hourRaw) % 24;
	return {
		weekday: WEEKDAYS_INT[get('weekday')] ?? 0,
		year: Number(get('year')),
		month: Number(get('month')),
		day: Number(get('day')),
		hour,
		minute: Number(get('minute'))
	};
}

/**
 * Given target wall-clock components in `tz`, return the corresponding unix
 * epoch (seconds). Performs two `Intl` round-trips to correct for DST so the
 * answer matches the target hour within ±1 minute.
 *
 * Exported so email-throttle.ts can compute local-midnight epochs without
 * duplicating this DST-aware math.
 */
export function epochForWallClockInTz(
	tz: string,
	year: number,
	month: number,
	day: number,
	hour: number,
	minute = 0
): number {
	// Build a "best guess" UTC instant first.
	let guess = Date.UTC(year, month - 1, day, hour, minute);
	for (let i = 0; i < 2; i++) {
		const p = parseInTz(new Date(guess), tz);
		const got =
			Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) -
			Date.UTC(year, month - 1, day, hour, minute);
		guess -= got;
	}
	return Math.floor(guess / 1000);
}

/**
 * Returns the unix epoch (seconds) at which the next outbound email should
 * be sent for a user with `scheduleKey`. If the current moment is within the
 * window, returns `now`. Otherwise the next 09:00 Mon–Fri in that timezone.
 *
 * Mon=1 .. Fri=5. Saturday/Sunday → next Monday 09:00.
 */
export function nextSendTime(scheduleKey: string, now: Date = new Date()): number {
	const tz = timezoneFor(scheduleKey);
	if (!tz) return Math.floor(now.getTime() / 1000);

	const p = parseInTz(now, tz);
	const isBusinessDay = p.weekday >= 1 && p.weekday <= 5;
	const inHours = p.hour >= 9 && p.hour < 18;
	if (isBusinessDay && inHours) return Math.floor(now.getTime() / 1000);

	// Otherwise advance to the next 09:00 in `tz`. Start with today.
	let { year, month, day, weekday, hour } = p;
	// If today is a business day but we're past 18:00, jump to tomorrow.
	// If today is before 09:00, stay on today.
	if (isBusinessDay && hour >= 18) {
		({ year, month, day, weekday } = advanceOneDay(year, month, day, weekday));
	} else if (!isBusinessDay) {
		// Saturday(6) / Sunday(0). Advance until weekday is 1..5.
		while (!(weekday >= 1 && weekday <= 5)) {
			({ year, month, day, weekday } = advanceOneDay(year, month, day, weekday));
		}
	}
	return epochForWallClockInTz(tz, year, month, day, 9, 0);
}

function advanceOneDay(year: number, month: number, day: number, weekday: number) {
	const d = new Date(Date.UTC(year, month - 1, day + 1));
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		weekday: (weekday + 1) % 7
	};
}

export function isKnownSchedule(scheduleKey: string): boolean {
	if (scheduleKey === 'immediate') return true;
	if (SCHEDULE_INDEX.has(scheduleKey)) return true;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: scheduleKey });
		return true;
	} catch {
		return false;
	}
}
