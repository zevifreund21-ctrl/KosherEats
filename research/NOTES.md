# Research notes — kosher restaurants, Brooklyn (Boro Park / Flatbush / Williamsburg)

Researched 2026-10-28. Every fact below comes from a source actually read (restaurant website, menu/ordering page, Google/Places listing, or a DoorDash/Caviar listing). Nothing was invented. Where a fact could not be verified it is `null` in `restaurants.json` and flagged here.

General caveats:

- **Hechsher (kosher certification agency) is the weakest field.** Almost no source states the certifying agency by name. Only China Glatt had a certification named in a source (and even there two listings word it differently). All other restaurants have `hechsher: null` even though their kosher status is confirmed by Places category / directory listings. Do not display a hechsher for them unless it is verified separately.
- **Delivery-platform prices are snapshots.** DoorDash/Caviar crawls ranged from 3 to ~232 days old at read time. Prices change; re-check before showing prices as current.
- **Friday/Saturday hours:** many Places listings omit Friday/Saturday entirely. Where hours could not be verified the day is `null`, not guessed — even though most of these restaurants are presumably closed on Shabbat.
- **Ratings** come from different sources (Google/Places vs DoorDash) with different review counts; the source is recorded per restaurant in `rating_source`.

## 1. Noribar — 5401 13th Ave, Brooklyn, NY 11219 (Boro Park)

- Verified: address, phone (+1 347-853-8888), website (noribar.com), hours (Sun–Thu 11:00–23:00, Fri 10:30–16:00, Sat 18:00–01:00) and rating 5.0 (1 review) via the Google/Places listing; full menu with prices from the restaurant's own website. Category pareve, sushi/Japanese.
- Not verified: hechsher (no agency named in any source read); delivery (no delivery listing found).
- Excluded: platter prices ($60–$250) because item/price alignment in the site extraction was uncertain; "Sesame Salmon Poppers $0.00 AND UP" (broken price on the site).

## 2. Table 40 — 4001 13th Ave, Brooklyn, NY 11218 (Boro Park)

- Verified: address, phone (+1 929-234-5444), website (table40.com), kosher-restaurant / pizza / cafe categorization, rating 4.8 (19 reviews), price level inexpensive. Item names from the restaurant's own site (dish labels) and the Places offerings list.
- Not verified: **all menu prices** — no priced menu exists anywhere found. The own site shows dish names only; no delivery-platform listing was found. All 10 menu items have `price: null`.
- Hours conflict: own site says Friday Closed, Saturday "1h after Zman till 11:30PM". The Places listing said Fri 9:00–19:00, Sat 20:00–23:00. Friday follows the restaurant's own site (closed); Saturday uses the Places hours and is approximate (opens after Shabbat ends).
- Not verified: hechsher; delivery.

## 3. China Glatt — 4413 13th Ave, Brooklyn, NY 11219 (Boro Park)

- Verified: address, phone (+1 718-438-2576), website (chinaglatt.com), hours from the own site (Sun 12:30–23:00, Mon–Thu 11:00–23:00, Fri/Sat Closed), full menu with prices from AllMenus.
- Hechsher: GoKosher lists "Bet Din Tzedek" on one listing and "Rabbi Amram Roth, Chasidishe Shechita" on another. Recorded as "Bet Din Tzedek" with this conflict noted — verify before displaying.
- Hours conflict: Places showed shorter hours (12:30–22:30) with no Fri/Sat entry; own-site hours used.
- Not verified: rating (none found); delivery. The order URL (chinaglatt.orders2me.com) is linked from the restaurant's own site but was not opened.

## 4. Schnitzi — 1299 Coney Island Ave, Brooklyn, NY 11230 (Flatbush)

- Verified: address, phone (+1 718-338-4015), website (schnitzi.com), hours (Sun–Wed 11:00–23:00, Thu 11:00–01:00), rating 4.4 (72 reviews), DoorDash delivery + pickup.
- Menu prices combine two disagreeing sources: the Toast ordering page (crawled ~232 days before read) and DoorDash. **Staleness risk:** the own site says the restaurant is under new ownership since 2025, so the menu/prices may have changed. Re-check before use.
- Not verified: Friday/Saturday hours (not listed); hechsher.

