/** Embed pause state lives on widget_settings.is_active (the model has no top-level field). */
export function isEmbedPaused(embed) {
  return embed?.widget_settings?.is_active === false;
}

/** Merge a PATCH into the stored widget settings so keys that were not sent are kept. */
export function mergeEmbedWidgetSettings(existingSettings, patch = {}) {
  const base = existingSettings && typeof existingSettings === 'object' ? { ...existingSettings } : {};
  if (patch.widget_settings && typeof patch.widget_settings === 'object' && !Array.isArray(patch.widget_settings)) {
    Object.assign(base, patch.widget_settings);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'is_active')) {
    base.is_active = Boolean(patch.is_active);
  }
  return base;
}

/** Owner-facing shape: the stored embed plus a top-level is_active the settings UI reads. */
export function serializeOwnerEmbed(embed) {
  if (!embed) return null;
  const plain = typeof embed.toObject === 'function' ? embed.toObject() : { ...embed };
  return { ...plain, is_active: !isEmbedPaused(plain) };
}
