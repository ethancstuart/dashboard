import { fetchWithRetry } from '../utils/fetch.ts';
import type { SocialPost } from '../types/index.ts';

export async function fetchSocialFeed(): Promise<SocialPost[]> {
  const res = await fetchWithRetry('/api/social');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.posts as SocialPost[];
}
