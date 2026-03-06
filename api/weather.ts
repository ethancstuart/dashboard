import type { VercelRequest, VercelResponse } from '@vercel/node';

interface ForecastDay {
  day: string;
  icon: string;
  high: number;
  low: number;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const config = { runtime: 'nodejs' };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action as string | undefined;

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Weather API key not configured' });
  }

  try {
    if (action === 'geocode') {
      return await handleGeocode(req, res, apiKey);
    }
    return await handleWeather(req, res, apiKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(502).json({ error: message });
  }
}

async function handleGeocode(req: VercelRequest, res: VercelResponse, apiKey: string) {
  const q = req.query.q as string | undefined;
  if (!q) {
    return res.status(400).json({ error: 'Missing q parameter' });
  }

  const response = await fetch(
    `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=5&appid=${apiKey}`,
  );
  if (!response.ok) {
    return res.status(response.status).json({ error: 'Geocoding request failed' });
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    return res.status(404).json({ error: 'Location not found' });
  }

  // Pick the result whose name best matches the query
  const queryLower = q.toLowerCase();
  const match =
    data.find((r: { name: string }) => r.name.toLowerCase() === queryLower) ??
    data.find((r: { name: string; state?: string }) =>
      r.name.toLowerCase().includes(queryLower) ||
      queryLower.includes(r.name.toLowerCase()) ||
      (r.state && r.state.toLowerCase().includes(queryLower)),
    ) ??
    data[0];

  const { name, lat, lon, country } = match;
  return res.setHeader('Cache-Control', 'max-age=1800').json({ name, lat, lon, country });
}

async function handleWeather(req: VercelRequest, res: VercelResponse, apiKey: string) {
  const lat = req.query.lat as string | undefined;
  const lon = req.query.lon as string | undefined;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'Missing lat/lon parameters' });
  }
  // Validate numeric range
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (isNaN(latNum) || isNaN(lonNum) || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
    return res.status(400).json({ error: 'Invalid lat/lon values' });
  }

  const [currentRes, forecastRes] = await Promise.all([
    fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`,
    ),
    fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`,
    ),
  ]);

  if (!currentRes.ok) {
    return res.status(currentRes.status).json({ error: 'Weather request failed' });
  }
  if (!forecastRes.ok) {
    return res.status(forecastRes.status).json({ error: 'Forecast request failed' });
  }

  const current = await currentRes.json();
  const forecastData = await forecastRes.json();

  // Build 5-day forecast from 5-day/3-hour data
  const dailyMap = new Map<string, { highs: number[]; lows: number[]; icon: string }>();
  const todayDate = new Date().toDateString();

  // Extract hourly data (next 12 data points = 36 hours of 3-hour intervals)
  const hourly: { time: number; temp: number }[] = [];
  for (const entry of forecastData.list) {
    if (hourly.length >= 12) break;
    hourly.push({ time: entry.dt, temp: Math.round(entry.main.temp) });
  }

  for (const entry of forecastData.list) {
    const date = new Date(entry.dt * 1000);
    if (date.toDateString() === todayDate) continue;

    const key = date.toDateString();
    if (!dailyMap.has(key)) {
      dailyMap.set(key, { highs: [], lows: [], icon: entry.weather[0].icon });
    }
    const day = dailyMap.get(key)!;
    day.highs.push(entry.main.temp_max);
    day.lows.push(entry.main.temp_min);
    // Prefer daytime icon
    if (entry.weather[0].icon.endsWith('d')) {
      day.icon = entry.weather[0].icon;
    }
  }

  const forecast: ForecastDay[] = [];
  for (const [dateStr, data] of dailyMap) {
    if (forecast.length >= 5) break;
    const date = new Date(dateStr);
    forecast.push({
      day: DAYS[date.getDay()],
      icon: data.icon,
      high: Math.round(Math.max(...data.highs)),
      low: Math.round(Math.min(...data.lows)),
    });
  }

  return res.setHeader('Cache-Control', 'max-age=1800').json({
    name: current.name,
    current: {
      temp: Math.round(current.main.temp),
      feelsLike: Math.round(current.main.feels_like),
      condition: current.weather[0].description,
      icon: current.weather[0].icon,
      high: Math.round(current.main.temp_max),
      low: Math.round(current.main.temp_min),
      sunrise: current.sys.sunrise,
      sunset: current.sys.sunset,
      humidity: current.main.humidity,
      windSpeed: Math.round(current.wind.speed),
      windDirection: current.wind.deg ?? 0,
      pressure: current.main.pressure,
      visibility: current.visibility ?? 10000,
    },
    hourly,
    forecast,
  });
}
