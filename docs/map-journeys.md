# Public map: 100 user journeys

Written 5 Nov 2026 (Joel: "walk through 100 user journeys and design the app such that they are accommodated").
Stage: Exploration. Each journey: who, what they want, whether the map serves it today (ok, part, gap), and the
design answer. Features are named F1..F20 at the end; the journeys say which they need.

## Locals planning dinner (1-25)

| # | Who and what | Today | Answer |
|---|---|---|---|
| 1 | Couple, Friday night, any good place with a table for two | ok | Day strip, list of free places first |
| 2 | Couple wants a Michelin star this Saturday | gap | F1 distinction on signs, list and card; F2 filter "Stars" |
| 3 | Student wants good and cheap: Bib Gourmand tonight | gap | F1, F2 filter "Bib Gourmand" |
| 4 | Anniversary at a 2 or 3 star place, any date in the next two months | gap | F2 "Stars" + card calendar per restaurant; F3 "first free day" in the list |
| 5 | Someone wants the hardest-to-get place that has a table this week | part | "Hard to get" filter exists; F4 its own mark (not stars) |
| 6 | A couple in De Pijp wants something within walking distance tonight | gap | F5 Near me: sort by distance, fly to the user |
| 7 | Someone wants dinner, not lunch: a table between 18:00 and 21:30 | part | Times shown for 3 days only; F6 dinner/lunch on the card where times are known, "times on their page" otherwise |
| 8 | Ramen lover searches "ramen" | part | Search by name and area only; F7 search cuisine too |
| 9 | Vegetarian wants a place that suits them | gap | F7 cuisine from the guide; no diet data: say "check their menu" |
| 10 | Someone remembers "that place on the Amstel" | part | Search by area works; map browse works |
| 11 | Group of four for Saturday | gap | Census reads two only. F8: say "for two" plainly; a bigger group books on their page |
| 12 | Solo diner wants a counter seat | gap | F8 same note; out of scope for now |
| 13 | Friend sends a link to Toscanini on Friday | ok | ?r=&date= links open the card on that day |
| 14 | User wants to send a found table to their partner | part | F9 Share button on the card (system share sheet, copy link) |
| 15 | Someone checks whether De Kas opens its calendar for New Year's Eve | ok | "Not bookable yet, opens about" line |
| 16 | User wants the list sorted by when a place is free soonest | gap | F3 "first free day" per restaurant in the list when the chosen day is full |
| 17 | Someone wants to see only places with free tables | ok | "Free only" |
| 18 | User wants to compare three places for Friday | part | List shows status per place; card calendar shows the weeks |
| 19 | User wants to know if a free table is still there | ok | "Seen N min ago" on the card |
| 20 | User clicks Book and lands on a different date (Tebi) | ok | Card says which day and time to pick there |
| 21 | User wants a late table after 21:30 | part | F6 times; otherwise their page |
| 22 | User wants lunch on Sunday | part | F6 |
| 23 | User returns the next day and wants the same filters | gap | F10 remember filters on this device (local only) |
| 24 | User wants a quieter, cheaper list: price level | gap | F7 price from the guide on the card and as a filter |
| 25 | User wants to know why a place is "hard to get" | ok | Card shows the reason line |

## Visitors and tourists (26-45)

| # | Who and what | Today | Answer |
|---|---|---|---|
| 26 | Tourist on a phone near Centraal wants dinner tonight | part | F5 Near me; mobile sheet |
| 27 | Tourist does not know Amsterdam areas | part | F5 distance in minutes on foot instead of area names only |
| 28 | Tourist wants "the famous ones": starred places | gap | F1, F2 |
| 29 | Tourist plans a trip in three weeks | ok | Day strip to 9 weeks; card calendar |
| 30 | Tourist reads Dutch poorly; all English | ok | English UI |
| 31 | Dutch visitor prefers Dutch | gap | F11 Dutch text (later, after the English is final) |
| 32 | Tourist wants to know a place's distance from the hotel | gap | F5 only from where they are; hotel search out of scope |
| 33 | Tourist on roaming data, slow connection | part | F12 the map loads the overview first; list works before tiles |
| 34 | Tourist wants a place with a view (Vuurtoreneiland, rooftop) | part | Card reason line; off-map island still listed |
| 35 | Tourist taps a restaurant outside the drawn city | ok | Listed, card says outside the city map |
| 36 | Tourist wants walk-ins | gap | No data; card says "book ahead or ask at the door" only where known: out of scope |
| 37 | Tourist wants to know what "full" means | ok | State line explains |
| 38 | Tourist wants to know prices before booking | gap | F7 guide price symbol |
| 39 | Tourist wants opening hours | gap | Out of scope; Website button |
| 40 | Tourist wants to save places for later | gap | F10 favourites on this device |
| 41 | Tourist wants a quick look without reading | ok | Map signs: colour and count |
| 42 | Tourist on a small phone (iPhone SE) | part | F13 layout check at 320 wide |
| 43 | Tourist uses landscape on a phone | part | F13 |
| 44 | Tourist uses an iPad | part | F13 tablet layout |
| 45 | Tourist wants directions | gap | F14 "Directions" link to the maps app |

