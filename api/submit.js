const { createClient } = require('@supabase/supabase-js');

// Public endpoint — no auth required.
// Handles both auto-bookings (specific therapist + slot) and manual referrals.

const GAIA_WHATSAPP   = 'https://wa.me/201004636683';
const GAIA_BACKUP_INBOX = 'youaregaia.eg@gmail.com';
const GAIA_ADDRESS    = 'Gaia Wellbeing, Beverly Hills, Sheikh Zayed, 6 October City';
const GAIA_MAPS_URL   = 'https://www.google.com/maps/place/GAIA+Wellbeing+(Psychotherapy+%26+Yoga+Centre)/@30.0610591,30.9378649,17z/data=!3m1!4b1!4m6!3m5!1s0x1458591b348561f1:0x31a3dcd8d033a9a7!8m2!3d30.0610545!4d30.9404398!16s%2Fg%2F11fszyrrkq?hl=en&entry=ttu';
const GAIA_DOMAIN     = 'gaiatherapy.vercel.app';
const GAIA_INSTAGRAM  = 'youaregaia_eg';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const data = req.body;

  const isAuto = data.bookingType === 'auto'
    && data.preferredTherapistId
    && data.bookedDate
    && data.bookedTime;

  // Payment is only collected when the patient picked a specific therapist
  // (known price). "Not sure, match me" referrals don't know their therapist
  // or price yet, so no proof is required — payment gets arranged once admin
  // manually assigns and confirms them.
  const paymentRequired = !!data.preferredTherapistId;
  let paymentProofUrl = null;
  if (paymentRequired) {
    if (!data.paymentProofBase64) {
      return res.status(400).json({ error: 'payment_proof_required', message: 'Please attach a screenshot of your payment.' });
    }
    paymentProofUrl = await uploadPaymentProof(db, data.paymentProofBase64, data.paymentProofFilename);
    if (!paymentProofUrl) {
      return res.status(500).json({ error: 'payment_proof_upload_failed', message: 'Could not upload your payment screenshot. Please try again.' });
    }
  }

  // Race-condition guard: ensure slot is still open before confirming
  if (isAuto) {
    const { data: conflict } = await db
      .from('submissions')
      .select('id')
      .eq('preferred_therapist_id', data.preferredTherapistId)
      .eq('booked_date',            data.bookedDate)
      .eq('booked_time',            data.bookedTime)
      .neq('state', 'Rejected')
      .limit(1);

    if (conflict && conflict.length > 0) {
      return res.status(409).json({
        error:   'slot_taken',
        message: 'That slot was just booked. Please choose another.',
      });
    }
  }

  // Fetch therapist details needed for auto-booking (single location — no branch lookup)
  let calendarId     = null;
  let therapistEmail = null;
  if (isAuto && data.preferredTherapistId) {
    const { data: t } = await db
      .from('therapists')
      .select('calendar_id, email')
      .eq('id', data.preferredTherapistId)
      .single();
    calendarId     = t?.calendar_id || null;
    therapistEmail = t?.email || t?.calendar_id || null;
  }

  const insertData = {
    state:                    isAuto ? 'Confirmed' : 'Not Reviewed',
    full_name:                data.fullName,
    phone:                    data.phone,
    email:                    data.email,
    age:                      data.age,
    reason:                   data.reason,
    prev_therapy:             data.prevTherapy,
    medication:               data.medication,
    medication_details:       data.medicationDetails  || null,
    diagnoses:                data.diagnoses          || null,
    goals:                    data.goals,
    preferred_gender:         data.gender,
    preferred_language:       data.language,
    session_type:             data.sessionType,
    country:                  data.country            || null,
    timezone:                 data.timezone           || null,
    preferred_days:           data.days               || null,
    preferred_time:           data.timeOfDay          || null,
    referral_source:          data.referralSource,
    extra:                    data.extra              || null,
    preferred_therapist_id:   data.preferredTherapistId   || null,
    preferred_therapist_name: data.preferredTherapistName || null,
    booking_type:             isAuto ? 'auto' : 'manual',
    assigned_therapist:       isAuto ? data.preferredTherapistName : null,
    assigned_calendar_id:     isAuto ? calendarId : null,
    booked_date:              isAuto ? data.bookedDate : null,
    booked_time:              isAuto ? data.bookedTime : null,
    is_rebooking:             !!data.isRebooking,
    payment_proof_url:        paymentProofUrl,
  };

  const { data: inserted, error } = await db
    .from('submissions')
    .insert(insertData)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Non-blocking: send emails + create calendar event + remove slot from weekly rotation
  const afterTasks = [sendNewSubmissionNotification(data, isAuto).catch(err => console.error('[submit] internal notification email failed:', err.message))];
  if (!isAuto && data.email) {
    afterTasks.push(sendManualAcknowledgementEmail(data).catch(err => console.error('[submit] manual acknowledgement email failed:', err.message)));
  }
  if (isAuto) {
    if (calendarId) {
      afterTasks.push(
        createCalendarEvent(data, calendarId).then(eventId => {
          if (eventId) {
            return db.from('submissions').update({ event_id: eventId }).eq('id', inserted.id);
          }
          console.error('[submit] createCalendarEvent returned no eventId (see prior [submit] calendar error log, if any)');
        }).catch(err => console.error('[submit] createCalendarEvent threw:', err.message))
      );
    }
    afterTasks.push(sendPatientConfirmationEmail(data).catch(err => console.error('[submit] patient confirmation email failed:', err.message)));
    if (therapistEmail) {
      afterTasks.push(sendTherapistNotificationEmail(data, therapistEmail).catch(err => console.error('[submit] therapist notification email failed:', err.message)));
    }
    // Remove the booked slot from weekly_slots so it's no longer offered to new clients.
    // If the session turns out to be one-time, admin can re-add it manually.
    afterTasks.push(removeBookedWeeklySlot(db, data.preferredTherapistId, data.bookedDate, data.bookedTime).catch(err => console.error('[submit] removeBookedWeeklySlot failed:', err.message)));
  }
  // Must await before responding — Vercel can freeze/terminate this function's
  // execution as soon as a response is sent, silently killing any calendar/email
  // work still in flight if it were left as fire-and-forget.
  await Promise.all(afterTasks).catch(err => console.error('[submit] afterTasks aggregate failure:', err.message));

  return res.status(200).json({
    status:       'ok',
    confirmed:    isAuto,
    submissionId: inserted.id,
  });
};

