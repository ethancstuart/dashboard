import * as storage from './storage.ts';

const INTERESTS_KEY = 'dashview:interests';

export interface UserInterests {
  stocks: string[];
  cities: string[];
  leagues: string[];
  newsCategories: string[];
}

const DEFAULT_INTERESTS: UserInterests = {
  stocks: [],
  cities: [],
  leagues: [],
  newsCategories: [],
};

export function getInterests(): UserInterests {
  return storage.get<UserInterests>(INTERESTS_KEY, DEFAULT_INTERESTS);
}

export function setInterests(interests: UserInterests): void {
  storage.set(INTERESTS_KEY, interests);
}

export function autoPopulateInterests(): void {
  const interests = getInterests();
  let changed = false;

  // Auto-populate from watchlist
  const watchlist = storage.get<string[]>('dashview-watchlist', []);
  if (watchlist.length > 0 && interests.stocks.length === 0) {
    interests.stocks = watchlist;
    changed = true;
  }

  // Auto-populate from weather locations
  const locations = storage.get<{ locations: { name?: string }[] } | null>('dashview-locations', null);
  if (locations?.locations && interests.cities.length === 0) {
    interests.cities = locations.locations
      .filter((l) => l.name)
      .map((l) => l.name!);
    changed = true;
  }

  // Auto-populate from sports league
  const league = storage.get<string>('dashview-sports-league', '');
  if (league && interests.leagues.length === 0) {
    interests.leagues = [league];
    changed = true;
  }

  if (changed) {
    setInterests(interests);
  }
}