## Food lovers and collectors (46-60)

| # | Who and what | Today | Answer |
|---|---|---|---|
| 46 | Collector wants every 2 and 3 star place and their next free day | gap | F1, F2, F3 |
| 47 | Collector wants Green Star (sustainable) places | gap | F1 green star mark |
| 48 | Food lover wants the newest Michelin additions | gap | F1 edition shown; "new" only if the guide says so |
| 49 | Food lover wants to know which booking system a place uses | ok | Card "Read from Tebi" line |
| 50 | Food lover wants to see when calendars open | ok | "opens about" |
| 51 | Food lover wants to know how quickly tables go | gap | Radar stats exist privately; out of public scope |
| 52 | Food lover wants all Bib Gourmand places on the map at once | gap | F2 Bib filter dims the rest |
| 53 | Food lover wants to know a chef or cuisine | part | F7 cuisine from the guide |
| 54 | Food lover checks the Michelin page | gap | F1 "MICHELIN Guide" link on the card |
| 55 | Food lover finds a place missing | gap | F15 "Missing a place?" mail link (needs the contact address) |
| 56 | Food lover wants a list view only, no map | part | F16 list-first on phones, map behind |
| 57 | Food lover wants to scan nine weeks for one restaurant | ok | Card calendar |
| 58 | Food lover wants restaurants by area | part | Search by area; F7 group/sort by area |
| 59 | Food lover wants to follow a place's waitlist | gap | Card says when the system offers a waitlist (Tebi): link only |
| 60 | Food lover compares the map with the guide | gap | F1 every guide restaurant listed, readable or not |

## People in a hurry (61-70)

| # | Who and what | Today | Answer |
|---|---|---|---|
| 61 | It is 18:30, wants a table at 19:30 today | part | F6 times today; F5 near me |
| 62 | Wants to book in under a minute | part | Card time buttons go to the booking page |
| 63 | One hand on the phone, on a bike stop | part | F13 thumb-reach controls at the bottom |
| 64 | Opens the map and the day is already tomorrow | ok | Day strip, Today first |
| 65 | Taps a sign, wants the booking button straight away | ok | Card with Book first |
| 66 | Taps the wrong restaurant | ok | Close, list stays |
| 67 | Wants the nearest free place in one tap | gap | F5 |
| 68 | Phone in dark mode at night | part | F17 the panels follow the system theme where it reads well; the city art stays day |
| 69 | Low battery, wants nothing animated | ok | Reduced motion respected |
| 70 | Bad signal, the card must still open | part | F12 list and cards from data.json, not tiles |

## Accessibility (71-80)

| # | Who and what | Today | Answer |
|---|---|---|---|
| 71 | Screen reader user wants the free places for Friday | part | List is buttons with text; F18 check every control's name, the live count |
| 72 | Keyboard only | part | Arrow keys pan, F18 focus order, visible focus |
| 73 | Low vision zooms the page to 200% | part | F13 layout at 200% |
| 74 | Colour-blind user tells free from full | part | F19 status words or marks, not colour only |
| 75 | Motion-sensitive user | ok | Reduced motion |
| 76 | User with tremor taps small signs | part | F13 hit areas of 44 px on touch |
| 77 | Dyslexic user reads the card | ok | Short lines, plain words |
| 78 | Older user needs bigger text | part | F13 respects the browser text size |
| 79 | Screen reader user hears the calendar | part | Day buttons have labels; F18 |
| 80 | User with a slow old phone | part | F12 fewer tiles in memory, overview first |

## Restaurants and the public (81-90)

