---
name: Compromised
description: A one-athlete hybrid training coach, run in lanes on a cobalt field.
colors:
  cobalt: "#1B3BB8"
  cobalt-hover: "#15309A"
  cobalt-soft: "rgba(255,255,255,.32)"
  on-cobalt: "#FFFFFF"
  paper: "#FFFFFF"
  sunk: "#F4F5F8"
  ink: "#121212"
  muted: "#4D4F57"
  rule: "#E3E4E8"
  edge: "#6F727B"
  link: "#1B3BB8"
  speed: "#D9302A"
  threshold: "#C76100"
  hyrox: "#1E8A3E"
  strength: "#6A3FB5"
  easy: "#6A6E78"
  alert: "#C76100"
  good: "#1E8A3E"
  paper-dark: "#0F1115"
  sunk-dark: "#171A20"
  ink-dark: "#F1F1EE"
  muted-dark: "#A6A9B1"
  rule-dark: "#2A2E36"
  edge-dark: "#8A8E97"
  link-dark: "#9DB0FF"
  speed-dark: "#FF6A5C"
  threshold-dark: "#FF9F3D"
  hyrox-dark: "#4CC673"
  strength-dark: "#B395FF"
  easy-dark: "#9BA0AA"
  alert-dark: "#FF9F3D"
  good-dark: "#4CC673"
typography:
  numeral:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(120px, 38vw, 170px)"
    fontWeight: 900
    lineHeight: 0.88
    letterSpacing: "-0.04em"
    fontFeature: "\"tnum\" 1"
    fontVariation: "\"wdth\" 125"
  numeral-live:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(120px, 40vw, 220px)"
    fontWeight: 900
    lineHeight: 0.88
    letterSpacing: "-0.04em"
    fontFeature: "\"tnum\" 1"
    fontVariation: "\"wdth\" 125"
  figure:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(56px, 16vw, 88px)"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "-0.03em"
    fontFeature: "\"tnum\" 1"
    fontVariation: "\"wdth\" 125"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 850
    lineHeight: 1.02
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 75"
  headline-page:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 850
    lineHeight: 1.02
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 75"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 850
    lineHeight: 1.02
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 75"
  title-sm:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 850
    lineHeight: 1.02
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 75"
  prescription:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    fontFeature: "\"tnum\" 1"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    fontFeature: "\"tnum\" 1"
  body-quiet:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    fontFeature: "\"tnum\" 1"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    fontFeature: "\"tnum\" 1"
  brand:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    letterSpacing: "0.02em"
    fontVariation: "\"wdth\" 125"
rounded:
  none: "0px"
  sm: "4px"
  full: "9999px"
spacing:
  hair: "4px"
  xs: "6px"
  sm: "10px"
  md: "14px"
  pad: "20px"
  lg: "24px"
  gutter: "48px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-cobalt}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "54px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-hover}"
  button-line:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "54px"
  button-line-hover:
    backgroundColor: "{colors.sunk}"
  link-button:
    textColor: "{colors.link}"
    padding: "8px 0"
  link-button-quiet:
    textColor: "{colors.ink}"
    padding: "8px 0"
  toggle:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "46px"
  toggle-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    height: "46px"
  stepper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: "44px"
  status-tag:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-cobalt}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  field-band:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-cobalt}"
    padding: "16px 20px 20px"
  side-nav-item:
    textColor: "{colors.on-cobalt}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  side-nav-item-active:
    backgroundColor: "{colors.on-cobalt}"
    textColor: "{colors.cobalt}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  tab-bar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  tab-bar-active:
    textColor: "{colors.link}"
  lane-track-field:
    backgroundColor: "{colors.cobalt-soft}"
    height: "5px"
  lane-fill-field:
    backgroundColor: "{colors.on-cobalt}"
  lane-track-paper:
    backgroundColor: "{colors.rule}"
    height: "12px"
  empty-state:
    backgroundColor: "{colors.sunk}"
    rounded: "{rounded.sm}"
    padding: "18px"
  popover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "14px"
    width: "264px"
---

# Design System: Compromised

## Overview

**Creative North Star: "Lanes '76"**

Training run in lanes. The world borrows the Montréal 1976 Olympic identity: five parallel stripes, track lane lines, striped lettering. Progress is never a ring and never a card; it is parallel bars filling left to right, one lane per Phase, block, set group or Session type. A cobalt field owns the shell (countdown band, primary actions, active navigation, rest timer) and stays the same cobalt in light and dark themes; everything else sits on paper and is divided by ink rules.

