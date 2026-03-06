import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'edge' };

const LEAGUE_URLS: Record<string, { scoreboard: string; news: string }> = {
  nba: {
    scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
    news: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news',
  },
  nfl: {
    scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
    news: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news',
  },
  mlb: {
    scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
    news: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news',
  },
  epl: {
    scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
    news: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/news',
  },
};

const VALID_LEAGUES = new Set(Object.keys(LEAGUE_URLS));

interface ESPNCompetitor {
  id: string;
  team: {
    id: string;
    displayName: string;
    abbreviation: string;
    logo: string;
  };
  score: string;
  records?: { summary: string }[];
  homeAway: 'home' | 'away';
}

interface ESPNCompetition {
  id: string;
  competitors: ESPNCompetitor[];
  status: {
    type: { state: string; detail: string };
  };
  broadcasts?: { names: string[] }[];
  venue?: { fullName: string };
  startDate: string;
}

interface ESPNEvent {
  id: string;
  competitions: ESPNCompetition[];
}

interface ESPNArticle {
  headline: string;
  links: { web: { href: string } };
  published: string;
}

function mapStatus(state: string): 'scheduled' | 'in_progress' | 'final' {
  if (state === 'in') return 'in_progress';
  if (state === 'post') return 'final';
  return 'scheduled';
}

function transformScoreboard(league: string, data: { events?: ESPNEvent[] }) {
  const events = data.events || [];
  const games = events.map((event) => {
    const comp = event.competitions[0];
    const home = comp.competitors.find((c) => c.homeAway === 'home')!;
    const away = comp.competitors.find((c) => c.homeAway === 'away')!;
    const broadcasts = comp.broadcasts?.flatMap((b) => b.names) || [];

    return {
      id: event.id,
      league,
      status: mapStatus(comp.status.type.state),
      statusDetail: comp.status.type.detail,
      startTime: comp.startDate,
      homeTeam: {
        id: home.team.id,
        name: home.team.displayName,
        abbreviation: home.team.abbreviation,
        logo: home.team.logo,
        score: home.score ? parseInt(home.score, 10) : null,
        record: home.records?.[0]?.summary,
      },
      awayTeam: {
        id: away.team.id,
        name: away.team.displayName,
        abbreviation: away.team.abbreviation,
        logo: away.team.logo,
        score: away.score ? parseInt(away.score, 10) : null,
        record: away.records?.[0]?.summary,
      },
      broadcast: undefined,
      venue: comp.venue?.fullName,
    };
  });

  return games;
}

function transformHeadlines(data: { articles?: ESPNArticle[] }) {
  return (data.articles || []).slice(0, 5).map((a) => ({
    title: a.headline,
    link: a.links?.web?.href || '',
    source: 'ESPN',
    published: a.published,
  }));
}

export default async function handler(req: VercelRequest, _res: VercelResponse) {
  const url = new URL(req.url!, 'https://localhost');
  const league = url.searchParams.get('league') || 'nba';
  const action = url.searchParams.get('action') || 'scoreboard';

  if (!VALID_LEAGUES.has(league)) {
    return new Response(JSON.stringify({ error: 'Invalid league' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const urls = LEAGUE_URLS[league];

    if (action === 'headlines') {
      const resp = await fetch(urls.news);
      const data = await resp.json();
      const headlines = transformHeadlines(data);
      return new Response(JSON.stringify({ league, headlines, fetchedAt: Date.now() }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=300',
        },
      });
    }

    // Default: scoreboard
    const resp = await fetch(urls.scoreboard);
    const data = await resp.json();
    const games = transformScoreboard(league, data);

    // Also fetch headlines in parallel for combined response
    let headlines: { title: string; link: string; source: string; published: string }[] = [];
    try {
      const newsResp = await fetch(urls.news);
      const newsData = await newsResp.json();
      headlines = transformHeadlines(newsData);
    } catch {
      // Headlines are optional
    }

    return new Response(JSON.stringify({ league, games, headlines, fetchedAt: Date.now() }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=30',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch sports data';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
