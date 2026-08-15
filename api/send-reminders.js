const { createClient } = require('@supabase/supabase-js');

// Called once daily by Vercel Cron (Hobby plan doesn't allow hourly crons).
// Sends a reminder email to any confirmed patient whose session is 24-48
// hours away (Cairo time, DST-aware) - a wide window so a single daily run
// still reaches every booking exactly once.

const GAIA_WHATSAPP  = 'https://wa.me/201004636683';
const GAIA_ADDRESS   = 'Gaia Wellbeing, Beverly Hills, Sheikh Zayed, 6 October City';
const GAIA_MAPS_URL  = 'https://www.google.com/maps/place/GAIA+Wellbeing+(Psychotherapy+%26+Yoga+Centre)/@30.0610591,30.9378649,17z/data=!3m1!4b1!4m6!3m5!1s0x1458591b348561f1:0x31a3dcd8d033a9a7!8m2!3d30.0610545!4d30.9404398!16s%2Fg%2F11fszyrrkq?hl=en&entry=ttu';
const GAIA_DOMAIN    = 'gaiatherapy.vercel.app';
const GAIA_INSTAGRAM = 'youaregaia_eg';

module.exports = async function handler(req, res) {
  // Vercel Cron passes Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.authorization || '';
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: bookings, error } = await db
    .from('submissions')
    .select('id, full_name, email, booked_date, booked_time, assigned_therapist, session_type')
    .eq('state', 'Confirmed')
    .eq('reminder_sent', false)
    .not('booked_date', 'is', null)
    .not('email', 'is', null);

  if (error) return res.status(500).json({ error: error.message });

  const now         = Date.now();
  const windowStart = now + 24 * 60 * 60 * 1000;
  const windowEnd   = now + 48 * 60 * 60 * 1000;

  const toRemind = (bookings || []).filter(b => {
    if (!b.booked_date || !b.booked_time) return false;
    const [year, month, day] = b.booked_date.split('-').map(Number);
    const [h, min]           = b.booked_time.split(':').map(Number);
    const offsetMin    = cairoOffsetMinutes(year, month, day);
    const sessionUtcMs = Date.UTC(year, month - 1, day, h, min) - offsetMin * 60000;
    return sessionUtcMs >= windowStart && sessionUtcMs <= windowEnd;
  });

  const results = [];
  for (const b of toRemind) {
    try {
      const sent = await sendReminderEmail(b);
      if (!sent) {
        console.error(`[send-reminders] email not sent for submission ${b.id} (${b.full_name}) - see prior log for reason; reminder_sent NOT set, will retry next run`);
        results.push({ id: b.id, name: b.full_name, status: 'skipped' });
        continue;
      }
      await db.from('submissions').update({ reminder_sent: true }).eq('id', b.id);
      results.push({ id: b.id, name: b.full_name, status: 'sent' });
    } catch (e) {
      console.error(`[send-reminders] error sending to submission ${b.id} (${b.full_name}):`, e.message);
      results.push({ id: b.id, name: b.full_name, status: 'error', error: e.message });
    }
  }

  return res.json({ checked: (bookings || []).length, reminded: toRemind.length, results });
};

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

// ── Reminder email ────────────────────────────────────────────

async function sendReminderEmail(b) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) { console.error(`[send-reminders] GMAIL_USER/GMAIL_APP_PASSWORD missing, cannot send reminder for submission ${b.id}`); return false; }
  if (!b.email) { console.error(`[send-reminders] submission ${b.id} (${b.full_name}) has no email address`); return false; }

  const nodemailer = require('nodemailer');
  const transport  = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });

  const firstName = b.full_name.split(' ')[0];
  const [h, min]           = b.booked_time.split(':').map(Number);
  const period      = h >= 12 ? 'PM' : 'AM';
  const displayH    = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const displayTime = `${displayH}:${min.toString().padStart(2, '0')} ${period}`;
  const displayDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Africa/Cairo',
  }).format(new Date(b.booked_date + 'T00:00:00'));

  const isOnline = b.session_type === 'Online';

  const locationBlock = isOnline
    ? `<div style="background:#EDE5D6;border-left:4px solid #6B6349;border-radius:0 8px 8px 0;padding:14px 16px;margin-top:16px;">
        <p style="margin:0;font-size:13px;color:#3D3530;line-height:1.6;"><strong>Online session:</strong> You will receive your meeting link via email before the session.</p>
       </div>`
    : `<div style="background:#F0F9F0;border-left:4px solid #6B6349;border-radius:0 8px 8px 0;padding:14px 16px;margin-top:16px;">
        <p style="margin:0 0 4px;font-size:13px;color:#3D3530;"><strong>In-person session</strong></p>
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
    <h1 style="margin:0;font-size:26px;font-weight:300;color:#fff;letter-spacing:.02em;">Your session is tomorrow</h1>
  </td></tr>

  <tr><td style="background:#fff;padding:40px 40px 32px;">
    <p style="margin:0 0 24px;font-size:16px;color:#3D3530;line-height:1.7;">
      Hi <strong>${firstName}</strong>,<br><br>
      This is a friendly reminder that your session with Gaia is scheduled for <strong>tomorrow</strong>. We look forward to seeing you.
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
            <p style="margin:0;font-size:17px;font-weight:600;color:#3D3530;">${b.assigned_therapist || 'Your therapist'}</p>
          </td>
        </tr>
        <tr><td colspan="2" style="padding:14px 0;"><hr style="border:none;border-top:1px solid rgba(107,99,73,.2);margin:0;"></td></tr>
        <tr>
          <td width="44" valign="top"><div style="width:36px;height:36px;background:#3D3530;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">${isOnline ? '💻' : '🏢'}</div></td>
          <td style="padding-left:14px;">
            <p style="margin:0 0 2px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8C7E6E;">Session Type</p>
            <p style="margin:0;font-size:17px;font-weight:600;color:#3D3530;">${b.session_type || 'In-person'}</p>
          </td>
        </tr>
      </table>
      ${locationBlock}
    </div>

    <p style="margin:0 0 12px;font-size:14px;color:#3D3530;line-height:1.7;">
      Need to reschedule or have questions? Contact us on WhatsApp:
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

  await transport.sendMail({
    from:    `"Gaia" <${user}>`,
    to:      b.email,
    subject: `Reminder: Your Gaia session is tomorrow at ${displayTime}`,
    html,
  });
  return true;
}