| # | Who and what | Today | Answer |
|---|---|---|---|
| 81 | Restaurant owner wants off the map | ok | "For restaurants" dialog with mail (needs VITE_MAP_CONTACT) |
| 82 | Owner says our data is wrong | part | F15 "Something wrong?" mail link on the card |
| 83 | Owner moved to another booking system | part | Verify script finds it; F20 a weekly check |
| 84 | Owner wants to be on the map | gap | F15 same mail |
| 85 | Journalist wants to understand the method | ok | "How it works" |
| 86 | sezlab wants his credit right | ok | Footer, About, sponsors link |
| 87 | Someone asks about privacy | ok | No cookies, nothing asked |
| 88 | Michelin asks about the use of its data | part | F1 only facts (distinction, link), credited, no texts or photos copied |
| 89 | A guest finds a closed day shown as full | part | Day codes distinguish closed; verify script |
| 90 | A guest finds a free table that was gone | ok | "Seen N min ago"; censuses every 15 min |

## Joel and returning users (91-100)

| # | Who and what | Today | Answer |
|---|---|---|---|
| 91 | Joel checks that everything is accurate | ok | scripts/map-verify.ts, link check in agent-browser |
| 92 | Joel adds the full Michelin list | gap | F1 loader with evidence per restaurant |
| 93 | Joel shares the map with friends (next stage) | part | Go-live waits for the contact address |
| 94 | Friend asks "can it tell me when a table opens?" | gap | Personal radar only (Pilot); public alerts are a later stage |
| 95 | Returning user wants yesterday's view | gap | F10 remembered day, filters, favourites |
| 96 | User wants the map in another city | gap | Out of scope (Amsterdam only) |
| 97 | User wants to see the whole city at once | ok | Far zoom, overview |
| 98 | User wants a clean screenshot to share | part | F9 share link instead |
| 99 | User wants to know data age | ok | Footer "Read N min ago", card "Seen" |
| 100 | User wants to know what the signs mean | part | F21 a small legend for colours and marks |

## Features

| F | What | Serves | Plan |
|---|---|---|---|
| F1 | Michelin distinction (stars, Bib Gourmand, Green Star, selected) on signs, list and card, with a link to the guide page | 2-4, 28, 46-48, 52, 54, 60, 88, 92 | Built 5 Nov: stars and Bib Gourmand for all 34 Amsterdam places (data/map-michelin.json). Green Star: phased out in 2026, not shown. Selected list and guide links: need a MICHELIN licence (robots.txt forbids scripts) |
| F2 | Filters: Stars, Bib Gourmand, Michelin, Hard to get, Free only | 2, 3, 5, 28, 46, 52 | Built |
| F3 | First free day per restaurant when the chosen day is full | 4, 16, 46 | Built |
| F4 | "Hard to get" gets its own mark (a flame), never stars | 5 | Built |
| F5 | Near me: locate, sort by walking distance, fly there | 6, 26, 27, 61, 67 | Built |
| F6 | Lunch / dinner on the card from known times | 7, 21, 22, 61 | Built |
| F7 | Cuisine and price from the guide; search matches cuisine | 8, 9, 24, 38, 53, 58 | Partly: search matches our own kind words (sushi, pizza, wine…). Guide cuisine and price need the licence |
| F8 | "For two" said plainly; bigger groups book on their page | 11, 12 | Built |
| F9 | Share on the card | 14, 98 | Built |
| F10 | Remember day, filters and favourites on this device | 23, 40, 95 | Built: filters and saved places. The day starts at today on purpose; a link keeps a day |
| F11 | Dutch | 31 | Later |
| F12 | List and cards usable before the city loads; fewer images in memory | 33, 70, 80 | Check |
| F13 | Phone, tablet, landscape, 320 px, 200% zoom, 44 px targets | 42-44, 63, 73, 76, 78 | Built; 7 Codex screenshot rounds at 1440, 390, 320, 844×390 and 768. 200% zoom not checked yet |
| F14 | Directions link | 45 | Built |
| F15 | "Missing a place / something wrong?" mail link | 55, 82, 84 | Build (needs contact) |
| F16 | List-first on phones | 56 | Built: a full-width 'Show all N restaurants' bar; an 'Only: …' line shows active filters when the sheet is closed |
| F17 | Dark panels | 68 | Later |
| F18 | Screen reader and keyboard pass | 71, 72, 79 | Check |
| F19 | Status words, not colour alone | 74 | Check |
| F20 | Weekly booking-system check | 83 | Later (Pilot) |
| F21 | Legend | 100 | Built: map legend (desktop) and list key with the same marks |