Density is athletic: one big number, one instruction, then rows. Numbers are the heroes and are set expanded and black at 900 weight with horizontal stripes cut through them; headings are condensed and heavy; everything else is regular-width Archivo at 600. The surface is flat: rules, tonal sinks and fills do the structural work, not shadows or containers. The Coach's copy is blunt and dry, and every line carries the number and the reason.

The category default (rounded cards, progress rings, gradient hero, a single sporty neon accent) is the confirmed anti-reference.

**Key Characteristics:**
- Cobalt field band at the top of Today and every Live session, constant across themes.
- Striped numerals for the race countdown, the live target speed and the live target load.
- Five-lane progress everywhere progress is shown.
- Five Session-type lane colours that mean the same thing on every screen.
- 2px ink rules and 1px hairlines instead of cards; square 4px corners.
- Underlined links, tabular figures throughout.

## Colors

A single saturated cobalt carries identity; five Session-type colours carry meaning; neutrals are near-black ink on white paper (inverted in dark theme).

### Primary
- **Montréal Cobalt** (`cobalt`): the field band, primary buttons, the active side-nav background, the status tag, the rest-timer bar, checkbox accent and text selection. Identical in both themes, so the shell reads as the same object at night. Hover deepens to **Deep Cobalt** (`cobalt-hover`).
- **On-Cobalt White** (`on-cobalt`): all text, icons, lane fills and focus outlines on the field. Empty lanes on the field are **Cobalt Haze** (`cobalt-soft`, 32% white over cobalt).
- **Link Cobalt** (`link`, `link-dark`): links, the active tab, the current Week number, chart plan lines and data points on paper. Lifts to a pale periwinkle in dark theme so it keeps contrast on near-black.

### Secondary: Session-type lanes
Each Session type owns one colour, used only for that type, in lane chips, Plan week cells, the load chart, live block bars and the legend:
- **Track Red** (`speed`): Speed sessions; also the 20:00 goal line on the 5K chart.
- **Burnt Orange** (`threshold`): Threshold sessions.
- **Infield Green** (`hyrox`): HYROX sessions.
- **Plate Violet** (`strength`): Strength sessions.
- **Warm-up Grey** (`easy`): Easy runs, warm-ups, jogs and cooldowns; also normal-night sleep bars.

Dark theme lifts each to a brighter sibling (`*-dark`) for contrast on near-black.

### Tertiary: status
- **Alert Orange** (`alert`): short-sleep bars and caution data. Shares the threshold hue.
- **Done Green** (`good`): a logged set's "Logged" label. Shares the HYROX hue.

### Neutral
- **Paper** (`paper` / `paper-dark` near-black): page background, button-line fill, popover.
- **Sunk** (`sunk` / `sunk-dark`): the current Week row, empty-state block, button-line hover. The only tonal layer.
- **Ink** (`ink` / `ink-dark`): text, 2px structural rules, pressed toggles (inverted fill).
- **Muted** (`muted` / `muted-dark`): meta lines, secondary labels, inactive tabs, chart axis text.
- **Rule** (`rule` / `rule-dark`): 1px row hairlines, chart gridlines, empty live-lane tracks.
- **Edge** (`edge` / `edge-dark`): 2px inset strokes on unpressed toggles and steppers, scrollbar thumb, ghost future-load ticks.

### Named Rules
**The Constant Field Rule.** Cobalt is the same in light and dark. Only paper-side tokens change with the theme; the field band, its white type and its lanes never do.

**The Lane Colour Rule.** A Session-type colour means that Session type and nothing else. Never use `speed` red as a generic error or `hyrox` green as generic success outside the two shared status aliases.

**The Never Colour Alone Rule.** Every lane colour is paired with a name (legend, row label, block label), and filled vs. outlined cells carry done vs. planned independently of hue.

## Typography

**Display Font:** Archivo variable (with system-ui, sans-serif), width axis 62–125, weight 400–900. The prototype loads it from Google Fonts; production self-hosts the variable file.
**Body Font:** Archivo, same file.

**Character:** One family stretched to both ends of its width axis: numerals go wide and black like stadium scoreboards, headings go narrow and heavy like lane signage, and UI copy sits at normal width so it stays quiet.

