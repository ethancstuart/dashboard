import { fetchWithRetry } from '../utils/fetch.ts';
import type { WeatherData, GeocodingResult } from '../types/index.ts';

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const res = await fetchWithRetry(`/api/weather?lat=${lat}&lon=${lon}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as WeatherData;
}

export async function geocodeCity(query: string): Promise<GeocodingResult> {
  const res = await fetchWithRetry(
    `/api/weather?action=geocode&q=${encodeURIComponent(query)}`,
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as GeocodingResult;
}
