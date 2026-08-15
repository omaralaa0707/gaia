const { createClient } = require('@supabase/supabase-js');

// Public endpoint — no auth required.
// Returns active therapists with their available weekly slots for the next 14 days.
// Single-location version of ACPP's api/therapists.js (no branch/district5 split).

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: therapists, error } = await db
      .from('therapists')
      .select('id, name, role, weekly_slots, photo_url, calendar_id, price_in_person, price_online, accepts_gender')
      .eq('active', true)
      .order('name');

    if (error) return res.status(500).json({ error: error.message });

    // Get booked slots for next 14 days so we can filter them out
    const todayStr  = cairoDateStr(new Date());
    const endStr    = cairoDateStr(new Date(Date.now() + 14 * 86400000));

    const { data: bookings } = await db
      .from('submissions')
      .select('preferred_therapist_id, booked_date, booked_time')
      .neq('state', 'Rejected')
      .not('preferred_therapist_id', 'is', null)
      .gte('booked_date', todayStr)
      .lte('booked_date', endStr);

    const bookedSet = new Set(
      (bookings || []).map(b => `${b.preferred_therapist_id}|${b.booked_date}|${b.booked_time}`)
    );

    // Google Calendar freebusy — checks each therapist's real calendar for
    // events not recorded in our own submissions table (e.g. personal
    // appointments they added directly in Google Calendar).
    const busyByCalendar = await fetchBusyByCalendar(therapists || [], todayStr, endStr);

    const result = (therapists || []).map(t => ({
      id:        t.id,
      name:      t.name,
      role:      t.role,
      photo_url: t.photo_url || null,
      price_in_person: t.price_in_person != null ? t.price_in_person : null,
      price_online:    t.price_online != null ? t.price_online : null,
      accepts_gender:  t.accepts_gender || 'all',
      slots:     computeSlots(t.id, t.weekly_slots || [], bookedSet, busyByCalendar[t.calendar_id] || []),
    }));

    return res.status(200).json({ therapists: pinFirst(result, 'Yasmin Magdy') });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Returns a Google Calendar client if credentials are configured, else null
async function calendarClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const { google } = require('googleapis');
    const credentials = JSON.parse(raw);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    return google.calendar({ version: 'v3', auth });
  } catch (err) {
    console.error('[therapists] calendarClient() failed to initialize:', err.message);
    return null;
  }
}

// Queries freebusy for every therapist's calendar in one request, returning
// { [calendarId]: [{start: Date, end: Date}, ...] }. Fails soft: if the
// calendar client or the query itself fails, returns {} and slots are
// computed from our own bookings only (the pre-existing behavior), rather
// than breaking the whole booking flow over a calendar hiccup.
async function fetchBusyByCalendar(therapists, todayStr, endStr) {
  const calendarIds = [...new Set(therapists.map(t => t.calendar_id).filter(Boolean))];
  if (!calendarIds.length) return {};

  const cal = await calendarClient();
  if (!cal) return {};

  try {
    const startOffset = isoOffsetStr(cairoOffsetMinutes(...todayStr.split('-').map(Number)));
    const endOffset    = isoOffsetStr(cairoOffsetMinutes(...endStr.split('-').map(Number)));
    const fb = await cal.freebusy.query({
      requestBody: {
        timeMin:  `${todayStr}T00:00:00${startOffset}`,
        timeMax:  `${endStr}T23:59:59${endOffset}`,
        items:    calendarIds.map(id => ({ id })),
        timeZone: 'Africa/Cairo',
      },
    });

    const result = {};
    for (const [calId, info] of Object.entries(fb.data.calendars || {})) {
      result[calId] = (info.busy || []).map(b => ({ start: new Date(b.start), end: new Date(b.end) }));
    }
    return result;
  } catch (err) {
    console.error('[therapists] freebusy query failed:', err.message);
    return {};
  }
}

function isCalBusy(busyIntervals, slotStartIso, slotEndIso) {
  const s = new Date(slotStartIso);
  const e = new Date(slotEndIso);
  return busyIntervals.some(b => s < b.end && e > b.start);
}

// Returns the Africa/Cairo UTC offset in minutes for the given calendar date,
// correctly accounting for Egypt's DST (reinstated 2023: UTC+3 late Apr-late Oct,
// UTC+2 the rest of the year). Uses noon UTC as the reference instant so it never
// straddles Cairo's ~2am DST transition.
function cairoOffsetMinutes(year, month, day) {
  const refUtcMs = Date.UTC(year, month - 1, day, 12, 0, 0);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(refUtcMs).map(p => [p.type, p.value])
  );
  const cairoHour = parts.hour === '24' ? 0 : Number(parts.hour);
  const cairoAsUtcMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), cairoHour, Number(parts.minute));
  return Math.round((cairoAsUtcMs - refUtcMs) / 60000);
}

