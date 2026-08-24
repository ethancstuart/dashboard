import { describe, it, expect } from 'vitest';
import { stat, sectionRule, figure, capture, row, surfaceCss, installSurfaces } from './index.ts';
import { themeTokens } from '../../styles/tokens.ts';

describe('stat — provenance is a contract, not a nicety', () => {
  it('renders value, label and provenance', () => {
    const el = stat({ value: '62,090', label: 'forecasts scored', provenance: 'as of 2026-08-22 · calls table' });
    expect(el.querySelector('.nw-stat__value')?.textContent).toBe('62,090');
    expect(el.querySelector('.nw-stat__label')?.textContent).toBe('forecasts scored');
    expect(el.querySelector('.nw-stat__provenance')?.textContent).toContain('2026-08-22');
  });

  it('REFUSES to render a number with no source', () => {
    // The old map loading screen counted "50 countries · 13 sources" on a
    // timer with every figure wrong. A required provenance slot makes that
    // literally unwriteable.
    expect(() => stat({ value: '158', label: 'countries', provenance: '' })).toThrow(/provenance/);
    expect(() => stat({ value: '158', label: 'countries', provenance: '   ' })).toThrow(/provenance/);
  });

  it('supports three sizes and defaults to section', () => {
    expect(stat({ value: '1', label: 'x', provenance: 'p' }).className).toContain('nw-stat--section');
    expect(stat({ value: '1', label: 'x', provenance: 'p', size: 'hero' }).className).toContain('nw-stat--hero');
  });

  it('escapes nothing by construction — textContent, never innerHTML', () => {
    const el = stat({ value: '<img onerror=x>', label: 'x', provenance: 'p' });
    expect(el.querySelector('.nw-stat__value')?.innerHTML).not.toContain('<img');
  });
});

describe('sectionRule', () => {
  it('renders kicker, title and optional lede', () => {
    const el = sectionRule({
      kicker: 'THE LEDGER',
      title: 'Where we were wrong',
      lede: 'Every call, including the misses.',
    });
    expect(el.querySelector('.nw-section__kicker')?.textContent).toBe('THE LEDGER');
    expect(el.querySelector('.nw-section__title')?.tagName).toBe('H2');
    expect(el.querySelector('.nw-section__lede')?.textContent).toContain('misses');
  });

  it('omits the lede when not given', () => {
    expect(sectionRule({ kicker: 'k', title: 't' }).querySelector('.nw-section__lede')).toBeNull();
  });
});

describe('figure — a chart is a claim and needs a citation', () => {
  it('wraps a plot with title and source', () => {
    const plot = document.createElement('svg');
    const el = figure({ title: 'CALIBRATION', source: 'calls table, 2026-08-22', plot });
    expect(el.tagName).toBe('FIGURE');
    expect(el.querySelector('.nw-figure__plot')?.firstChild).toBe(plot);
    expect(el.querySelector('.nw-figure__source')?.textContent).toContain('calls table');
  });

  it('REFUSES an unattributed chart', () => {
    expect(() => figure({ title: 't', source: '', plot: document.createElement('div') })).toThrow(/source/);
  });
});

describe('capture — one implementation, one endpoint', () => {
  it('renders a form with an email input and a submit button', () => {
    const el = capture({ source: 'ledger' });
    const input = el.querySelector<HTMLInputElement>('.nw-capture__input');
    expect(input?.type).toBe('email');
    expect(input?.required).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('.nw-capture__button')?.type).toBe('submit');
  });

  it('rejects an invalid address without hitting the network', () => {
    const el = capture({ source: 'ledger' });
    const form = el.querySelector<HTMLFormElement>('.nw-capture__form') as HTMLFormElement;
    const input = el.querySelector<HTMLInputElement>('.nw-capture__input') as HTMLInputElement;
    input.value = 'nope';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(el.querySelector('.nw-capture__status')?.textContent).toBe('Enter a valid email.');
  });

  it('has an accessible label and a live status region', () => {
    const el = capture({ source: 'ledger' });
    expect(el.querySelector('.nw-capture__input')?.getAttribute('aria-label')).toBe('Email address');
    expect(el.querySelector('.nw-capture__status')?.getAttribute('role')).toBe('status');
  });
});

describe('row', () => {
  it('renders lead, detail and trail', () => {
    const el = row({ lead: 'IR', detail: 'censorship', trail: '84%' });
    expect(el.querySelector('.nw-row__lead')?.textContent).toBe('IR');
    expect(el.querySelector('.nw-row__trail')?.textContent).toBe('84%');
  });

  it('renders as a real anchor when given a destination, and a div when not', () => {
    const linked = row({ lead: 'IR', trail: '86%', href: '/call/12' });
    expect(linked.tagName).toBe('A');
    expect((linked as HTMLAnchorElement).getAttribute('href')).toBe('/call/12');
    const plain = row({ lead: 'IR', trail: '86%' });
    expect(plain.tagName).toBe('DIV');
  });

  it('carries state for the one place colour is allowed', () => {
    expect(row({ lead: 'a', trail: 'b', state: 'hit' }).dataset.state).toBe('hit');
  });
});

describe('surfaces — generated from tokens, never a second copy of the palette', () => {
  it('emits a rule per theme', () => {
    const css = surfaceCss();
    expect(css).toContain('.surface-dossier');
    expect(css).toContain('.surface-terminal');
  });

  it('declares the SAME token names on both surfaces, so a component can nest in either', () => {
    const css = surfaceCss();
    const namesIn = (surface: string) => {
      const block = css.split(`.surface-${surface} {`)[1].split('}')[0];
      return new Set([...block.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
    };
    const dossier = namesIn('dossier');
    const terminal = namesIn('terminal');
    // Any token declared on one surface and not the other is a component that
    // renders correctly in one context and breaks in the other.
    const onlyDossier = [...dossier].filter((n) => !terminal.has(n));
    const onlyTerminal = [...terminal].filter((n) => !dossier.has(n));
    expect({ onlyDossier, onlyTerminal }).toEqual({ onlyDossier: [], onlyTerminal: [] });
  });

  it('reads its values from the token source rather than restating them', () => {
    const css = surfaceCss();
    for (const [prop, value] of Object.entries(themeTokens.dossier).slice(0, 5)) {
      expect(css).toContain(`${prop}: ${value};`);
    }
  });

  it('installs once and is safe to call repeatedly', () => {
    installSurfaces();
    installSurfaces();
    expect(document.querySelectorAll('#nw-kit-surfaces')).toHaveLength(1);
  });
});
