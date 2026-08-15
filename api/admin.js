const { createClient } = require('@supabase/supabase-js');

const GAIA_WHATSAPP_NUMBER = '+201004636683';       // digits only, no formatting, for wa.me links
const GAIA_ADDRESS         = 'Gaia Wellbeing, Beverly Hills, Sheikh Zayed, 6 October City';
const GAIA_MAPS_URL        = 'https://www.google.com/maps/place/GAIA+Wellbeing+(Psychotherapy+%26+Yoga+Centre)/@30.0610591,30.9378649,17z/data=!3m1!4b1!4m6!3m5!1s0x1458591b348561f1:0x31a3dcd8d033a9a7!8m2!3d30.0610545!4d30.9404398!16s%2Fg%2F11fszyrrkq?hl=en&entry=ttu';
const GAIA_DOMAIN          = 'gaiatherapy.vercel.app';
const GAIA_INSTAGRAM       = 'youaregaia_eg';

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

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
    console.error('[admin] calendarClient() failed to initialize:', err.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pwd = req.headers['x-admin-password'];
  if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const { action, ...params } = req.query;
      return res.json(await handleGet(action, params));
    }
    if (req.method === 'POST') {
      const { action, ...body } = req.body;
      return res.json(await handlePost(action, body));
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ── GET handlers ──────────────────────────────────────────────
// NOTE: GET actions live ONLY here, POST actions ONLY in handlePost below.
// ACPP's #1 recurring bug was the frontend calling apiFetch (GET) for an
// action that only exists in handlePost (or vice versa) - silently returning
// "Unknown action". Keep every new admin-panel action's apiFetch/apiPost call
// site matched to the handler it's actually defined in, here.

async function handleGet(action, params) {
  const db = supabase();

  if (action === 'getStats') {
    const { data } = await db.from('submissions').select('state, created_at');
    if (!data) return { total: 0, notReviewed: 0, confirmed: 0, rejected: 0, thisMonth: 0 };
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    return {
      total:       data.length,
      notReviewed: data.filter(r => r.state === 'Not Reviewed').length,
      confirmed:   data.filter(r => r.state === 'Confirmed').length,
      rejected:    data.filter(r => r.state === 'Rejected').length,
      thisMonth:   data.filter(r => new Date(r.created_at) >= monthStart).length,
    };
  }

  if (action === 'getSubmissions') {
    const { data } = await db
      .from('submissions')
      .select('*')
      .order('created_at', { ascending: false });
    return { submissions: data || [] };
  }

  if (action === 'getFeedback') {
    const { data } = await db
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false });
    return { feedback: data || [] };
  }

  if (action === 'getTherapists') {
    const { data } = await db
      .from('therapists')
      .select('*')
      .eq('active', true)
      .order('name');
    return { therapists: data || [] };
  }

  if (action === 'getClients') {
    const { data } = await db
      .from('submissions')
      .select('*')
      .order('created_at', { ascending: false });

    const clientMap = new Map();
    for (const sub of (data || [])) {
      const key = (sub.email || sub.phone || '').toLowerCase().trim();
      if (!key) continue;
      if (!clientMap.has(key)) {
        clientMap.set(key, {
          key,
          full_name:            sub.full_name,
          email:                sub.email,
          phone:                sub.phone,
          label:                sub.label || 'New',
          admin_notes:          sub.admin_notes || '',
          latest_submission_id: sub.id,
          confirmed_count:      0,
          total_count:          0,
          last_session:         null,
          therapists:           new Set(),
          sessions:             [],
        });
      }
      const c = clientMap.get(key);
      c.total_count++;
      c.sessions.push({
        id: sub.id, state: sub.state,
        booked_date: sub.booked_date, booked_time: sub.booked_time,
        assigned_therapist: sub.assigned_therapist,
        session_type: sub.session_type, created_at: sub.created_at,
      });
      if (sub.state === 'Confirmed') {
        c.confirmed_count++;
        if (!c.last_session || (sub.booked_date && sub.booked_date > c.last_session))
          c.last_session = sub.booked_date;
      }
      if (sub.assigned_therapist) c.therapists.add(sub.assigned_therapist);
    }

    const clients = [...clientMap.values()].map(c => ({
      ...c,
      therapists: [...c.therapists],
      label: c.label === 'New' && c.confirmed_count >= 2 ? 'Recurring' : c.label,
    }));

    return { clients };
  }

  if (action === 'getAvailableSlots') {
    return getAvailableSlots(params.therapistId);
  }

  if (action === 'getEmailTemplates') {
    const { data: stored } = await db.from('email_templates').select('*');
    const map  = Object.fromEntries((stored || []).map(t => [t.id, t]));
    const patS = map['patient_confirmation'];
    const thrS = map['therapist_notification'];
    const parse = row => { try { return row?.body ? JSON.parse(row.body) : {}; } catch { return {}; } };

    const PAT_DEFAULTS = {
      greeting: "We're looking forward to seeing you. Here are your appointment details:",
      whatsapp: GAIA_WHATSAPP_NUMBER,
      closing:  'We look forward to supporting you on your journey.',
      signoff:  'The Gaia Team',
    };
    const THR_DEFAULTS = {
      greetingSuffix: 'you have a new booking',
      footer:         'Gaia Therapy & Wellbeing',
    };
    return {
      templates: {
        patient_confirmation: {
          subject:  patS?.subject || DEFAULT_PATIENT_SUBJECT,
          sections: { ...PAT_DEFAULTS, ...parse(patS) },
          isCustom: !!(patS?.body),
          defaults: PAT_DEFAULTS,
        },
        therapist_notification: {
          subject:  thrS?.subject || DEFAULT_THERAPIST_SUBJECT,
          sections: { ...THR_DEFAULTS, ...parse(thrS) },
          isCustom: !!(thrS?.body),
          defaults: THR_DEFAULTS,
        },
      },
    };
  }

  return { error: 'Unknown action: ' + action };
}