### Hierarchy
- **Numeral** (900, width 125, `clamp(120px, 38vw, 170px)`, line-height 0.88, -0.04em): race countdown on Today; 56px in the desktop side rail. Always striped.
- **Numeral Live** (900, width 125, `clamp(120px, 40vw, 220px)`): Live session target speed; strength target load uses `clamp(84px, 26vw, 150px)`. Always striped.
- **Figure** (900, width 125, `clamp(56px, 16vw, 88px)`, 0.9): the live block timer and the incline (56px). Solid, not striped.
- **Headline** (850, width 75, 40px, 1.02, -0.01em): the next Session on Today, Live sheet questions; **Headline Page** 44px for Plan and Progress titles.
- **Title** (850, width 75, 26px): section and panel headings; 24px exercise names, 22px live header, **Title Small** 20px for Phase headings in Plan.
- **Prescription** (600, 21px): the target line under the next Session heading.
- **Body** (600, 17px, 1.3): Coach Suggestions, Week row names, button labels; live Coach line at 18px.
- **Body Quiet** (400, 15px, muted): meta lines, Suggestion reasons (14px), panel subtitles.
- **Label** (700, 13px): tab labels, Phase lane names, legend, table headers, status tag.
- **Brand** (800, width 125, 20px, +0.02em, uppercase): the wordmark only.

### Named Rules
**The Two Widths Rule.** Numbers that matter are expanded (width 125) at 900; headings are condensed (width 75) at 850; everything else is width 100. No third display width.

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is set on the body; every figure in the product aligns in columns, including timers that tick.

**The Striped Numeral Rule.** Striped numerals are reserved for the single hero number of a screen (countdown, live target speed, live target load). Stripes are phased from the glyph's cap top to the baseline so whole bands land on both edges; the stripe colour is the surface colour (cobalt on the field); the decimal point stays solid above the stripes.

## Layout

Mobile-first single column with a 20px page pad (`spacing.pad`). At 960px the shell becomes a 240px sticky cobalt side rail plus content; the bottom tab bar disappears and page gutters grow to 48px (`spacing.gutter`). Today on desktop runs the field band full width with the countdown and Phase lanes side by side, then two equal columns. Progress uses a 12-column grid (40px column gap) with panels spanning 8/4, 8/4, 6/6 and 12, capped at 1280px; Plan is capped at 900px.

Vertical rhythm is tight and uneven by intent: 4–6px inside lane stacks, 10–14px between a heading and its rows, 18–24px between groups. Week rows are 11px top and bottom; Plan week rows 7px. Touch targets are at least 44px; primary buttons 54px; the current set's Log button 52px. The tab bar respects `env(safe-area-inset-bottom)` and the Live field respects the top inset.

### Named Rules
**The One Answer Rule.** Each screen opens with one hero number or one instruction in the first viewport; everything else follows as rows.

## Elevation & Depth

Flat. Depth is conveyed by the cobalt field (a colour plane, not a raised surface), by the `sunk` tonal layer, and by 2px ink rules. The only shadow in the system is the settings popover, which floats over the field and is also bordered in 2px ink.

### Shadow Vocabulary
- **Popover lift** (`box-shadow: 0 10px 30px rgba(0,0,0,.18)`): the floating settings popover only.

Inset 2px box-shadows on toggles, steppers, line buttons and Plan cells are strokes, not elevation.

### Named Rules
**The Rule-Not-Card Rule.** Content groups are separated by a 2px ink top rule (panels, the Suggestion, the held-pace check, the tab bar) and 1px hairlines between rows. No bordered or shadowed cards on paper.

## Shapes

Square-shouldered. Controls take a 4px corner (`rounded.sm`); lanes, Plan cells, chart bars and rules are dead square (`rounded.none`); the avatar is the one circle (`rounded.full`). Lanes are flat bars with hard ends, never pills. Chart markers are squares (test points), never dots, except the latest HRV reading.

## Components

### Buttons
Blunt, full-height and wide.
- **Shape:** 4px corners, 54px minimum height, 20px side padding, 17px/700 labels.
- **Primary:** cobalt fill, white label, grows to fill the action row. One primary per region.
- **Line:** paper fill with a 2px inset ink stroke; hover sinks to `sunk`.
- **Hover / Focus:** primary deepens to `cobalt-hover`. Focus is a 3px `link` outline at 2px offset everywhere, switched to white inside the field.
- **Link button:** 15px/700 `link`, 2px underline at 4px offset, thickening to 3px on hover. The quiet variant is ink with no underline (secondary choice in a Suggestion, Undo).