## 5. Spoons — 2923 Avenue J, Brooklyn, NY 11210 (Flatbush)

- Verified: address, phone (+1 718-377-7373), website (cafespoons.com), hours (Sun–Thu 8:30–22:00, Fri 8:30–13:00, Sat Closed) via Restaurantji (updated Sep 29, 2026) consistent with Places, rating 4.7 (9 reviews), menu with prices from the SinglePlatform menu listing (crawled 22 days before read).
- This is the Avenue J location. A second Spoons at 5001 13th Ave (+1 718-633-5555) was NOT used.
- Not verified: hechsher; which delivery platform(s) (Restaurantji lists delivery as an option, but no platform listing was found, so `platforms` is empty).

## 6. Cafe Paris — 4424 16th Ave, Brooklyn, NY 11204 (Boro Park)

- Verified: address, phone (+1 718-853-2353), website (cafeparisnyc.com), kosher status (Places category "Kosher Restaurant", Tripadvisor "Kosher" tag), hours (Sun–Thu 11:00–22:00, Fri/Sat Closed) via Restaurantji consistent with Places, full menu with prices from DoorDash, delivery via DoorDash and Caviar, rating 4.6 (50+ DoorDash ratings).
- Not verified: hechsher (no agency named in any source read).
- Hours note: one aggregator (Tripadvisor) showed different hours (open until 23:00 daily); not used.
- Item names kept in DoorDash's exact casing.

## 7. Naim Kosher Pizza — 3904 15th Ave, Brooklyn, NY 11218 (Boro Park)

- Verified: address, phone (+1 718-438-3569), website, hours Mon–Fri/Sun via the Places listing, kosher/pizza categorization, item names from the Places offerings list and customer reviews.
- Not verified: **all menu prices** — no priced menu found. All 10 items have `price: null`.
- **Name-confusion warning:** search results heavily mix this restaurant with "Naomi's Kosher Pizza" in Flushing, Queens (68-28 Main St). The Flushing restaurant's DoorDash and menuweb menus were deliberately NOT used.
- Saturday hours: Places claims Sat 10:00–20:00, which is inconsistent with Shabbat observance and unconfirmed — recorded as `null`.
- Reviews describe the shop as cash-only. Not verified: rating (none found), hechsher, delivery.

## 8. Gottlieb's Restaurant — 352 Roebling St, Brooklyn, NY 11211 (Williamsburg)

- Verified: address, phone (+1 718-384-6612), order page (gottliebrestaurant.com/order), hours (Sun–Thu 12:00–22:00, Fri 11:00–15:00) via Places, full menu with prices from DoorDash (most recent crawl 3 days before read), rating 4.6 (200+ DoorDash ratings), delivery via DoorDash.
- DoorDash shows several prices with a "+" suffix (starting-at prices); base numbers are recorded.
- Older DoorDash crawls showed lower prices — prices may have risen; re-check before use.
- The own order page is JavaScript-heavy and rendered no menu text.
- Not verified: Saturday hours; hechsher (described as a glatt kosher deli, but no certifying agency named).

## 9. Grill On Lee — 868 Bedford Ave, Brooklyn, NY 11205 (Williamsburg)

- Verified: address, phone (+1 718-963-2700), Toast ordering URL, hours (Sun–Thu 12:00–00:00) via Places, menu with prices from DoorDash, delivery via DoorDash and Toast ordering.
- **Price uncertainty:** prices recorded are those consistent across five DoorDash crawls 41–53 days before read. One newer crawl (26 days) showed higher prices on several items (e.g. Sesame Chicken $19.99 vs $12.95). Current prices should be re-checked.
- The Toast ordering page rendered descriptions/prices but dropped item names in extraction, so it could not be used for named items.
- Not verified: own website (none found); Friday/Saturday hours; rating (none found); hechsher.

## 10. Essen NY Deli — 1359 Coney Island Ave, Brooklyn, NY 11230 (Flatbush)