// ── Payment proof upload ────────────────────────────────────────

async function uploadPaymentProof(db, base64, filename) {
  try {
    const base64Data = base64.replace(/^data:([\w/+.-]+);base64,/, '');
    const mimeMatch   = /^data:([\w/+.-]+);base64,/.exec(base64);
    const contentType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const buffer      = Buffer.from(base64Data, 'base64');
    const ext         = (filename || '').split('.').pop() || 'jpg';
    const safeName     = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext.replace(/[^a-zA-Z0-9]/g, '')}`;

    const { error } = await db.storage
      .from('payment-proofs')
      .upload(safeName, buffer, { contentType, upsert: false });
    if (error) { console.error('[submit] uploadPaymentProof error:', error.message); return null; }

    const { data: { publicUrl } } = db.storage.from('payment-proofs').getPublicUrl(safeName);
    return publicUrl;
  } catch (err) {
    console.error('[submit] uploadPaymentProof threw:', err.message);
    return null;
  }
}

// ── Remove booked slot from therapist's weekly rotation ───────

async function removeBookedWeeklySlot(db, therapistId, bookedDate, bookedTime) {
  const { data: t } = await db
    .from('therapists')
    .select('weekly_slots')
    .eq('id', therapistId)
    .single();

  if (!t?.weekly_slots?.length) return;

  // Derive day-of-week from YYYY-MM-DD (month is 0-indexed in Date constructor)
  const [year, month, day] = bookedDate.split('-').map(Number);
  const dow = new Date(year, month - 1, day).getDay(); // 0 = Sunday

  // Only remove fixed-type slots — range entries regenerate from the schedule automatically
  const updated = t.weekly_slots.filter(s => !(!s.type || s.type === 'fixed') || !(s.day === dow && s.time === bookedTime));
  if (updated.length === t.weekly_slots.length) return; // slot not found, nothing to do

  await db.from('therapists').update({ weekly_slots: updated }).eq('id', therapistId);
}

// ── Google Calendar ───────────────────────────────────────────

async function createCalendarEvent(data, calendarId) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(raw),
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const cal = google.calendar({ version: 'v3', auth });

    // bookedDate = "YYYY-MM-DD", bookedTime = "HH:MM"
    const [year, month, day] = data.bookedDate.split('-').map(Number);
    const [hour, minute]     = data.bookedTime.split(':').map(Number);
    const offsetMin  = cairoOffsetMinutes(year, month, day);
    const startUtcMs = Date.UTC(year, month - 1, day, hour, minute) - offsetMin * 60000;
    const startISO   = new Date(startUtcMs).toISOString();
    const endISO     = new Date(startUtcMs + 60 * 60000).toISOString();

    const event = await cal.events.insert({
      calendarId,
      requestBody: {
        summary:     `Session: ${data.fullName}`,
        start:       { dateTime: startISO, timeZone: 'Africa/Cairo' },
        end:         { dateTime: endISO,   timeZone: 'Africa/Cairo' },
        description: [
          `Client: ${data.fullName}`,
          `Phone: ${data.phone}`,
          `Email: ${data.email}`,
          `Session type: ${data.sessionType}`,
          data.country ? `Location: ${data.country} (${data.timezone})` : '',
        ].filter(Boolean).join('\n'),
      },
    });
    return event.data.id;
  } catch (err) {
    console.error('[submit] createCalendarEvent error:', err.message);
    return null;
  }
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

// ── Mailer ────────────────────────────────────────────────────
// Note: Vercel bakes environment variables into each deployment at build
// time. Changing GMAIL_USER/GMAIL_APP_PASSWORD/GOOGLE_SERVICE_ACCOUNT_JSON
// in the dashboard does NOT take effect until the next deployment — a
// redeploy (or any new push) is required for credential changes to apply.

function mailer() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  const nodemailer = require('nodemailer');
  return {
    t:    nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }),
    user,
  };
}

// ── Notification to Gaia inbox ────────────────────────────────

async function sendNewSubmissionNotification(data, isAuto) {
  const m = mailer();
  if (!m) { console.error('[submit] sendNewSubmissionNotification: mailer() unavailable (GMAIL_USER/GMAIL_APP_PASSWORD missing)'); return; }

  const rebookingTag = data.isRebooking ? '[Rebooking] ' : '';
  const subject = isAuto
    ? `${rebookingTag}Auto-Booked: ${data.fullName} with ${data.preferredTherapistName} on ${data.bookedDate}`
    : data.preferredTherapistName
      ? `${rebookingTag}New Referral: ${data.fullName} — requested ${data.preferredTherapistName}`
      : `${rebookingTag}New Referral: ${data.fullName} — awaiting review`;

  const rows = [
    ['Name',          data.fullName],
    ['Phone',         data.phone],
    ['Email',         data.email],
    ['Age',           data.age],
    ['Session type',  data.sessionType],
    data.country  ? ['Country',    data.country]  : null,
    data.timezone ? ['Timezone',   data.timezone] : null,
    isAuto                              ? ['Therapist',        data.preferredTherapistName] : null,
    isAuto                              ? ['Slot',             `${data.bookedDate} at ${data.bookedTime}`] : null,
    !isAuto && data.preferredTherapistName ? ['Requested therapist', data.preferredTherapistName + ' (no open slots — needs scheduling)'] : null,
    !isAuto && data.days                ? ['Pref. days',      data.days] : null,
    ['Reason',        data.reason],
    ['Medication',    data.medication + (data.medicationDetails ? ` — ${data.medicationDetails}` : '')],
    ['Referral source', data.referralSource],
  ].filter(Boolean);

  const tableRows = rows.map(([k, v]) => `
    <tr>
      <td style="padding:8px 12px;font-size:12px;color:#8C7E6E;text-transform:uppercase;letter-spacing:.1em;width:35%;border-bottom:1px solid #eee;white-space:nowrap;">${k}</td>
      <td style="padding:8px 12px;font-size:14px;color:#3D3530;border-bottom:1px solid #eee;">${v || '—'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#F5EFE4;font-family:Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;">
  <div style="background:${isAuto ? '#3D3530' : '#6B6349'};padding:24px 32px;">
    <p style="margin:0;font-size:11px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.15em;">Gaia ${isAuto ? 'Auto-Confirmed Booking' : 'New Referral'}</p>
    <h2 style="margin:4px 0 0;font-size:20px;font-weight:400;color:#fff;">${data.fullName}</h2>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0">${tableRows}</table>
  <div style="padding:16px 32px;background:#f9f7f4;">
    <p style="margin:0;font-size:12px;color:#8C7E6E;">View in admin panel → <a href="https://${GAIA_DOMAIN}/admin-panel" style="color:#6B6349;">${GAIA_DOMAIN}/admin-panel</a></p>
  </div>
</div>
</body></html>`;

  await m.t.sendMail({
    from:    `"Gaia System" <${m.user}>`,
    to:      GAIA_BACKUP_INBOX,
    subject,
    html,
  });
}

// ── Patient confirmation email (auto-booking) ─────────────────

async function sendPatientConfirmationEmail(data) {
  const m = mailer();
  if (!m) { console.error('[submit] sendPatientConfirmationEmail: mailer() unavailable (GMAIL_USER/GMAIL_APP_PASSWORD missing)'); return; }
  if (!data.email) { console.error('[submit] sendPatientConfirmationEmail: no email address on submission'); return; }

  const firstName   = data.fullName.split(' ')[0];
  const isOnline    = data.sessionType === 'Online';
  const [h, min]    = data.bookedTime.split(':').map(Number);
  const period      = h >= 12 ? 'PM' : 'AM';
  const displayH    = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const displayTime = `${displayH}:${min.toString().padStart(2, '0')} ${period}`;
  const displayDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Africa/Cairo',
  }).format(new Date(data.bookedDate + 'T00:00:00'));

  const sessionNote = isOnline
    ? `<div style="background:#EDE5D6;border-left:4px solid #6B6349;border-radius:0 8px 8px 0;padding:14px 16px;margin-top:16px;">
        <p style="margin:0;font-size:13px;color:#3D3530;line-height:1.6;"><strong>Online session:</strong> You will receive a meeting invite link via email prior to your session.</p>
       </div>`
    : `<div style="background:#F0F9F0;border-left:4px solid #6B6349;border-radius:0 8px 8px 0;padding:14px 16px;margin-top:16px;">
        <p style="margin:0 0 4px;font-size:13px;color:#3D3530;"><strong>In-person session — Gaia</strong></p>
        <p style="margin:0 0 8px;font-size:13px;color:#3D3530;">${GAIA_ADDRESS}</p>
        <a href="${GAIA_MAPS_URL}" style="color:#6B6349;font-size:13px;text-decoration:none;font-weight:600;">View on Google Maps →</a>
       </div>`;

  const html = `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EFE4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:40px 0;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <tr><td style="background:#3D3530;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#D9CEBC;">Gaia Therapy &amp; Wellbeing</p>
    <h1 style="margin:0;font-size:26px;font-weight:300;color:#fff;letter-spacing:.02em;">Your appointment is confirmed</h1>
  </td></tr>

  <tr><td style="background:#fff;padding:40px 40px 32px;">
    <p style="margin:0 0 24px;font-size:16px;color:#3D3530;line-height:1.6;">
      Hi <strong>${firstName}</strong>,<br><br>
      We're looking forward to seeing you. Here are your appointment details:
    </p>

    <div style="background:#F5EFE4;border-radius:10px;padding:28px 32px;margin-bottom:28px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="44" valign="top"><div style="width:36px;height:36px;background:#3D3530;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">📅</div></td>
          <td style="padding-left:14px;">
            <p style="margin:0 0 2px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8C7E6E;">Date &amp; Time</p>
            <p style="margin:0;font-size:17px;font-weight:600;color:#3D3530;">${displayDate} · ${displayTime}</p>
          </td>
        </tr>
        <tr><td colspan="2" style="padding:14px 0;"><hr style="border:none;border-top:1px solid rgba(107,99,73,.2);margin:0;"></td></tr>
        <tr>
          <td width="44" valign="top"><div style="width:36px;height:36px;background:#3D3530;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">👤</div></td>
          <td style="padding-left:14px;">
            <p style="margin:0 0 2px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8C7E6E;">Therapist</p>
            <p style="margin:0;font-size:17px;font-weight:600;color:#3D3530;">${data.preferredTherapistName}</p>
          </td>
        </tr>
        <tr><td colspan="2" style="padding:14px 0;"><hr style="border:none;border-top:1px solid rgba(107,99,73,.2);margin:0;"></td></tr>
        <tr>
          <td width="44" valign="top"><div style="width:36px;height:36px;background:#3D3530;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">${isOnline ? '💻' : '🏢'}</div></td>
          <td style="padding-left:14px;">
            <p style="margin:0 0 2px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8C7E6E;">Session Type</p>
            <p style="margin:0;font-size:17px;font-weight:600;color:#3D3530;">${data.sessionType}</p>
          </td>
        </tr>
      </table>
      ${sessionNote}
    </div>

    <p style="margin:0 0 12px;font-size:14px;color:#3D3530;line-height:1.7;">
      If you have any questions or need to reschedule, please contact us on WhatsApp:
    </p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr><td style="background:#25D366;border-radius:8px;padding:12px 24px;">
        <a href="${GAIA_WHATSAPP}" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Message us on WhatsApp</a>
      </td></tr>
    </table>

    <p style="margin:0;font-size:14px;color:#8C7E6E;line-height:1.7;">
      We look forward to supporting you on your journey.<br>
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

</table></td></tr>
</table>
</body></html>`;

  await m.t.sendMail({
    from:    `"Gaia" <${m.user}>`,
    to:      data.email,
    subject: 'Your Gaia Appointment is Confirmed',
    html,
  });
}

// ── Therapist notification email (auto-booking) ───────────────

async function sendTherapistNotificationEmail(data, therapistEmail) {
  const m = mailer();
  if (!m) { console.error('[submit] sendTherapistNotificationEmail: mailer() unavailable (GMAIL_USER/GMAIL_APP_PASSWORD missing)'); return; }

  const [h, min]    = data.bookedTime.split(':').map(Number);
  const period      = h >= 12 ? 'PM' : 'AM';
  const displayH    = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const displayTime = `${displayH}:${min.toString().padStart(2, '0')} ${period}`;
  const displayDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Africa/Cairo',
  }).format(new Date(data.bookedDate + 'T00:00:00'));

  const firstName = (data.preferredTherapistName || '').split(' ').pop();

  const rows = [
    ['Full Name',          data.fullName],
    ['Age',                data.age],
    ['Phone',              data.phone],
    ['Email',              data.email],
    ['Session Type',       data.sessionType],
    data.country   ? ['Country',        data.country]   : null,
    data.timezone  ? ['Timezone',       data.timezone]  : null,
    ['What brings them in', data.reason],
    ['Goals',              data.goals],
    ['Had therapy before', data.prevTherapy],
    ['On psychiatric meds', data.medication + (data.medicationDetails ? ` — ${data.medicationDetails}` : '')],
    data.diagnoses ? ['Diagnoses',      data.diagnoses] : null,
    ['Language pref.',     data.language],
    data.extra     ? ['Notes',          data.extra]     : null,
  ].filter(Boolean);

  const tableRows = rows.map(([k, v]) => `
    <tr>
      <td style="padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8C7E6E;width:38%;border-bottom:1px solid #EDE5D6;vertical-align:top;">${k}</td>
      <td style="padding:10px 16px;font-size:14px;color:#3D3530;border-bottom:1px solid #EDE5D6;line-height:1.6;">${v}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5EFE4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:40px 0;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <tr><td style="background:#3D3530;border-radius:12px 12px 0 0;padding:32px 40px;">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#D9CEBC;">New Appointment</p>
    <h1 style="margin:0;font-size:22px;font-weight:300;color:#fff;">Hi ${firstName}, you have a new booking</h1>
  </td></tr>

  <tr><td style="background:#6B6349;padding:20px 40px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="color:#fff;">
          <p style="margin:0 0 2px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.75;">Date &amp; Time</p>
          <p style="margin:0;font-size:20px;font-weight:600;">${displayDate} · ${displayTime}</p>
        </td>
        <td align="right" style="color:#fff;">
          <p style="margin:0 0 2px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.75;">Session</p>
          <p style="margin:0;font-size:20px;font-weight:600;">${data.sessionType}</p>
        </td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="background:#fff;padding:32px 40px 24px;">
    <p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6B6349;">Client Information</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EDE5D6;border-radius:8px;overflow:hidden;">
      ${tableRows}
    </table>
  </td></tr>

  <tr><td style="background:#3D3530;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#D9CEBC;">Gaia Therapy &amp; Wellbeing</p>
  </td></tr>

</table></td></tr>
</table>
</body></html>`;

  await m.t.sendMail({
    from:    `"Gaia" <${m.user}>`,
    to:      therapistEmail,
    subject: `New Appointment: ${data.fullName} — ${displayDate} at ${displayTime}`,
    html,
  });
}

// ── Manual submission acknowledgement (not-sure patients) ─────

async function sendManualAcknowledgementEmail(data) {
  const m = mailer();
  if (!m) { console.error('[submit] sendManualAcknowledgementEmail: mailer() unavailable (GMAIL_USER/GMAIL_APP_PASSWORD missing)'); return; }
  if (!data.email) { console.error('[submit] sendManualAcknowledgementEmail: no email address on submission'); return; }

  const firstName = data.fullName.split(' ')[0];

  const html = `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EFE4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:40px 0;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <tr><td style="background:#3D3530;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#D9CEBC;">Gaia Therapy &amp; Wellbeing</p>
    <h1 style="margin:0;font-size:26px;font-weight:300;color:#fff;letter-spacing:.02em;">We've received your request</h1>
  </td></tr>

  <tr><td style="background:#fff;padding:40px 40px 32px;">
    <p style="margin:0 0 24px;font-size:16px;color:#3D3530;line-height:1.7;">
      Hi <strong>${firstName}</strong>,<br><br>
      Thank you for reaching out to Gaia. We've received your information and a member of our team will be in touch with you within <strong>48 hours</strong> to help match you with the right therapist and schedule your session.
    </p>

    <div style="background:#F5EFE4;border-left:4px solid #6B6349;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:28px;">
      <p style="margin:0;font-size:14px;color:#3D3530;line-height:1.7;">
        In the meantime, if you have any questions or need to speak with someone sooner, please don't hesitate to reach out to us directly on WhatsApp.
      </p>
    </div>

    <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr><td style="background:#25D366;border-radius:8px;padding:12px 24px;">
        <a href="${GAIA_WHATSAPP}" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Message us on WhatsApp</a>
      </td></tr>
    </table>

    <p style="margin:0;font-size:14px;color:#8C7E6E;line-height:1.7;">
      We look forward to supporting you on your journey.<br>
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

</table></td></tr>
</table>
</body></html>`;

  await m.t.sendMail({
    from:    `"Gaia" <${m.user}>`,
    to:      data.email,
    subject: 'We received your request — Gaia',
    html,
  });
}
