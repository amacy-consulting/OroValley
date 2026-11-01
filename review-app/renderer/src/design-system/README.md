This system describes the public website of the Town of Oro Valley, Arizona, as published at orovalleyaz.gov on a Granicus govAccess theme. Every value was read from the site's live stylesheets on October 31, 2026. Use it for work that sits beside the Town site, such as the Council meeting summaries widget and the staff dashboard. It is a working reference, not an official Town standard. The site's tagline is "it's in our nature".

## Content

The site speaks as the Town, to residents, in plain service language.

- Write as the Town, in the first person plural: "Search our website", "Connect with us". Let residents speak in the first person where they act: "What's happening near me?".
- Name tiles and links after the task, in Title Case: "Apply for Jobs", "Report an Issue", "Meetings and Agendas", "Need a Ride/Public Transportation".
- Set section headings and button labels in sentence case: "Featured content", "Connect with us", "See what's around me". Page titles are proper names: "Mayor and Council".
- Use "OV" as the Town's short name inside product names: "Ask OV", "OV Projects", "OV Path Forward".
- Write dates as "Published on October 28, 2026". Event listings give the day two digits ("November 06, 2026"), and the date block reads "06 / Nov 2026".
- Write hours with spaced en dashes and lowercase a.m. and p.m.: "Monday – Friday, 8 a.m. – 5 p.m.". Write phone numbers as 520-229-4700.
- Placeholders say what to type: "Search our website", "Street address...".
- Interface text uses no emoji.

## Color

- Set body copy in `ink`. Set headings, links, navigation, card titles and footer text in `charcoal`. Inside grey boxes (side boxes, quick links, the search field) use `ink-soft`.
- `blue` is the working blue: accordion headers, selected states, the arrow disc, and rules such as the 3px footer rule. `blue-bright` fills service tiles, the Search button and the page band behind content panels. `navy` draws the heavy emphasis rules. Links turn `blue-hover` on hover.
- Gold is the call to action. Put every button on `gold` with `charcoal` text. Use `amber` only for the address finder's submit button.
- Unselected homepage tabs are `umber`; the selected tab is `surface`; any tab turns `gold` on hover.
- Page content sits on `surface` panels over the hero photograph or the `blue-bright` band. Group secondary content on `surface-muted`, feature rows on `surface-band`, and the footer on `surface-footer`.
- Status colors: `error` for form errors and destructive buttons, `canceled` for canceled meetings and events, `success` for positive labels. Emergency banners take `gold`, `sky` or `alert-low` by the severity entered in the CMS (10, 20, 30), else `alert-neutral`.
- Never set white text on `gold`, `amber` or `sky`.

## Type

- Set everything in Source Sans Pro, loaded from Google Fonts at 400, 600, 700 and 900: `https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,600,700,900&display=swap`. Source Sans 3, its successor, is the fallback.
- Body text is `body`: 16px on a 24px line.
- Headings are `charcoal` on a 1.5 line height: `h1` 32px bold for the page title, `h2` 28px, `h3` 24px, `h4` 20px semibold. `h5` and `h6` are regular weight in capitals.
- Interface text runs a step larger than body: `nav-link` 19.2px; `breadcrumb`, `button-label` and `card-title` 18px; `tab-label` 17.6px.
- Use 900 weight only for the top navigation's hover and current state.
- Leave 20px under paragraphs, `h1` and `h2`, and 10px under `h3` to `h6`. A heading that follows a paragraph gets 20px above it.

## Layout and spacing

- Put page content in a `surface` panel (padding `space-25` by `space-20`) over the hero photograph and the `blue-bright` band, with the breadcrumb trail at its top and an optional right column of side boxes.
- The homepage stacks full-width bands: the translucent header (`surface-header`) over the hero, the tab strip on the hero's bottom edge, the service-tile grid, the `surface-band` row of featured cards, the address finder over a second photograph, and the footer.
- Lay tiles and cards in three columns from 992px, two from 768px, one below. Leave `space-30` under each tile or card.
- The stylesheet's breakpoints are 480px, 768px, 992px, 1300px, 1400px and 1700px.
- Space in 5px steps, `space-5` to `space-80`; lists, forms and tables also use `space-12` and `space-24`.

## Shape, rules and depth

- Round cards, tiles and anything that touches the hero with `radius-card` (8px). Round buttons with `radius-button` (4px). Tabs round only their top corners.
- Show emphasis with heavy rules rather than fills: `navy` at `border-emphasis-left` (10px) or `border-emphasis-bottom` (7px), and `blue` at `border-footer` (3px) above the footer's bottom row.
- Shadows lift only things you click: `shadow-tile` on service tiles, `shadow-card` on listing cards, `shadow-menu` on dropdowns. Side boxes and featured cards stay flat.

## Imagery

- Photography is the Sonoran Desert around the Town in low golden light: saguaros, ocotillo, boulders and desert mountains under wide skies. It fills the hero edge to edge, with the header band laid over it.
- White text on photographs is `h1` bold with a text shadow of 2px 3px 3px in 80% black.
- Crop featured-card photos to 480 × 285 and listing-card photos to 380 × 180 at desktop width; their top corners follow `radius-card`.
- This system carries no photographs. Use the Town's own.

## Iconography and logos

- Icons come from two SVG sprites, both in Icons. `sprite-dio-ov.svg` holds the solid white service-tile glyphs (50px: person, gavel, map pin, bus, water drop and so on). `sprite-general-ov.svg` holds the interface glyphs: 10 × 16 chevrons on buttons, the featured-card arrow, accordion plus and minus, the search magnifier, and social icons in their own brand colors.
- Show a glyph as a background image at the sprite's own size, moved into place with `background-position`. Icons lists the positions.
- `bundle.css` draws its chevrons, the card arrow and the accordion signs in CSS, so they take the text color and need no hosted file. Use the interface sprite where an exact match matters.
- The header carries the Town wordmark, "ORO VALLEY, ARIZONA" in `charcoal` over a large OV monogram in `sky` at 40% opacity (`sprite-logo-ov.svg` in Logos, three lockups). The footer carries the Town seal (`tovsealtransparent.png`). Use them only in work for or approved by the Town, and never redraw, recolor, stretch or crop them. Where neither file can be used, set "Town of Oro Valley" in plain type.
- No emoji.

## Motion and states

- Buttons and links change over 300ms ease-out. The call-to-action chevron slides 5px right on hover over 200ms. On featured cards the arrow disc widens from 50px to 100px and fades to white over 300ms.
- Hover and focus toggle underlines: links lose theirs, while buttons, tabs, tiles and card titles gain one. Top navigation moves to 900 weight.
- Drop the transitions when the reader prefers reduced motion.

## Accessibility

- Show keyboard focus with `focus-ring` on every control. The Town site relies on the browser's 1px dotted outline, which is hard to see; the ring is this system's addition.
- `charcoal` links are told apart from body text by their underline, not their color, so keep the underline at rest.
- On `sky`, set text in `ink-on-sky`. The Town's alert banner puts white on sky at 3.7:1; this system does not.
- White on `blue-bright` is 4.9:1. Keep tile and button labels at 16px or larger.

## Using the components

- Load `tokens.css`, then `components/bundle.css`. The components are plain HTML with `ov-` classes and need no script; each component's guideline gives its markup.
- `bundle.css` loads Source Sans Pro and sets the font and the `ink` text color on `body`.
