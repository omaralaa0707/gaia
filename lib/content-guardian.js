function stripTags(value) {
  // Remove paired tags with their content (e.g., <script>...</script>)
  // Then remove any remaining unpaired tags
  return String(value)
    .replace(/<(\w+)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]*>/g, '');
}

function isAllowedImageUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.startsWith('/uploads/')) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    return url.hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

function validateSlotChange(manifest, slotId, type, value) {
  const slotMeta = manifest[slotId];
  if (!slotMeta) {
    return { ok: false, reason: 'unknown_slot' };
  }

  if (type !== slotMeta.type) {
    return { ok: false, reason: 'type_mismatch' };
  }

  if (typeof value !== 'string') {
    return { ok: false, reason: 'invalid_value' };
  }

  if (slotMeta.type === 'image') {
    if (!isAllowedImageUrl(value)) {
      return { ok: false, reason: 'invalid_image_url' };
    }
    if (value.length > slotMeta.maxLength) {
      return { ok: false, reason: 'too_long' };
    }
    return { ok: true, sanitizedValue: value };
  }

  // text (and html, which for v1 is treated identically - no html slots are
  // seeded yet, but the type exists in the schema for future use)
  if (value.length > slotMeta.maxLength * 10) {
    return { ok: false, reason: 'too_long' };
  }
  const sanitized = stripTags(value);
  if (sanitized.length > slotMeta.maxLength) {
    return { ok: false, reason: 'too_long' };
  }
  return { ok: true, sanitizedValue: sanitized };
}

module.exports = { validateSlotChange };