- Verified: address, phone (+1 718-859-1002), full menu with prices from DoorDash (crawled 33 days before read), hours (Sun–Wed 11:00–23:00, Thu 11:00–01:00, Fri 11:00–14:00) and glatt-kosher-deli description via Giftly/Wherevi listings, rating 4.4 (20+ DoorDash ratings), delivery via DoorDash.
- Not verified: Saturday hours (not stated anywhere read); hechsher (no certifying agency named); own website (none found).
- Note: two "Roast Beef" entries exist on the menu (sandwich $13.00, beef entrée $33.00); the `section` field disambiguates. A separate Essen sushi/wrap PDF menu (menuweb) was not used.
- This restaurant replaced Seacress in the list (see rejected list).

## 11. Panini La Cafe — 45 Lee Ave, Brooklyn, NY 11211 (Williamsburg)

- Verified: address, phone (+1 718-576-3055), website (panini45lee.com), hours (Sun/Tue/Thu 7:00–19:00, Mon 7:00–19:00, Wed 7:00–20:00, Fri 7:00–13:00) via Places, menu with prices from the Caviar listing (crawled 6 days before read), corroborated by AllMenus/Menupages, rating 4.7 (100+ DoorDash ratings), delivery via DoorDash and Caviar.
- Do not confuse with "PANINI CAFE NYC" (4017 8th Ave) or "Panini Cafe" (Manhattan) — different restaurants.
- Not verified: Saturday hours; hechsher.

## 12. Cafe 28 — 28 Throop Ave, Brooklyn, NY 11206 (Williamsburg)

- Verified: address, phone (+1 718-942-2828), website (cafe28ny.com), hours (Sun 8:00–19:00, Mon–Thu 7:00–19:00, Fri 7:00–13:00) via Places, menu with prices from DoorDash, rating 4.5 (50+ DoorDash ratings), delivery via DoorDash.
- This is the 28 Throop Ave location. Other Cafe 28 locations (249 Wallabout St; 18 Spencer St "Cafe 28 @ Tower 18") have different hours/menus and were NOT used.
- Price-level conflict: Places says inexpensive ($), DoorDash displays $$. Recorded as $.
- Not verified: Saturday hours; hechsher.

## Rejected / excluded restaurants

- **Seacress (151 Lee Ave, Williamsburg)** — dropped from the final list. It is a fish market, not a restaurant with a menu; its website (seacress.com) rendered only a Paytronix loading page and no priced menu or item list could be found on any source. Replaced by Essen NY Deli. Verified facts found: address 151 Lee Ave, Brooklyn NY 11211; phone +1 718-388-5380; website seacress.com; Places hours Sun 12:00–19:00, Mon/Tue 9:00–20:00, Wed 9:00–21:00, Thu 9:00–22:00, Fri 9:00–14:30; rating 4.0 (9 reviews, per an aggregator).
- **Green's (216 Ross St) and Cheesy Kosher (314 Marcy Ave)** — both shown as temporarily closed in the Places listing; excluded.
- **Mendy's (792 Eastern Pkwy), Mermelstein Takeout, Prime Avenue, Kingston Pizza** — Crown Heights, outside the scoped neighborhoods (Boro Park / Flatbush / Williamsburg); excluded.
- **Taam Mevorach** — Monsey; skipped per task instructions. **Mendy's (Manhattan)** — Manhattan; skipped per task instructions.
- **Candidate names checked but not used:** Boeuf & Bun, Olympic Pita, Kasbah, Milk and Honey, Sushi Tokyo, Perizia, Tov U'Meitiv, Chap A Nosh, Juice Box — the final 12 were selected first from verified Places listings and these candidates were not needed; no claims are made about them.
- **Naomi's Kosher Pizza (68-28 Main St, Flushing)** — different restaurant from Naim Kosher Pizza; its menus were excluded from Naim's data (see §7).
- **Cafe 28 @ Tower 18 (18 Spencer St)** and **Spoons (5001 13th Ave)** — second locations of included restaurants; excluded to avoid mixing two locations' data.
