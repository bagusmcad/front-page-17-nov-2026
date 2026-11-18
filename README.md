[![news-image-20261117](https://make.fun/badge/news-image-20261117.svg)](https://make.fun/bounty/news-image-20261117)
[![rank](https://make.fun/badge/news-image-20261117/bagusmcad/front-page-17-nov-2026/rank.svg)](https://make.fun/bounty/news-image-20261117)
[![reward](https://make.fun/badge/news-image-20261117/bagusmcad/front-page-17-nov-2026/reward.svg)](https://make.fun/bounty/news-image-20261117)

# The World — Tuesday 17 November 2026

A one-page newspaper front page of Tuesday 17 November 2026, drawn entirely by code.
`main.ts` (Node 22, standard library only, no network) renders a 1024×1024 PNG:
a masthead naming the day, six stories with a small vector illustration each,
and a digest strip of four more stories. The image in this repo (`entry.png`)
is the program's own output, so the repo and the program agree.

## What the image shows

- **Masthead:** "THE WORLD" over a navy band reading **TUESDAY 17 NOVEMBER 2026** —
  the day is named big and unmissable, because the whole page sums up that one day.
- **Lead story — The Gulf:** US fighter jets struck an IRGC missile launch site on
  Qeshm Island, hours after Iran fired drones at a US-operated radar at Sheikh Isa
  Air Base in Bahrain (the third attack on US forces there in five days). Mines hit
  tankers in the Strait of Hormuz: a supertanker and an LNG carrier caught fire,
  and 24 crew were evacuated from the Tara Gas. A third US aircraft carrier,
  USS Theodore Roosevelt, is now in the Gulf. The map shows Qeshm, Bahrain,
  the strait, burning tankers, jets and the carrier.
- **Ukraine:** Ukraine hit the Kerch Bridge to Crimea for a second day; a road span
  fell into the strait; 2 killed; Russia closed road traffic.
- **Nvidia:** Nvidia reported Q3 revenue of $115.8 billion and forecast about
  $130 billion next quarter; its board will not reinstate Jensen Huang as CEO.
- **Diplomacy:** Trump heads to Shenzhen for a trilateral APEC summit with
  Xi and Putin on 19 Nov.
- **Japan:** Japan scrambled fighter jets after Russian aircraft entered its airspace.
- **Gaza aid:** The UK, Australia, Canada and Italy press Israel to open Gaza
  aid crossings.
- **Digest strip:** Ebola in DR Congo passes 11,000 cases, 5,400 dead; the US loses
  measles-elimination status after 26 years; a Russian An-12 military plane crashes
  in Kemerovo, 19 dead; Gerard Depardieu pleads guilty.

All facts are as reported on 17 November 2026; nothing is invented, and every
caption is kept short and faithful, without hype.

## How to run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png`. The program reads no files and makes no network
requests. It contains its own software rasterizer (framebuffer, rect/circle/line/
polygon fills), an embedded 5×7 bitmap font designed for this entry (uppercase,
lowercase, digits and punctuation, scaled for headlines and body text), and a
hand-written PNG encoder (zlib deflate at a fixed level, filter type 0 on every
scanline), so the output is deterministic.

## Validation and limitations

- Output: 1024×1024 PNG, 25,382 bytes (limit: 1 MiB).
- Determinism: run twice, byte-identical.
  sha256 of both runs: `d76ed4dbd3e56eee55080f3c4ef229805714c8d63b57f0851621aaee6aeb2e7b`
- Legibility: the rendered image was viewed directly and revised twice.
  Masthead, date band and all six headlines are legible at a glance; body text
  is small by design (it is a newspaper page) and reads cleanly at full size.
  No text overlaps, no clipped lines, no garbled characters.
- Limitations: the illustrations are schematic vector drawings, not photographs;
  the font is a pixel font, so letterforms are blocky at large sizes. The page
  covers the six stories above plus a four-item digest; it does not attempt to
  cover every event of the day.

## License

MIT — see [LICENSE](LICENSE).
