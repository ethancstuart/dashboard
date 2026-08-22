import { describe, it, expect } from 'vitest';
import { markdownToHtml, markdownToText } from './markdown.js';

describe('markdownToHtml — the shapes the brief generator emits', () => {
  it('renders ## section headers as real headings', () => {
    expect(markdownToHtml('## Top Signal')).toBe('<h2>Top Signal</h2>');
    expect(markdownToHtml('# The NexusWatch Brief')).toBe('<h1>The NexusWatch Brief</h1>');
  });

  it('renders bold and italic', () => {
    expect(markdownToHtml('**Somalia** jumped')).toBe('<p><strong>Somalia</strong> jumped</p>');
    expect(markdownToHtml('a *quiet* week')).toBe('<p>a <em>quiet</em> week</p>');
  });

  it('renders numbered lists as <ol> and bullets as <ul>', () => {
    expect(markdownToHtml('1. First\n2. Second')).toBe('<ol>\n<li>First</li>\n<li>Second</li>\n</ol>');
    expect(markdownToHtml('- One\n- Two')).toBe('<ul>\n<li>One</li>\n<li>Two</li>\n</ul>');
  });

  it('joins wrapped lines into one paragraph and splits on blank lines', () => {
    expect(markdownToHtml('one\ntwo\n\nthree')).toBe('<p>one two</p>\n<p>three</p>');
  });

  it('renders a full brief-shaped document', () => {
    const html = markdownToHtml(
      ['# The NexusWatch Brief', '', '## 📊 Top Signal', '', '**Somalia** jumped 8 points.', '', '- driver one'].join(
        '\n',
      ),
    );
    expect(html).toContain('<h1>The NexusWatch Brief</h1>');
    expect(html).toContain('<h2>');
    expect(html).toContain('<strong>Somalia</strong>');
    expect(html).toContain('<li>driver one</li>');
  });

  it('closes an open list before a following heading', () => {
    expect(markdownToHtml('- a\n## Next')).toBe('<ul>\n<li>a</li>\n</ul>\n<h2>Next</h2>');
  });
});

describe('markdownToHtml — escaping', () => {
  it('escapes HTML in the source so generated copy cannot inject markup', () => {
    const html = markdownToHtml('a <script>alert(1)</script> b');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes angle brackets inside a heading', () => {
    expect(markdownToHtml('## <b>x</b>')).toBe('<h2>&lt;b&gt;x&lt;/b&gt;</h2>');
  });

  it('only linkifies http(s) URLs', () => {
    expect(markdownToHtml('[x](https://a.com)')).toContain('<a href="https://a.com"');
    // javascript: must never become an href
    const evil = markdownToHtml('[x](javascript:alert(1))');
    expect(evil).not.toContain('<a href');
  });

  it('leaves quotes in link text harmless', () => {
    expect(markdownToHtml('[a"b](https://a.com)')).toContain('&quot;');
  });
});

describe('markdownToText', () => {
  it('strips markers for use in a meta description', () => {
    expect(markdownToText('## Top\n\n**Bold** and [link](https://a.com)')).toBe('Top Bold and link');
  });

  it('collapses whitespace', () => {
    expect(markdownToText('a\n\n\n   b')).toBe('a b');
  });
});