function isoOffsetStr(mins) {
  const sign = mins >= 0 ? '+' : '-';
  const abs  = Math.abs(mins);
  const hh   = Math.floor(abs / 60).toString().padStart(2, '0');
  const mm   = (abs % 60).toString().padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

// Returns YYYY-MM-DD in Cairo time
function cairoDateStr(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

// Moves the therapist with the given name to the front of the list
// (e.g. the founder), leaving everyone else in their existing order.
function pinFirst(list, name) {
  const idx = list.findIndex(t => t.name === name);
  if (idx <= 0) return list;
  const [pinned] = list.splice(idx, 1);
  return [pinned, ...list];
}

// Computes available slot occurrences for the next 14 days.
function computeSlots(therapistId, weeklySlots, bookedSet, busyIntervalsAll) {
  if (!weeklySlots.length) return [];

  const ranges   = weeklySlots.filter(s => s.type === 'range');
  const fixed    = weeklySlots.filter(s => !s.type || s.type === 'fixed');
  const breaks   = weeklySlots.filter(s => s.type === 'break');

  const slots    = [];
  const cairoNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));

  for (let offset = 0; offset < 14; offset++) {
    const d = new Date(cairoNow);
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    const dow     = d.getDay();
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);

    const candidateTimes = [];

    for (const r of ranges) {
      if (r.day !== dow) continue;
      const [sh, sm] = r.start.split(':').map(Number);
      const [eh, em] = r.end.split(':').map(Number);
      const endMins  = eh * 60 + em;
      let cur        = sh * 60 + sm;
      while (cur < endMins) {
        const hh = Math.floor(cur / 60).toString().padStart(2, '0');
        const mm = (cur % 60).toString().padStart(2, '0');
        candidateTimes.push({ time: `${hh}:${mm}`, mode: r.mode || 'in-person' });
        cur += 60;
      }
    }

    for (const f of fixed) {
      if (f.day !== dow) continue;
      candidateTimes.push({ time: f.time, mode: f.mode || 'in-person' });
    }

    const dayBreaks = breaks.filter(b => b.day === dow);
    function isInBreak(timeStr) {
      const [th, tm] = timeStr.split(':').map(Number);
      const tMins    = th * 60 + tm;
      return dayBreaks.some(b => {
        const [bsh, bsm] = b.start.split(':').map(Number);
        const [beh, bem] = b.end.split(':').map(Number);
        return tMins >= bsh * 60 + bsm && tMins < beh * 60 + bem;
      });
    }

    // Deduplicate by time+mode
    const seen = new Set();
    for (const { time, mode: slotMode } of candidateTimes) {
      const key = `${therapistId}|${dateStr}|${time}`;
      if (seen.has(`${time}|${slotMode}`)) continue;
      seen.add(`${time}|${slotMode}`);

      if (offset === 0) {
        const [sh, sm] = time.split(':').map(Number);
        const nowH = cairoNow.getHours(), nowM = cairoNow.getMinutes();
        if (nowH > sh || (nowH === sh && nowM >= sm)) continue;
      }
      if (bookedSet.has(key)) continue;
      if (isInBreak(time)) continue;

      const [h, m] = time.split(':').map(Number);
      if (busyIntervalsAll.length) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const offsetStr  = isoOffsetStr(cairoOffsetMinutes(year, month, day));
        const startIso   = `${dateStr}T${time}:00${offsetStr}`;
        const endIso      = `${dateStr}T${(h + 1).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00${offsetStr}`;
        if (isCalBusy(busyIntervalsAll, startIso, endIso)) continue;
      }

      const period       = h >= 12 ? 'PM' : 'AM';
      const displayH     = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const displayTime  = `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
      const displayDate  = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo', weekday: 'long', month: 'long', day: 'numeric',
      }).format(d);
      const modeLabel    = slotMode === 'online' ? 'Online' : 'In-person';

      slots.push({
        date:  dateStr,
        time,
        mode:        slotMode,
        displayDate,
        displayTime,
        label: `${displayDate} · ${displayTime} — ${modeLabel}`,
      });
    }
  }

  slots.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return slots;
}