// ── POST handlers ─────────────────────────────────────────────

async function handlePost(action, body) {
  const db = supabase();

  if (action === 'uploadPhoto') {
    const { base64, filename, contentType } = body;
    if (!base64 || !filename) return { error: 'base64 and filename required' };
    const base64Data = base64.replace(/^data:[\w/]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
    const { error } = await db.storage
      .from('team-photos')
      .upload(safeName, buffer, { contentType: contentType || 'image/jpeg', upsert: true });
    if (error) return { error: error.message };
    const { data: { publicUrl } } = db.storage.from('team-photos').getPublicUrl(safeName);
    return { url: publicUrl };
  }

  if (action === 'upsertTherapist') {
    const slug = body.slug || slugify(body.name);
    const fields = {
      name:          body.name,
      calendar_id:   body.calendarId    || undefined,
      role:          body.role          || undefined,
      active:        body.active !== false,
      // omitted (not `|| []`/`|| defaultHours()`) when not sent, so editing basic
      // details via this modal never wipes availability set via the Availability tab
      working_hours: body.workingHours  || undefined,
      weekly_slots:  body.weeklySlots   || undefined,
      email:         body.email         || null,
      photo_url:     body.photoUrl      || null,
      bio:           body.bio           || '',
      details:       body.details       || [],
      slug:          slug               || null,
      price_in_person: body.priceInPerson != null ? body.priceInPerson : null,
      price_online:     body.priceOnline   != null ? body.priceOnline   : null,
      accepts_gender:  body.acceptsGender || 'all',
      specialties:     body.specialties   || [],
    };
    if (body.id) {
      const { error } = await db.from('therapists').update(fields).eq('id', body.id);
      if (error) return { error: error.message };
    } else {
      const { error } = await db.from('therapists').insert(fields);
      if (error) return { error: error.message };
    }
    return { status: 'ok' };
  }

  if (action === 'setTherapistActive') {
    const { error } = await db
      .from('therapists')
      .update({ active: body.active === true })
      .eq('id', body.id);
    if (error) return { error: error.message };
    return { status: 'ok' };
  }

  if (action === 'saveAvailability') {
    const { error } = await db
      .from('therapists')
      .update({ working_hours: body.workingHours })
      .eq('id', body.therapistId);
    if (error) return { error: error.message };
    return { status: 'ok' };
  }

  if (action === 'saveWeeklySlots') {
    const { error } = await db
      .from('therapists')
      .update({ weekly_slots: body.weeklySlots || [] })
      .eq('id', body.therapistId);
    if (error) return { error: error.message };
    return { status: 'ok' };
  }

  if (action === 'confirmBooking') {
    return confirmBooking(db, body);
  }

  if (action === 'saveEmailTemplate') {
    const { error } = await db.from('email_templates').upsert({
      id:         body.id,
      subject:    body.subject  || '',
      body:       body.sections ? JSON.stringify(body.sections) : '',
      updated_at: new Date().toISOString(),
    });
    if (error) return { error: error.message };
    return { status: 'ok' };
  }

  if (action === 'previewEmailTemplate') {
    const { id, sections = {} } = body;
    let html;
    if (id === 'patient_confirmation') {
      html = buildPatientEmailHtml({
        clientName: 'Sara Ahmed', therapistName: 'Yasmin Magdy',
        date: 'Mon, 14 Jul 2026', time: '10:00 AM', sessionType: 'In-person',
        sections,
      });
    } else {
      const fakeSub = {
        full_name: 'Sara Ahmed', age: '28', session_type: 'In-person',
        preferred_days: 'Mon / Wed mornings', reason: 'Anxiety and stress management',
        goals: 'Better coping skills', prev_therapy: 'No', medication: 'No',
        diagnoses: '-', preferred_language: 'English', preferred_gender: 'No preference', extra: '-',
      };
      html = buildTherapistEmailHtml({
        therapistName: 'Yasmin Magdy',
        date: 'Mon, 14 Jul 2026', time: '10:00 AM', sessionType: 'In-person',
        sub: fakeSub, sections,
      });
    }
    return { html };
  }

  if (action === 'rejectBooking') {
    const { error } = await db
      .from('submissions')
      .update({ state: 'Rejected' })
      .eq('id', body.submissionId);
    if (error) return { error: error.message };
    return { status: 'ok' };
  }

  if (action === 'cancelBooking') {
    const { submissionId, reason } = body;
    const { data: sub, error: fetchErr } = await db
      .from('submissions').select('*').eq('id', submissionId).single();
    if (fetchErr) return { error: fetchErr.message };

    const { error } = await db
      .from('submissions').update({ state: 'Cancelled' }).eq('id', submissionId);
    if (error) return { error: error.message };

    // Must await before returning - Vercel can freeze/terminate this function's
    // execution as soon as the response is sent, silently killing any
    // calendar/email work still in flight if it were left as fire-and-forget.
    if (sub.event_id && sub.assigned_calendar_id) {
      await calendarClient().then(cal => {
        if (cal) return cal.events.delete({ calendarId: sub.assigned_calendar_id, eventId: sub.event_id })
          .catch(err => console.error('[admin] cancelBooking: calendar event delete failed:', err.message));
      }).catch(err => console.error('[admin] cancelBooking: calendarClient() failed:', err.message));
    }

    if (sub.email) await sendCancellationEmail(sub, reason || '').catch(err => console.error('[admin] cancelBooking: sendCancellationEmail failed:', err.message));

    if (sub.preferred_therapist_id) {
      const { data: therapist } = await db.from('therapists').select('email').eq('id', sub.preferred_therapist_id).single();
      if (therapist?.email) {
        await sendTherapistCancellationEmail(sub, therapist.email, reason || '').catch(err => console.error('[admin] cancelBooking: sendTherapistCancellationEmail failed:', err.message));
      } else {
        console.error('[admin] cancelBooking: no therapist email found for', sub.preferred_therapist_id);
      }
    }

    return { status: 'ok' };
  }

  if (action === 'bulkMarkExistingPatients') {
    const { submissionIds } = body;
    if (!Array.isArray(submissionIds) || !submissionIds.length) return { error: 'submissionIds required' };
    const { error } = await db
      .from('submissions')
      .update({ state: 'Confirmed', label: 'Recurring' })
      .in('id', submissionIds);
    if (error) return { error: error.message };
    return { status: 'ok', count: submissionIds.length };
  }

  if (action === 'updateClient') {
    const { submissionId, label, notes } = body;
    const fields = {};
    if (label !== undefined) fields.label = label;
    if (notes !== undefined) fields.admin_notes = notes;
    const { error } = await db.from('submissions').update(fields).eq('id', submissionId);
    if (error) return { error: error.message };
    return { status: 'ok' };
  }

  return { error: 'Unknown action: ' + action };
}

// ── Available slots (weekly_slots–based, no Google Calendar freebusy) ─
// Single-location version of ACPP's getAvailableSlots - one calendar_id,
// no branch parameter/filtering.

async function getAvailableSlots(therapistId) {
  if (!therapistId) return { error: 'therapistId required' };

  const db = supabase();

  const { data: therapist } = await db
    .from('therapists')
    .select('weekly_slots, calendar_id')
    .eq('id', therapistId)
    .single();

  const weeklySlots = therapist?.weekly_slots || [];
  if (!weeklySlots.length) return { slots: [], calendarConnected: true, calendarError: null };

  const todayStr = cairoDateStr(new Date());
  const endStr   = cairoDateStr(new Date(Date.now() + 14 * 86400000));

  // Booked submissions
  const { data: bookings } = await db
    .from('submissions')
    .select('booked_date, booked_time')
    .eq('preferred_therapist_id', therapistId)
    .neq('state', 'Rejected')
    .gte('booked_date', todayStr)
    .lte('booked_date', endStr);
  const bookedSet = new Set((bookings || []).map(b => `${b.booked_date}|${b.booked_time}`));

  // Google Calendar freebusy
  let busyIntervals = [];
  let calendarError = null;
  const calendarId = therapist?.calendar_id;
  if (calendarId) {
    try {
      const cal = await calendarClient();
      if (cal) {
        const fb = await cal.freebusy.query({
          requestBody: {
            timeMin:  `${todayStr}T00:00:00${isoOffsetStr(cairoOffsetMinutes(...todayStr.split('-').map(Number)))}`,
            timeMax:  `${endStr}T23:59:59${isoOffsetStr(cairoOffsetMinutes(...endStr.split('-').map(Number)))}`,
            items:    [{ id: calendarId }],
            timeZone: 'Africa/Cairo',
          },
        });
        busyIntervals = (fb.data.calendars[calendarId]?.busy || []).map(b => ({
          start: new Date(b.start),
          end:   new Date(b.end),
        }));
      }
    } catch (err) {
      calendarError = err.message;
    }
  }

  function isCalBusy(slotStartIso, slotEndIso) {
    const s = new Date(slotStartIso);
    const e = new Date(slotEndIso);
    return busyIntervals.some(b => s < b.end && e > b.start);
  }

  const cairoNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const slots = [];

  // Separate entries by type (old entries without type are treated as 'fixed')
  const ranges = weeklySlots.filter(s => s.type === 'range');
  const fixed  = weeklySlots.filter(s => !s.type || s.type === 'fixed');
  const breaks = weeklySlots.filter(s => s.type === 'break');

  for (let offset = 0; offset < 14; offset++) {
    const d = new Date(cairoNow);
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    const dow     = d.getDay();
    const dateStr = cairoDateStr(d);

    const candidateTimes = new Set();

    for (const r of ranges) {
      if (r.day !== dow) continue;
      const [sh, sm] = r.start.split(':').map(Number);
      const [eh, em] = r.end.split(':').map(Number);
      const endMins  = eh * 60 + em;
      let cur        = sh * 60 + sm;
      while (cur < endMins) {
        const hh = Math.floor(cur / 60).toString().padStart(2, '0');
        const mm = (cur % 60).toString().padStart(2, '0');
        candidateTimes.add(`${hh}:${mm}`);
        cur += 60;
      }
    }

    for (const f of fixed) {
      if (f.day !== dow) continue;
      candidateTimes.add(f.time);
    }

    // Collect breaks for this day
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

    for (const time of candidateTimes) {
      // Skip if in the past today
      if (offset === 0) {
        const [sh, sm] = time.split(':').map(Number);
        if (cairoNow.getHours() > sh || (cairoNow.getHours() === sh && cairoNow.getMinutes() >= sm)) continue;
      }
      if (bookedSet.has(`${dateStr}|${time}`)) continue;
      if (isInBreak(time)) continue;

      const offStr   = isoOffsetStr(cairoOffsetMinutes(...dateStr.split('-').map(Number)));
      const startIso = `${dateStr}T${time}:00${offStr}`;
      const [h, m]   = time.split(':').map(Number);
      const endIso   = `${dateStr}T${(h + 1).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00${offStr}`;
      if (isCalBusy(startIso, endIso)) continue;

      const period   = h >= 12 ? 'PM' : 'AM';
      const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
      slots.push({
        date:  dateStr,
        time,
        start: startIso,
        end:   endIso,
        displayDate: new Intl.DateTimeFormat('en-US', {
          timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        }).format(d),
        displayTime: `${displayH}:${m.toString().padStart(2, '0')} ${period}`,
      });
    }
  }

  slots.sort((a, b) => a.start.localeCompare(b.start));

  return { slots, calendarConnected: !!calendarId, calendarError };
}

function cairoDateStr(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
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

// ── Confirm booking ───────────────────────────────────────────

async function confirmBooking(db, data) {
  const start = new Date(data.slotStart);
  const end   = new Date(data.slotEnd);
  let eventId = null;

  // Create Google Calendar event if available
  const cal = await calendarClient();
  if (cal) {
    try {
      const event = await cal.events.insert({
        calendarId: data.calendarId,
        requestBody: {
          summary:     'Session: ' + data.clientName,
          start:       { dateTime: start.toISOString(), timeZone: 'Africa/Cairo' },
          end:         { dateTime: end.toISOString(),   timeZone: 'Africa/Cairo' },
          description:
            `Client: ${data.clientName}\n` +
            `Phone: ${data.clientPhone}\n` +
            `Email: ${data.clientEmail}\n` +
            `Session type: ${data.sessionType || 'In-person'}`,
        },
      });
      eventId = event.data.id;
    } catch (err) {
      // Calendar failed - still save booking to DB
      console.error('[admin] confirmBooking: calendar event creation failed:', err.message);
    }
  }

  const { error } = await db
    .from('submissions')
    .update({
      state:                'Confirmed',
      assigned_therapist:   data.therapistName,
      assigned_calendar_id: data.calendarId,
      booked_date:          formatCairo(start, 'date'),
      booked_time:          formatCairo(start, 'time'),
      event_id:             eventId,
    })
    .eq('id', data.submissionId);

  if (error) return { error: error.message };

  const dateStr = formatCairo(start, 'date');
  const timeStr = formatCairo(start, 'time');

  // Must await before returning - Vercel can freeze/terminate this function's
  // execution as soon as the response is sent, silently killing any email
  // work still in flight if it were left as fire-and-forget.
  await Promise.all([
    db.from('submissions').select('*').eq('id', data.submissionId).single(),
    data.therapistId
      ? db.from('therapists').select('email').eq('id', data.therapistId).single()
      : Promise.resolve({ data: null }),
    db.from('email_templates').select('subject, body').eq('id', 'patient_confirmation').maybeSingle(),
    db.from('email_templates').select('subject, body').eq('id', 'therapist_notification').maybeSingle(),
  ]).then(async ([subRes, therapistRes, patientTplRes, therapistTplRes]) => {
    const sub            = subRes.data || {};
    const therapistEmail = therapistRes.data?.email || null;
    const sessionType    = data.sessionType || 'In-person';
    const parse = row => { try { return row?.body ? JSON.parse(row.body) : {}; } catch { return {}; } };

    const emailTasks = [
      sendConfirmationEmail({
        clientName: data.clientName, clientEmail: data.clientEmail,
        therapistName: data.therapistName, date: dateStr, time: timeStr, sessionType,
        subject:  patientTplRes?.data?.subject  || null,
        sections: parse(patientTplRes?.data),
      }).catch(err => console.error('[admin] confirmBooking: sendConfirmationEmail failed:', err.message)),
    ];

    if (therapistEmail) {
      emailTasks.push(
        sendTherapistEmail({
          therapistEmail, therapistName: data.therapistName,
          date: dateStr, time: timeStr, sessionType, sub,
          subject:  therapistTplRes?.data?.subject || null,
          sections: parse(therapistTplRes?.data),
        }).catch(err => console.error('[admin] confirmBooking: sendTherapistEmail failed:', err.message))
      );
    }

    await Promise.all(emailTasks);
  }).catch(err => console.error('[admin] confirmBooking: post-confirm aggregate failure:', err.message));

  return { status: 'ok', eventId, calendarConnected: !!cal };
}

// ── Email template helpers ────────────────────────────────────

const DEFAULT_PATIENT_SUBJECT   = 'Your Gaia Appointment is Confirmed';
const DEFAULT_THERAPIST_SUBJECT = 'New Appointment: {{clientName}} - {{date}} at {{time}}';

function buildClientTableRows(sub) {
  const rows = [
    ['Full Name',                  sub.full_name],
    ['Age',                        sub.age],
    ['Session Type',               sub.session_type],
    ['Preferred Slots',            sub.preferred_days],
    ['What brings them in',        sub.reason],
    ['Goals for therapy',          sub.goals],
    ['Had therapy before',         sub.prev_therapy],
    ['On psychiatric meds',        sub.medication],
    ['Previous diagnoses',         sub.diagnoses],
    ['Preferred language',         sub.preferred_language],
    ['Preferred therapist gender', sub.preferred_gender],
    ['Additional notes',           sub.extra],
  ].filter(([, v]) => v && v !== '-');
  return rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8C7E6E;width:38%;border-bottom:1px solid #EDE5D6;vertical-align:top;">${label}</td>
      <td style="padding:10px 16px;font-size:14px;color:#3D3530;border-bottom:1px solid #EDE5D6;line-height:1.6;">${value}</td>
    </tr>`).join('');
}

// ── Email helpers ─────────────────────────────────────────────

function mailer() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  const nodemailer = require('nodemailer');
  return { transporter: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }), user };
}

// ── Patient confirmation email ────────────────────────────────

async function sendConfirmationEmail({ clientName, clientEmail, therapistName, date, time, sessionType, subject, sections = {} }) {
  const m = mailer();
  if (!m) { console.error('[admin] sendConfirmationEmail: mailer() unavailable (GMAIL_USER/GMAIL_APP_PASSWORD missing)'); return; }
  if (!clientEmail) { console.error('[admin] sendConfirmationEmail: no client email address'); return; }
  const html = buildPatientEmailHtml({ clientName, therapistName, date, time, sessionType, sections });
  await m.transporter.sendMail({
    from:    `"Gaia" <${m.user}>`,
    to:      clientEmail,
    subject: subject || DEFAULT_PATIENT_SUBJECT,
    html,
  });
}

// ── Therapist notification email ──────────────────────────────

async function sendTherapistEmail({ therapistEmail, therapistName, date, time, sessionType, sub, subject, sections = {} }) {
  const m = mailer();
  if (!m) { console.error('[admin] sendTherapistEmail: mailer() unavailable (GMAIL_USER/GMAIL_APP_PASSWORD missing)'); return; }
  if (!therapistEmail) { console.error('[admin] sendTherapistEmail: no therapist email address'); return; }
  const html = buildTherapistEmailHtml({ therapistName, date, time, sessionType, sub, sections });
  await m.transporter.sendMail({
    from:    `"Gaia" <${m.user}>`,
    to:      therapistEmail,
    subject: subject || `New Appointment: ${sub.full_name || 'New Client'} - ${date} at ${time}`,
    html,
  });
}

function buildPatientEmailHtml({ clientName, therapistName, date, time, sessionType, sections = {} }) {
  const greeting  = sections.greeting  || "We're looking forward to seeing you. Here are your appointment details:";
  const waNumber  = sections.whatsapp  || GAIA_WHATSAPP_NUMBER;
  const waLink    = `https://wa.me/${waNumber.replace(/\s+/g, '').replace(/^\+/, '+')}`;
  const closing   = sections.closing   || 'We look forward to supporting you on your journey.';
  const signoff   = sections.signoff   || 'The Gaia Team';

  const firstName  = clientName.split(' ')[0];
  const isOnline   = sessionType === 'Online';
  const sessionNote = isOnline
    ? `<tr><td colspan="2" style="padding-top:18px;">
        <div style="background:#EDE5D6;border-left:4px solid #6B6349;border-radius:0 8px 8px 0;padding:14px 16px;">
          <p style="margin:0;font-size:13px;color:#3D3530;line-height:1.6;">
            <strong>📩 Online session:</strong> You will receive a meeting invite link via email prior to your session.
          </p>
        </div>
       </td></tr>`
    : `<tr><td colspan="2" style="padding-top:18px;">
        <div style="background:#F0F9F0;border-left:4px solid #6B6349;border-radius:0 8px 8px 0;padding:14px 16px;">
          <p style="margin:0 0 4px;font-size:13px;color:#3D3530;"><strong>📍 In-person session - Gaia</strong></p>
          <p style="margin:0 0 8px;font-size:13px;color:#3D3530;">${GAIA_ADDRESS}</p>
          <a href="${GAIA_MAPS_URL}" style="color:#6B6349;font-size:13px;text-decoration:none;font-weight:600;">View on Google Maps →</a>
        </div>
       </td></tr>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Appointment Confirmed</title>
</head>
<body style="margin:0;padding:0;background:#F5EFE4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#3D3530;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#D9CEBC;">Gaia Therapy &amp; Wellbeing</p>
        <h1 style="margin:0;font-size:26px;font-weight:300;color:#ffffff;letter-spacing:0.02em;">Your appointment is confirmed</h1>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#ffffff;padding:40px 40px 32px;">

        <p style="margin:0 0 24px;font-size:16px;color:#3D3530;line-height:1.6;">
          Hi <strong>${firstName}</strong>,<br><br>
          ${greeting}
        </p>

        <!-- Appointment card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;border-radius:10px;margin-bottom:28px;">
          <tr><td style="padding:28px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="44" valign="top" style="padding-top:2px;">
                  <div style="width:36px;height:36px;background:#3D3530;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">📅</div>
                </td>
                <td style="padding-left:14px;">
                  <p style="margin:0 0 2px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8C7E6E;">Date &amp; Time</p>
                  <p style="margin:0;font-size:17px;font-weight:600;color:#3D3530;">${date} &nbsp;·&nbsp; ${time}</p>
                </td>
              </tr>
              <tr><td colspan="2" style="padding:14px 0 0;"><hr style="border:none;border-top:1px solid rgba(107,99,73,0.2);margin:0;"></td></tr>
              <tr><td colspan="2" style="padding-top:14px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="44" valign="top" style="padding-top:2px;">
                      <div style="width:36px;height:36px;background:#3D3530;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">👤</div>
                    </td>
                    <td style="padding-left:14px;">
                      <p style="margin:0 0 2px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8C7E6E;">Therapist</p>
                      <p style="margin:0;font-size:17px;font-weight:600;color:#3D3530;">${therapistName}</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
              <tr><td colspan="2" style="padding:14px 0 0;"><hr style="border:none;border-top:1px solid rgba(107,99,73,0.2);margin:0;"></td></tr>
              <tr><td colspan="2" style="padding-top:14px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="44" valign="top" style="padding-top:2px;">
                      <div style="width:36px;height:36px;background:#3D3530;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">${sessionType === 'Online' ? '💻' : '🏢'}</div>
                    </td>
                    <td style="padding-left:14px;">
                      <p style="margin:0 0 2px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8C7E6E;">Session type</p>
                      <p style="margin:0;font-size:17px;font-weight:600;color:#3D3530;">${sessionType}</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
              ${sessionNote}
            </table>
          </td></tr>
        </table>

        <p style="margin:0 0 12px;font-size:14px;color:#3D3530;line-height:1.7;">
          If you have any questions or need to reschedule, please contact us on WhatsApp:
        </p>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
          <tr><td style="background:#25D366;border-radius:8px;padding:12px 24px;">
            <a href="${waLink}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">📲 &nbsp;Message us on WhatsApp</a>
          </td></tr>
        </table>

        <p style="margin:0;font-size:14px;color:#8C7E6E;line-height:1.7;">
          ${closing}<br>
          <strong style="color:#3D3530;">${signoff}</strong>
        </p>

      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#3D3530;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 6px;font-size:12px;color:#D9CEBC;">Gaia Therapy &amp; Wellbeing</p>
        <p style="margin:0;font-size:11px;color:#8C7E6E;">
          <a href="https://${GAIA_DOMAIN}" style="color:#D9CEBC;text-decoration:none;">${GAIA_DOMAIN}</a>
          &nbsp;·&nbsp;
          <a href="https://instagram.com/${GAIA_INSTAGRAM}" style="color:#D9CEBC;text-decoration:none;">@${GAIA_INSTAGRAM}</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Therapist email template ──────────────────────────────────

function buildTherapistEmailHtml({ therapistName, date, time, sessionType, sub, sections = {} }) {
  const greetingSuffix = sections.greetingSuffix || 'you have a new booking';
  const footerText     = sections.footer         || 'Gaia Therapy &amp; Wellbeing';
  const firstName = (therapistName || '').split(' ').slice(-1)[0];
  const tableRows = buildClientTableRows(sub);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EFE4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#3D3530;border-radius:12px 12px 0 0;padding:32px 40px;">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#D9CEBC;">New Appointment</p>
        <h1 style="margin:0;font-size:22px;font-weight:300;color:#ffffff;">Hi ${firstName}, ${greetingSuffix}</h1>
      </td></tr>

      <!-- Appointment summary -->
      <tr><td style="background:#6B6349;padding:20px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="color:#ffffff;">
              <p style="margin:0 0 2px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.75;">Date &amp; Time</p>
              <p style="margin:0;font-size:20px;font-weight:600;">${date} · ${time}</p>
            </td>
            <td align="right" style="color:#ffffff;">
              <p style="margin:0 0 2px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.75;">Session</p>
              <p style="margin:0;font-size:20px;font-weight:600;">${sessionType}</p>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Client details -->
      <tr><td style="background:#ffffff;padding:32px 40px 24px;">
        <p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#6B6349;">Client Information</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EDE5D6;border-radius:8px;overflow:hidden;">
          ${tableRows}
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#3D3530;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
        <p style="margin:0;font-size:11px;color:#D9CEBC;">${footerText}</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────

// TODO(owner): placeholder weekly hours - replace via the admin panel once
// real per-therapist Gaia availability is provided (Phase 1).
function defaultHours() {
  return {
    "0": { start: "10:00", end: "20:00" },  // Sunday
    "1": { start: "10:00", end: "20:00" },  // Monday
    "2": { start: "10:00", end: "20:00" },  // Tuesday
    "3": { start: "10:00", end: "20:00" },  // Wednesday
    "4": { start: "10:00", end: "20:00" },  // Thursday
    "5": null,                              // Friday - off
    "6": { start: "10:00", end: "20:00" },  // Saturday
  };
}

function formatCairo(date, type) {
  const opts = type === 'date'
    ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }
    : { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' };
  return new Intl.DateTimeFormat('en-US', opts).format(date);
}

// ── Cancellation email ────────────────────────────────────────

async function sendCancellationEmail(sub, reason) {
  const m = mailer();
  if (!m) { console.error('[admin] sendCancellationEmail: mailer() unavailable (GMAIL_USER/GMAIL_APP_PASSWORD missing)'); return; }
  if (!sub.email) { console.error('[admin] sendCancellationEmail: no client email address'); return; }
  const firstName = (sub.full_name || 'there').split(' ')[0];
  const html = buildCancellationEmailHtml({
    firstName,
    therapistName: sub.assigned_therapist,
    bookedDate:    sub.booked_date,
    bookedTime:    sub.booked_time,
    reason,
  });
  await m.transporter.sendMail({
    from:    `"Gaia" <${m.user}>`,
    to:      sub.email,
    subject: 'Your Gaia Appointment - Update',
    html,
  });
}

async function sendTherapistCancellationEmail(sub, therapistEmail, reason) {
  const m = mailer();
  if (!m) { console.error('[admin] sendTherapistCancellationEmail: mailer() unavailable (GMAIL_USER/GMAIL_APP_PASSWORD missing)'); return; }
  if (!therapistEmail) { console.error('[admin] sendTherapistCancellationEmail: no therapist email address'); return; }
  const html = buildTherapistCancellationEmailHtml({
    therapistName: sub.assigned_therapist,
    clientName:    sub.full_name,
    bookedDate:    sub.booked_date,
    bookedTime:    sub.booked_time,
    reason,
  });
  await m.transporter.sendMail({
    from:    `"Gaia" <${m.user}>`,
    to:      therapistEmail,
    subject: `Appointment Cancelled: ${sub.full_name || 'Client'} - ${sub.booked_date || ''}`,
    html,
  });
}

function buildTherapistCancellationEmailHtml({ therapistName, clientName, bookedDate, bookedTime, reason }) {
  let dateDisplay = '';
  if (bookedDate) {
    try {
      const [y, mo, d] = bookedDate.split('-').map(Number);
      dateDisplay = new Intl.DateTimeFormat('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Cairo',
      }).format(new Date(y, mo - 1, d));
    } catch { dateDisplay = bookedDate; }
  }
  if (bookedTime) {
    const [h, m] = bookedTime.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    dateDisplay += (dateDisplay ? ' at ' : '') + `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
  }
  const firstName = (therapistName || '').split(' ').slice(-1)[0] || 'there';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EFE4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:40px 0;">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

    <tr><td style="background:#3D3530;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#D9CEBC;">Gaia Therapy &amp; Wellbeing</p>
      <h1 style="margin:0;font-size:24px;font-weight:300;color:#ffffff;letter-spacing:0.02em;">Appointment Cancelled</h1>
    </td></tr>

    <tr><td style="background:#ffffff;padding:40px 40px 32px;">
      <p style="margin:0 0 20px;font-size:16px;color:#3D3530;line-height:1.6;">
        Hi <strong>${firstName}</strong>,<br><br>
        The following appointment has been cancelled and removed from the calendar:
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EDE5D6;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        <tr>
          <td style="padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8C7E6E;width:38%;border-bottom:1px solid #EDE5D6;">Client</td>
          <td style="padding:10px 16px;font-size:14px;color:#3D3530;border-bottom:1px solid #EDE5D6;">${clientName || '-'}</td>
        </tr>
        ${dateDisplay ? `<tr>
          <td style="padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8C7E6E;border-bottom:1px solid #EDE5D6;">Was scheduled for</td>
          <td style="padding:10px 16px;font-size:14px;color:#3D3530;border-bottom:1px solid #EDE5D6;">${dateDisplay}</td>
        </tr>` : ''}
      </table>

      ${reason ? `<div style="background:#FFF8F0;border-left:4px solid #D97706;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#D97706;">Reason</p>
        <p style="margin:0;font-size:14px;color:#3D3530;line-height:1.6;">${reason}</p>
      </div>` : ''}

      <p style="margin:0;font-size:14px;color:#8C7E6E;line-height:1.7;">
        This slot is now open again.<br>
        <strong style="color:#3D3530;">The Gaia Team</strong>
      </p>
    </td></tr>

    <tr><td style="background:#3D3530;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#D9CEBC;">Gaia Therapy &amp; Wellbeing</p>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

function buildCancellationEmailHtml({ firstName, therapistName, bookedDate, bookedTime, reason }) {
  let dateDisplay = '';
  if (bookedDate) {
    try {
      const [y, mo, d] = bookedDate.split('-').map(Number);
      dateDisplay = new Intl.DateTimeFormat('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Cairo',
      }).format(new Date(y, mo - 1, d));
    } catch { dateDisplay = bookedDate; }
  }
  if (bookedTime) {
    const [h, m] = bookedTime.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    dateDisplay += (dateDisplay ? ' at ' : '') + `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EFE4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:40px 0;">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

    <tr><td style="background:#3D3530;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#D9CEBC;">Gaia Therapy &amp; Wellbeing</p>
      <h1 style="margin:0;font-size:24px;font-weight:300;color:#ffffff;letter-spacing:0.02em;">Appointment Update</h1>
    </td></tr>

    <tr><td style="background:#ffffff;padding:40px 40px 32px;">
      <p style="margin:0 0 20px;font-size:16px;color:#3D3530;line-height:1.6;">
        Hi <strong>${firstName}</strong>,<br><br>
        We're writing to let you know that your upcoming appointment${dateDisplay ? ` on <strong>${dateDisplay}</strong>` : ''}${therapistName ? ` with <strong>${therapistName}</strong>` : ''} has been cancelled.
      </p>

      ${reason ? `<div style="background:#FFF8F0;border-left:4px solid #D97706;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#D97706;">Reason</p>
        <p style="margin:0;font-size:14px;color:#3D3530;line-height:1.6;">${reason}</p>
      </div>` : ''}

      <p style="margin:0 0 16px;font-size:14px;color:#3D3530;line-height:1.7;">
        We'd love to get you rescheduled as soon as possible. You can pick a new time online right now, or reach out to us on WhatsApp if you'd prefer:
      </p>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
        <tr><td style="background:#3D3530;border-radius:8px;padding:12px 24px;">
          <a href="https://${GAIA_DOMAIN}/book.html" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">📅 &nbsp;Reschedule Online</a>
        </td></tr>
      </table>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
        <tr><td style="padding:6px 0;">
          <a href="https://wa.me/${GAIA_WHATSAPP_NUMBER}" style="color:#25D366;text-decoration:none;font-size:13px;font-weight:600;">📲 &nbsp;Or message us on WhatsApp</a>
        </td></tr>
      </table>

      <p style="margin:0;font-size:14px;color:#8C7E6E;line-height:1.7;">
        We apologise for any inconvenience and look forward to supporting you.<br>
        <strong style="color:#3D3530;">The Gaia Team</strong>
      </p>
    </td></tr>

    <tr><td style="background:#3D3530;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
      <p style="margin:0 0 6px;font-size:12px;color:#D9CEBC;">Gaia Therapy &amp; Wellbeing</p>
      <p style="margin:0;font-size:11px;color:#8C7E6E;">
        <a href="https://${GAIA_DOMAIN}" style="color:#D9CEBC;text-decoration:none;">${GAIA_DOMAIN}</a>
        &nbsp;·&nbsp;
        <a href="https://instagram.com/${GAIA_INSTAGRAM}" style="color:#D9CEBC;text-decoration:none;">@${GAIA_INSTAGRAM}</a>
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;
}
