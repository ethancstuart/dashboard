import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'edge' };

const VALID_TABS = new Set(['trending', 'movies', 'tv', 'upcoming']);

const TAB_ENDPOINTS: Record<string, string> = {
  trending: '/trending/all/day',
  movies: '/movie/now_playing',
  tv: '/tv/popular',
  upcoming: '/movie/upcoming',
};

const TAB_MEDIA_TYPE: Record<string, 'movie' | 'tv'> = {
  movies: 'movie',
  upcoming: 'movie',
  tv: 'tv',
};

interface TMDBResult {
  id: number;
  title?: string;
  name?: string;
  media_type?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  overview: string;
  genre_ids: number[];
}

export default async function handler(req: VercelRequest, _res: VercelResponse) {
  const url = new URL(req.url!, 'https://localhost');
  const tab = url.searchParams.get('tab') || 'trending';

  if (!VALID_TABS.has(tab)) {
    return new Response(JSON.stringify({ error: 'Invalid tab' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'TMDB API key not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const endpoint = TAB_ENDPOINTS[tab];
    const resp = await fetch(
      `https://api.themoviedb.org/3${endpoint}?api_key=${apiKey}&language=en-US&page=1`,
    );
    const data = await resp.json();

    const items = (data.results as TMDBResult[])
      .filter((r) => r.media_type !== 'person')
      .slice(0, 20)
      .map((r) => {
        const mediaType = tab === 'trending' ? (r.media_type as 'movie' | 'tv') : TAB_MEDIA_TYPE[tab];
        const dateStr = r.release_date || r.first_air_date || '';
        return {
          id: r.id,
          title: r.title || r.name || '',
          mediaType,
          posterPath: r.poster_path,
          year: dateStr ? dateStr.slice(0, 4) : '',
          rating: r.vote_average,
          overview: r.overview ? r.overview.slice(0, 200) : '',
          genreIds: r.genre_ids || [],
        };
      });

    return new Response(JSON.stringify({ items, tab, fetchedAt: Date.now() }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=600',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch entertainment data';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
