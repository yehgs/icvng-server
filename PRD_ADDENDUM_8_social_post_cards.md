# PRD Addendum 8 — Social feed as post cards

- Storefront "Coffee Stories": every connected social page is its own row: header + "Visit page" + a grid of its latest post cards (2 columns on phones, 3 on tablets, **4 from large screens**). Coffee-brown palette (espresso/roast, gold, cream).
- Video posts show a play button and play inside the card (direct file via `<video>`, or an iframe limited to YouTube-nocookie, TikTok, Facebook video and Instagram embed hosts).
- Sources per page (`GET /api/social/public` now returns `posts` per page, up to 8):
  - Facebook: Graph API with Page ID + Page access token. Instagram: Graph API with Business account ID + token. YouTube: public channel RSS (channel ID only).
  - Hand-picked posts (max 12, optional `.mp4/.webm/.mov` link or an embeddable video link) are used when no live feed is connected or the live feed fails. A page with no posts shows just its header and description.
- Tokens are stored AES-GCM encrypted, never returned by any API (admin sees only "token saved"), editable only within the editor's country. Feeds are cached 15 minutes per page; the last good result is kept if a refresh fails.
- Limitations: Meta tokens expire/need app review for production use; Instagram video file URLs from Meta can expire (the card then falls back to the post link). TikTok, X, LinkedIn have no live feed: use hand-picked posts. Live Meta calls could not be exercised from the build sandbox; they are covered by stubbed tests.
- Tests: `social_int` (13 groups).
