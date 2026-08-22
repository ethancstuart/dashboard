/**
 * Minimal Markdown → semantic HTML, for server-rendered pages.
 *
 * WHY THIS EXISTS. `/brief/:date` and `/country/:code` are the only two
 * genuinely crawlable surfaces this site has — ~218 URLs between them. Both
 * server-rendered a title and a ~200-character hook, then bounced the visitor
 * into the SPA with `<meta http-equiv="refresh" content="0; …">`. The comment
 * in the old code said "crawlers ignore the refresh"; they do not. Google
 * treats a zero-second meta refresh as a redirect and passes indexing to the
 * target, which was a hash fragment and therefore not indexable at all. So 218
 * pages of real daily writing indexed as nothing.
 *
 * The brief's rendered `summary` column is EMAIL markup — nested tables with
 * inline styles, sized for a 600px client. It renders, but it is poor document
 * structure for a crawler. `daily_briefs.content.briefText` holds the original
 * Markdown, so we render that into real headings, paragraphs and lists instead.
 *
 * Deliberately small: this handles the subset the brief generator actually
 * emits (see `getBriefSystemPrompt` in api/cron/daily-brief.ts — "Clean
 * markdown. Use ## for section headers, **bold** for emphasis, numbered lists
 * for stories, bullet points for outlook"). It is not a general parser and
 * should not grow into one — if a page needs more, it needs a real library.
 *
 * All input is escaped before any markup is introduced, so a stray `<script>`
 * in generated copy renders as text rather than executing.
 */

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Inline marks, applied to already-escaped text. */
function inline(text: string): string {
  return (
    text
      // [label](https://…) — http(s) only, so an escaped quote cannot break out
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  );
}

/**
 * Render a Markdown document to HTML.
 *
 * Returns a fragment — no wrapper element — so callers control the container.
 */
export function markdownToHtml(md: string): string {
  const lines = escapeHtml(md).split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = (): void => {
    if (!listType) return;
    out.push(`</${listType}>`);
    listType = null;
  };
  const openList = (type: 'ul' | 'ol'): void => {
    if (listType === type) return;
    closeList();
    out.push(`<${type}>`);
    listType = type;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (/^([-*—]{3,})$/.test(trimmed)) {
      flushParagraph();
      closeList();
      out.push('<hr>');
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      openList('ul');
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      openList('ol');
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  return out.join('\n');
}

/** Plain text from Markdown — for meta descriptions and OG tags. */
export function markdownToText(md: string): string {
  return md
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
