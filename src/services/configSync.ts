const SENSITIVE_KEYS = ['dashview-user', 'dashview-session'];
const SKIP_SYNC_KEYS = ['dashview-analytics', 'dashview-chat-messages', 'dashview:onboarding', 'dashview:install-dismissed', 'dashview-last-visit'];
const CONFIG_VERSION = 1;

interface ExportedConfig {
  version: number;
  timestamp: number;
  data: Record<string, unknown>;
}

/** Gather all syncable dashview preferences from localStorage. */
export function gatherSyncablePrefs(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('dashview')) continue;
    if (SENSITIVE_KEYS.some((s) => key.includes(s))) continue;
    if (key.toLowerCase().includes('api') && key.toLowerCase().includes('key')) continue;
    if (SKIP_SYNC_KEYS.includes(key)) continue;

    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) data[key] = JSON.parse(raw);
    } catch {
      const raw = localStorage.getItem(key);
      if (raw !== null) data[key] = raw;
    }
  }
  return data;
}

export function exportConfig(includeAnalytics = false): void {
  const data = gatherSyncablePrefs();
  // Re-add analytics if opted in (it's excluded from sync by default)
  if (includeAnalytics) {
    try {
      const raw = localStorage.getItem('dashview-analytics');
      if (raw) data['dashview-analytics'] = JSON.parse(raw);
    } catch { /* ignore */ }
  }

  const exported: ExportedConfig = {
    version: CONFIG_VERSION,
    timestamp: Date.now(),
    data,
  };

  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dashpulse-config-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importConfig(file: File): Promise<{ success: boolean; message: string }> {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as ExportedConfig;

    if (!parsed.version || !parsed.data || typeof parsed.data !== 'object') {
      return { success: false, message: 'Invalid config file format' };
    }

    let count = 0;
    for (const [key, value] of Object.entries(parsed.data)) {
      // Validate key format
      if (!key.startsWith('dashview')) continue;

      // Never import sensitive data
      if (SENSITIVE_KEYS.some((s) => key.includes(s))) continue;
      if (key.toLowerCase().includes('api') && key.toLowerCase().includes('key')) continue;

      // Sanitize string values
      const sanitized = sanitizeValue(value);
      localStorage.setItem(key, typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized));
      count++;
    }

    return { success: true, message: `Imported ${count} settings. Reload to apply.` };
  } catch {
    return { success: false, message: 'Failed to parse config file' };
  }
}

export async function shareConfig(): Promise<{ code: string; expiresAt: number }> {
  const data = gatherSyncablePrefs();
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Failed to create share');
  return result as { code: string; expiresAt: number };
}

export async function importSharedConfig(code: string): Promise<{ success: boolean; message: string; preview?: Record<string, unknown> }> {
  const res = await fetch(`/api/share?code=${encodeURIComponent(code)}`);
  const result = await res.json();
  if (!res.ok) return { success: false, message: result.error || 'Share not found' };

  const shareData = result as { data: Record<string, unknown>; createdBy: string; createdAt: number; expiresAt: number };

  // Return preview. The modal will call applySharedConfig to actually apply.
  return { success: true, message: 'Preview ready', preview: shareData.data };
}

export function applySharedConfig(data: Record<string, unknown>): { success: boolean; message: string } {
  let count = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('dashview')) continue;
    if (SENSITIVE_KEYS.some(s => key.includes(s))) continue;
    if (key.toLowerCase().includes('api') && key.toLowerCase().includes('key')) continue;

    const sanitized = sanitizeValue(value);
    localStorage.setItem(key, typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized));
    count++;
  }
  return { success: true, message: `Imported ${count} settings. Reload to apply.` };
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/<[^>]*>/g, '')                          // Strip HTML tags
      .replace(/javascript\s*:/gi, '')                   // Remove javascript: URIs
      .replace(/on\w+\s*=/gi, '')                        // Remove event handler attributes
      .replace(/\\u00[0-9a-f]{2}/gi, '')                 // Remove unicode escapes
      .replace(/&#x?[0-9a-f]+;?/gi, '');                 // Remove HTML entities used for encoding
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      cleaned[k] = sanitizeValue(v);
    }
    return cleaned;
  }
  return value;
}
