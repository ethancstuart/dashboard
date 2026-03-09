const ALLOWED_ORIGIN = 'https://dashpulse.app';

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Content-Type': 'application/json',
  };
}
