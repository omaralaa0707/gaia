const fs = require('fs');
const nodemailer = require('nodemailer');
const { formidable } = require('formidable');

// Public endpoint — no auth required.
// Receives a job application (with CV attachment) and emails it via nodemailer.
//
// NOTE(owner): ported for parity with ACPP's careers flow, but Gaia's
// marketing site has no join-our-team.html form yet to submit to this
// endpoint. This is a no-op until that page exists — let me know if you
// want a careers page built for Gaia too.

const RECIPIENT = 'PLACEHOLDER@gmail.com'; // TODO(owner): who receives applications
const MAX_CV_BYTES = 10 * 1024 * 1024; // 10 MB

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let fields, files;
  try {
    ({ fields, files } = await parseForm(req));
  } catch (err) {
    console.error('[join-team] form parse failed:', err.message);
    return res.status(400).json({ error: 'Could not process the submitted form.' });
  }

  const fullName     = firstValue(fields['Full Name']);
  const email        = firstValue(fields['Email']);
  const phone        = firstValue(fields['Phone']);
  const coverLetter  = firstValue(fields['Cover Letter']);
  const department   = firstValue(fields['Department']);
  const role         = firstValue(fields['Role Applied For']);

  if (!fullName || !email || !phone || !coverLetter || !department || !role) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const cvFile = firstValue(files['CV']);
  if (!cvFile) {
    return res.status(400).json({ error: 'A CV file is required.' });
  }
  if (cvFile.size > MAX_CV_BYTES) {
    return res.status(400).json({ error: 'CV file is too large (max 10 MB).' });
  }

  const m = mailer();
  if (!m) {
    console.error('[join-team] mailer() unavailable (GMAIL_USER/GMAIL_APP_PASSWORD missing)');
    return res.status(500).json({ error: 'Email service is not configured. Please try again later.' });
  }

  try {
    await m.transporter.sendMail({
      from:    `"Gaia Careers" <${m.user}>`,
      to:      RECIPIENT,
      replyTo: email,
      subject: `New ${department} Job Application | Gaia — ${fullName}`,
      html:    buildApplicationEmailHtml({ fullName, email, phone, coverLetter, department, role }),
      attachments: [{
        filename: cvFile.originalFilename || 'CV',
        content:  fs.readFileSync(cvFile.filepath),
      }],
    });
  } catch (err) {
    console.error('[join-team] sendMail failed:', err.message);
    return res.status(500).json({ error: 'Could not send the application. Please try again or email us directly.' });
  }

  return res.status(200).json({ status: 'ok' });
};

function firstValue(v) {
  return Array.isArray(v) ? v[0] : v;
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: MAX_CV_BYTES });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function mailer() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return {
    transporter: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }),
    user,
  };
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildApplicationEmailHtml({ fullName, email, phone, coverLetter, department, role }) {
  const rows = [
    ['Department', department],
    ['Role Applied For', role],
    ['Full Name', fullName],
    ['Email', email],
    ['Phone', phone],
  ].map(([label, value]) => `
    <tr>
      <td style="padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8C7E6E;width:38%;border-bottom:1px solid #EDE5D6;vertical-align:top;">${esc(label)}</td>
      <td style="padding:10px 16px;font-size:14px;color:#3D3530;border-bottom:1px solid #EDE5D6;line-height:1.6;">${esc(value)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EFE4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:40px 0;">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

    <tr><td style="background:#3D3530;border-radius:12px 12px 0 0;padding:32px 40px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#D9CEBC;">New Job Application</p>
      <h1 style="margin:0;font-size:22px;font-weight:300;color:#ffffff;">${esc(fullName)}</h1>
    </td></tr>

    <tr><td style="background:#ffffff;padding:32px 40px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EDE5D6;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${rows}
      </table>
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8C7E6E;">Cover Letter</p>
      <p style="margin:0;font-size:14px;color:#3D3530;line-height:1.7;white-space:pre-wrap;">${esc(coverLetter)}</p>
    </td></tr>

    <tr><td style="background:#3D3530;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#D9CEBC;">CV attached · Reply-To is set to the applicant's email</p>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}
