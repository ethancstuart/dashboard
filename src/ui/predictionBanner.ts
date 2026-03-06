import { createElement } from '../utils/dom.ts';
import { fetchPredictions } from '../services/prediction.ts';
import type { PredictionMarket } from '../types/index.ts';

const REFRESH_INTERVAL = 300000;
const SCROLL_SPEED = 0.25; // pixels per frame

export function initPredictionBanner(container: HTMLElement): void {
  const track = createElement('div', { className: 'prediction-track' });
  container.appendChild(track);

  let animationId: number | null = null;
  let offset = 0;

  function renderCards(markets: PredictionMarket[]) {
    track.textContent = '';
    if (markets.length === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';

    // Duplicate the cards so the scroll loops seamlessly
    const allMarkets = [...markets, ...markets];
    for (const m of allMarkets) {
      track.appendChild(createCard(m));
    }

    offset = 0;
    startScroll(markets.length);
  }

  function startScroll(originalCount: number) {
    if (animationId) cancelAnimationFrame(animationId);

    function step() {
      offset += SCROLL_SPEED;

      // When we've scrolled past the first set, reset seamlessly
      const halfWidth = track.scrollWidth / 2;
      if (halfWidth > 0 && offset >= halfWidth) {
        offset -= halfWidth;
      }

      track.style.transform = `translateX(-${offset}px)`;
      animationId = requestAnimationFrame(step);
    }

    animationId = requestAnimationFrame(step);
  }

  // Pause on hover
  container.addEventListener('mouseenter', () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  });

  container.addEventListener('mouseleave', () => {
    // Restart — get count from track children / 2
    const total = track.children.length;
    if (total > 0) startScroll(total / 2);
  });

  async function loadData() {
    try {
      const allMarkets = await fetchPredictions();
      // Filter out predictions with overly long questions
      const markets = allMarkets.filter((m) => cleanQuestion(m.question).length <= 100);
      if (markets.length > 0) {
        renderCards(markets);
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

function cleanQuestion(q: string): string {
  // Strip leading "Yes" / "No" / "Yes:" / "No:" prefixes from Kalshi-style titles
  let cleaned = q.replace(/^(Yes|No)\s*[:\-]?\s*/i, '').trim();
  // Capitalize first letter after stripping
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

function createCard(m: PredictionMarket): HTMLElement {
  const card = createElement('div', { className: 'prediction-card' });

  let questionText = cleanQuestion(m.question);
  if (questionText.length > 90) {
    questionText = questionText.slice(0, 87) + '\u2026';
  }
  const question = createElement('span', {
    className: 'prediction-card-question',
    textContent: questionText,
  });

  const right = createElement('div', { className: 'prediction-card-right' });

  const prob = createElement('span', {
    className: `prediction-card-prob ${getProbClass(m.probability)}`,
    textContent: `${Math.round(m.probability)}%`,
  });

  const source = createElement('span', {
    className: 'prediction-card-source',
    textContent: m.source === 'polymarket' ? 'Polymarket' : 'Kalshi',
  });

  right.appendChild(prob);
  right.appendChild(source);

  card.appendChild(question);
  card.appendChild(right);

  card.addEventListener('click', () => {
    window.open(m.url, '_blank', 'noopener');
  });

  return card;
}

function getProbClass(prob: number): string {
  if (prob >= 70) return 'prediction-prob-high';
  if (prob >= 40) return 'prediction-prob-mid';
  return 'prediction-prob-low';
}
