const SENSITIVE_KEYS = ['dashview-user', 'dashview-session'];
const CONFIG_VERSION = 1;

interface ExportedConfig {
  version: number;
  timestamp: number;
  data: Record<string, unknown>;
}

export function exportConfig(includeAnalytics = false): void {
  const data: Record<string, unknown> = {};

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;

    // Only export dashview keys
    if (!key.startsWith('dashview')) continue;

    // Skip sensitive keys
    if (SENSITIVE_KEYS.some((s) => key.includes(s))) continue;

    // Skip API keys
    if (key.toLowerCase().includes('api') && key.toLowerCase().includes('key')) continue;

    // Skip analytics unless opted in
    if (!includeAnalytics && key === 'dashview-analytics') continue;

    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        data[key] = JSON.parse(raw);
      }
    } catch {
      // Store raw string values
      const raw = localStorage.getItem(key);
      if (raw !== null) data[key] = raw;
    }
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
