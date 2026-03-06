import { createElement } from '../utils/dom.ts';
import { fetchPredictions } from '../services/prediction.ts';
import type { PredictionMarket } from '../types/index.ts';

const ROTATE_INTERVAL = 6000;
const REFRESH_INTERVAL = 300000;

export function initPredictionBanner(container: HTMLElement): void {
  let markets: PredictionMarket[] = [];
  let currentIndex = 0;
  let rotateTimer: ReturnType<typeof setInterval> | null = null;

  const track = createElement('div', { className: 'prediction-track' });
  container.appendChild(track);

  function renderSlide() {
    if (markets.length === 0) {
      track.textContent = '';
      return;
    }

    const m = markets[currentIndex % markets.length];

    track.classList.remove('prediction-slide-in');
    void track.offsetWidth; // force reflow
    track.classList.add('prediction-slide-in');

    track.textContent = '';

    const question = createElement('span', {
      className: 'prediction-question',
      textContent: m.question,
    });

    const prob = createElement('span', {
      className: `prediction-prob ${getProbClass(m.probability)}`,
      textContent: `${Math.round(m.probability)}%`,
    });

    const source = createElement('span', {
      className: 'prediction-source',
      textContent: m.source === 'polymarket' ? 'Polymarket' : 'Kalshi',
    });

    const dots = createElement('span', { className: 'prediction-dots' });
    for (let i = 0; i < Math.min(markets.length, 8); i++) {
      const dot = createElement('span', {
        className: `prediction-dot ${i === currentIndex % markets.length ? 'prediction-dot-active' : ''}`,
      });
      dots.appendChild(dot);
    }

    track.appendChild(question);
    track.appendChild(prob);
    track.appendChild(source);
    track.appendChild(dots);
  }

  function startRotation() {
    if (rotateTimer) clearInterval(rotateTimer);
    rotateTimer = setInterval(() => {
      currentIndex++;
      renderSlide();
    }, ROTATE_INTERVAL);
  }

  async function loadData() {
    try {
      markets = await fetchPredictions();
      if (markets.length > 0) {
        container.style.display = '';
        currentIndex = 0;
        renderSlide();
        startRotation();
      } else {
        container.style.display = 'none';
      }
    } catch {
      container.style.display = 'none';
    }
  }

  void loadData();
  setInterval(() => void loadData(), REFRESH_INTERVAL);
}

function getProbClass(prob: number): string {
  if (prob >= 70) return 'prediction-prob-high';
  if (prob >= 40) return 'prediction-prob-mid';
  return 'prediction-prob-low';
}
