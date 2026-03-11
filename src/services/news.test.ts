import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/fetch.ts', () => ({
  fetchWithRetry: vi.fn(),
}));

import { fetchNews } from './news.ts';
import { fetchWithRetry } from '../utils/fetch.ts';

beforeEach(() => {
  vi.mocked(fetchWithRetry).mockReset();
});

describe('fetchNews', () => {
  it('builds correct URL with category param', async () => {
    const mockData = { articles: [], category: 'tech', fetchedAt: 1000 };
    vi.mocked(fetchWithRetry).mockResolvedValue({
      json: () => Promise.resolve(mockData),
    } as unknown as Response);

    const result = await fetchNews('tech');

    expect(fetchWithRetry).toHaveBeenCalledWith('/api/news?category=tech');
    expect(result).toEqual(mockData);
  });

  it('throws on { error: "..." } response', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      json: () => Promise.resolve({ error: 'Bad request' }),
    } as unknown as Response);

    await expect(fetchNews('us')).rejects.toThrow('Bad request');
  });

  it('propagates network errors', async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(new Error('Network failure'));

    await expect(fetchNews('world')).rejects.toThrow('Network failure');
  });
});
