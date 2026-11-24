// Instagram and photo from a restaurant's own homepage (Joel, 24 Nov 2026): the account the site links most, never a
// post or a share link, and only an https share image, so nothing on the https map is blocked or mixed.
import { describe, expect, it } from 'vitest';
import { readSocial } from '../scripts/map-social.js';

describe('readSocial', () => {
  it('takes the account the page links most, not a post, reel or share link', () => {
    const html = `<a href="https://www.instagram.com/p/AbC123/">post</a>
      <a href="https://instagram.com/designer_credit/">site by</a>
      <a href="https://www.instagram.com/Gitane_Amsterdam/">ig</a> <a href="https://www.instagram.com/gitane_amsterdam">ig</a>`;
    expect(readSocial(html, 'https://gitane.amsterdam/').ig).toBe('gitane_amsterdam');
  });

  it('reads og:image in either attribute order, made absolute, and drops http images', () => {
    expect(readSocial(`<meta property="og:image" content="/img/room.jpg">`, 'https://x.nl/a/').photo).toBe('https://x.nl/img/room.jpg');
    expect(readSocial(`<meta content="https://cdn.x.nl/p.jpg?w=1&amp;h=2" property="og:image" />`, 'https://x.nl/').photo).toBe('https://cdn.x.nl/p.jpg?w=1&h=2');
    expect(readSocial(`<meta property="og:image" content="http://x.nl/p.jpg">`, 'https://x.nl/').photo).toBeNull();
    expect(readSocial('<p>no image</p>', 'https://x.nl/')).toMatchObject({ ig: null, photo: null });
  });
});
