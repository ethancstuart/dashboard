import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchScoreboard } from '../services/sports.ts';
import * as storage from '../services/storage.ts';
import type { SportsLeague, SportsData, SportsGame, SportsHeadline } from '../types/index.ts';

const LEAGUE_KEY = 'dashview-sports-league';
const FAVORITES_KEY = 'dashview-sports-favorites';

const LEAGUES: { id: SportsLeague; label: string }[] = [
  { id: 'nba', label: 'NBA' },
  { id: 'nfl', label: 'NFL' },
  { id: 'mlb', label: 'MLB' },
  { id: 'epl', label: 'EPL' },
];

export class SportsPanel extends Panel {
  private league: SportsLeague;
  private data: SportsData | null = null;
  private favorites: Set<string>;

  getLastData(): SportsData | null {
    return this.data;
  }

  constructor() {
    super({
      id: 'sports',
      title: 'Sports',
      enabled: true,
      refreshInterval: 60000,
      priority: 2,
    });
    this.league = storage.get<SportsLeague>(LEAGUE_KEY, 'nba');
    this.favorites = new Set(storage.get<string[]>(FAVORITES_KEY, []));
  }

  private toggleFavorite(abbreviation: string): void {
    if (this.favorites.has(abbreviation)) {
      this.favorites.delete(abbreviation);
    } else {
      this.favorites.add(abbreviation);
    }
    storage.set(FAVORITES_KEY, [...this.favorites]);
    this.render(this.data);
  }

  async fetchData(): Promise<void> {
    this.data = await fetchScoreboard(this.league);
    this.render(this.data);
  }

  render(_data: unknown): void {
    this.contentEl.textContent = '';

    // League tabs
    const tabs = createElement('div', { className: 'news-tabs' });
    for (const lg of LEAGUES) {
      const btn = createElement('button', {
        className: `news-tab ${lg.id === this.league ? 'news-tab-active' : ''}`,
        textContent: lg.label,
      });
      btn.addEventListener('click', () => {
        if (lg.id === this.league) return;
        this.league = lg.id;
        storage.set(LEAGUE_KEY, this.league);
        void this.fetchData();
      });
      tabs.appendChild(btn);
    }
    this.contentEl.appendChild(tabs);

    if (!this.data) return;

    // Scoreboard
    if (this.data.games.length > 0) {
      const scoreboard = createElement('div', { className: 'sports-scoreboard' });

      if (this.favorites.size > 0) {
        const favGames = this.data.games.filter(
          (g) => this.favorites.has(g.homeTeam.abbreviation) || this.favorites.has(g.awayTeam.abbreviation),
        );
        const otherGames = this.data.games.filter(
          (g) => !this.favorites.has(g.homeTeam.abbreviation) && !this.favorites.has(g.awayTeam.abbreviation),
        );

        if (favGames.length > 0) {
          scoreboard.appendChild(createElement('div', { className: 'sports-section-label', textContent: 'FAVORITES' }));
          for (const game of favGames) scoreboard.appendChild(this.createGameRow(game));
        }
        if (otherGames.length > 0) {
          scoreboard.appendChild(createElement('div', { className: 'sports-section-label', textContent: 'ALL GAMES' }));
          for (const game of otherGames) scoreboard.appendChild(this.createGameRow(game));
        }
      } else {
        for (const game of this.data.games) {
          scoreboard.appendChild(this.createGameRow(game));
        }
      }

      this.contentEl.appendChild(scoreboard);
    } else {
      const empty = createElement('div', { className: 'panel-empty-state', textContent: 'No games scheduled today.' });
      this.contentEl.appendChild(empty);
    }

    // Headlines
    if (this.data.headlines.length > 0) {
      const headlinesSection = createElement('div', { className: 'sports-headlines' });
      const headlinesTitle = createElement('div', {
        className: 'stocks-section-header',
        textContent: 'Headlines',
      });
      headlinesSection.appendChild(headlinesTitle);
      for (const h of this.data.headlines.slice(0, 5)) {
        headlinesSection.appendChild(this.createHeadlineRow(h));
      }
      this.contentEl.appendChild(headlinesSection);
    }
  }

  private createGameRow(game: SportsGame): HTMLElement {
    const row = createElement('div', { className: 'sports-game' });

    const isLive = game.status === 'in_progress';
    const isFinal = game.status === 'final';

    // Status column
    const statusCol = createElement('div', { className: 'sports-status-col' });
    if (isLive) {
      const dot = createElement('span', { className: 'sports-live-dot' });
      statusCol.appendChild(dot);
    }
    const statusText = createElement('span', {
      className: `sports-status ${isLive ? 'sports-status-live' : ''} ${isFinal ? 'sports-status-final' : ''}`,
      textContent: game.statusDetail,
    });
    statusCol.appendChild(statusText);
    row.appendChild(statusCol);

    // Teams + scores
    const matchup = createElement('div', { className: 'sports-matchup' });
    matchup.appendChild(this.createTeamRow(game.awayTeam, isLive));
    matchup.appendChild(this.createTeamRow(game.homeTeam, isLive));
    row.appendChild(matchup);

    return row;
  }

  private createTeamRow(team: { name: string; abbreviation: string; logo: string; score: number | null; record?: string }, isLive: boolean): HTMLElement {
    const row = createElement('div', { className: 'sports-team-row' });

    const isFav = this.favorites.has(team.abbreviation);
    const star = createElement('button', {
      className: `sports-fav-btn ${isFav ? 'active' : ''}`,
      textContent: isFav ? '\u2605' : '\u2606',
    });
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFavorite(team.abbreviation);
    });
    row.appendChild(star);

    const logo = document.createElement('img');
    logo.src = team.logo;
    logo.alt = team.abbreviation;
    logo.className = 'sports-team-logo';
    logo.width = 24;
    logo.height = 24;
    logo.loading = 'lazy';
    row.appendChild(logo);

    const name = createElement('span', {
      className: 'sports-team-name',
      textContent: team.abbreviation,
    });
    row.appendChild(name);

    if (team.record) {
      const record = createElement('span', {
        className: 'sports-team-record',
        textContent: `(${team.record})`,
      });
      row.appendChild(record);
    }

    const spacer = createElement('div', { className: 'sports-team-spacer' });
    row.appendChild(spacer);

    if (team.score !== null) {
      const score = createElement('span', {
        className: `sports-score ${isLive ? 'sports-score-live' : ''}`,
        textContent: String(team.score),
      });
      row.appendChild(score);
    }

    return row;
  }

  private createHeadlineRow(headline: SportsHeadline): HTMLElement {
    const row = createElement('div', { className: 'sports-headline' });

    const link = document.createElement('a');
    link.href = headline.link;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'sports-headline-link';
    link.textContent = headline.title;
    row.appendChild(link);

    if (headline.published) {
      const time = this.relativeTime(headline.published);
      if (time) {
        const meta = createElement('span', {
          className: 'sports-headline-time',
          textContent: time,
        });
        row.appendChild(meta);
      }
    }

    return row;
  }

  private relativeTime(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    if (isNaN(then)) return '';
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