### Toggles and steppers
- **Toggle (pain scale, area, RPE, segmented settings):** paper with 2px inset `edge` stroke, 4px corners; pressed state inverts to ink fill with paper text. Segmented controls share one 2px ink border.
- **Stepper:** 44px square, 2px inset `edge` stroke, 20px stroked plus/minus icon.
- **Log set:** edge-stroked; the current set's button turns cobalt and grows to 52px; a logged set drops its stroke and turns `good`.

### Status tag
- **Style:** cobalt fill, white 13px/700 label, 4px 8px padding. Used for "Next" only.

### Containers
- **Panels:** no background, no radius; 2px ink top rule, 14px top padding, 24px bottom.
- **Empty state:** `sunk` block with 4px corners and 18px padding; the one filled container on paper.
- **Popover:** paper, 2px ink border, 4px corners, 14px padding, 264px wide, popover lift shadow.

### Navigation
- **Side rail (≥960px):** cobalt column, uppercase wordmark, 17px/700 white items with 24px stroked icons; hover is 12% white wash; active item inverts to white fill with cobalt text. A 56px striped countdown sits at the foot except on Today.
- **Tab bar (<960px):** fixed bottom, paper with a 2px ink top rule, icon over 13px/700 label, muted at rest, `link` when current.

### Field band (signature)
The cobalt header of Today and every Live session: brand and avatar row, the striped hero numeral, a 600-weight caption, five lanes, and a footer line with Week and count. In a Live session it carries the block name, striped target, solid timer and the Coach line.

### Lanes (signature)
- **Field lanes:** 5px `cobalt-soft` tracks with white fill; the current lane is 8px and its label 800. Used for Phases on Today, exercise groups in strength Live sessions and the Logged screen.
- **Live block lanes:** 12px `rule` tracks filled in the block's Session-type colour; the current block grows to 26px with a 17px/800 label and its time or speed right-aligned in muted.
- **Week lanes (Plan, Weekly completion):** a two-digit expanded Week number, five 12px cells in Session-type order (Speed, Strength, Threshold, HYROX, Easy) outlined in 2px of their colour, filled when done, 18px tall for Key sessions; the current Week sits on `sunk` with a `link`-coloured number.
- **Lane chip:** five 3px stacked bars in the Session-type colour, 36px wide, leading each Week row on Today.
- **Motion:** fills animate width over 0.9s with `cubic-bezier(.16,1,.3,1)`; the rest bar ticks linearly over 1s. All transitions are removed under reduced motion.

### Rest timer
Sticky cobalt strip at the bottom of a strength Live session: "Rest", an 8px field lane, and the countdown at 26px/900 expanded.

### Charts
SVG on paper: 12px/600 muted axis text, `rule` gridlines, Session-type stacked bars, `link` plan and HRV lines, `speed` goal line, square markers, one bold ink annotation for the latest value.

## Do's and Don'ts

### Do:
- **Do** show progress as parallel lanes filling left to right (5px on the field, 12px on paper, 26px for the live current block).
- **Do** keep cobalt (`#1B3BB8`) constant across light and dark themes; theme only the paper side.
- **Do** stripe only the screen's hero number, phased top to baseline, with a solid decimal point.
- **Do** separate groups with a 2px ink rule and rows with a 1px `rule` hairline.
- **Do** use 4px corners on controls and square ends on lanes, cells and bars.
- **Do** underline links (2px at 4px offset) and keep tabular figures everywhere.
- **Do** pair every lane colour with its Session-type name.
- **Do** write Coach lines that state the number and the reason first, the joke second ("Slept 5 h 41. Bold strategy. Reps cut to 2 × 10′.").

### Don't:
- **Don't** use progress rings, donut charts or pill-shaped progress bars.
- **Don't** put content in bordered or shadowed cards; the popover is the only floating, shadowed surface.
- **Don't** reuse a Session-type colour for anything other than its Session type.
- **Don't** add a second accent hue to the shell, or gradients to the field.
- **Don't** stripe body figures, timers or table values; they stay solid.
- **Don't** set display type at a third width or in a different family.
- **Don't** write cheerleading or motivational-poster copy, or a joke that hides the instruction.
