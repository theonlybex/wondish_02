# Wondish CSS Design Guide
*A comprehensive reference for developers building the Wondish UI*

---

## 1. CSS Custom Properties (Tokens)

Paste this `:root` block at the top of your global stylesheet. All components reference these tokens.

```css
:root {

  /* ─── TYPOGRAPHY ─── */
  --font-primary: 'Inter', sans-serif;

  --text-display:     28px;
  --text-subhead:     15px;
  --text-label-lg:    16px;
  --text-label-md:    14px;
  --text-label-sm:    12px;
  --text-base:        14px;

  --weight-light:     300;
  --weight-regular:   400;
  --weight-medium:    500;
  --weight-bold:      700;
  --weight-extrabold: 800;


  /* ─── COLOR: NEUTRALS ─── */
  --color-white:      #FFFFFF;
  --color-black:      #000000;
  --color-text:       #1E1A1A;
  --color-dark-gray:  #4F4A4A;
  --color-gray:       #848181;
  --color-light-gray: #C1BFBF;


  /* ─── COLOR: PRIMARY (Crimson) ─── */
  --color-primary:          #812549;
  --color-primary-dark:     #5F1C35;
  --color-primary-light:    #B75E78;


  /* ─── COLOR: SECONDARY (Cream) ─── */
  --color-secondary:        #F5F1DD;
  --color-secondary-dark:   #EAE4CA;
  --color-secondary-light:  #F9F7ED;


  /* ─── COLOR: TERTIARY (Warm Gray) ─── */
  --color-tertiary:         #87806D;
  --color-tertiary-dark:    #555049;
  --color-tertiary-light:   #B6B4AB;


  /* ─── COLOR: ACCENTS ─── */
  --color-teal:             #00B9A6;
  --color-teal-dark:        #006658;
  --color-teal-mid:         #62A592;
  --color-teal-hover:       #75C6BC;
  --color-teal-light:       #8DCEBD;

  --color-red:              #D80654;
  --color-red-dark:         #840036;
  --color-red-light:        #E0A2AA;

  --color-yellow:           #FDC221;
  --color-yellow-dark:      #DEA402;
  --color-yellow-light:     #FFE9AE;

  --color-blue:             #0057FF;
  --color-blue-dark:        #003370;
  --color-blue-light:       #80B9FF;


  /* ─── SURFACES ─── */
  --surface-light:          #F9F7ED;   /* Main app background */
  --surface-dark:           #812549;   /* Header, dark sections */


  /* ─── SPACING ─── */
  --space-1:   4px;
  --space-2:   8px;
  --space-3:   12px;
  --space-4:   16px;
  --space-6:   24px;
  --space-8:   32px;
  --space-12:  48px;


  /* ─── BORDER RADIUS ─── */
  --radius-sm:    8px;
  --radius-md:    12px;
  --radius-lg:    16px;
  --radius-card:  36px;
  --radius-pill:  9999px;


  /* ─── SHADOWS ─── */
  /* None — flat UI */


  /* ─── BREAKPOINTS (use in media queries) ─── */
  /* --bp-mobile:     320px  */
  /* --bp-mobile-lg:  480px  */
  /* --bp-tablet:     768px  */
  /* --bp-desktop:    1024px */
  /* --bp-desktop-lg: 1280px */
  /* Primary layout switch: below 768px = mobile, above = desktop */

}
```

---

## 2. Typography

**Typeface:** Inter (Google Fonts)
**Weights in use:** Light (300), Regular (400), Medium (500), Bold (700), ExtraBold (800)

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;700;800&display=swap');

body {
  font-family: var(--font-primary);
  font-size: var(--text-base);
  font-weight: var(--weight-regular);
  color: var(--color-text);
}
```

| Role | Size Token | Weight Token | Usage |
|---|---|---|---|
| Display | `--text-display` (28px) | `--weight-extrabold` | Hero headings |
| Subhead | `--text-subhead` (15px) | `--weight-regular` | Hero body copy |
| Label Large | `--text-label-lg` (16px) | `--weight-bold` | Card titles |
| Label Medium | `--text-label-md` (14px) | `--weight-medium` | Buttons, filter chips |
| Label Small | `--text-label-sm` (12px) | `--weight-regular` | Metadata, captions |
| Base | `--text-base` (14px) | `--weight-regular` | General UI text |

---

## 3. Color System

### Surfaces
The UI uses two primary surfaces. Button colors are **surface-aware** — they switch automatically based on the surface they sit on.

| Token | Value | Usage |
|---|---|---|
| `--surface-light` | `#F9F7ED` | Main app background |
| `--surface-dark` | `#812549` | Header, dark sections |

---

## 4. Components

### 4.1 Header / Nav Bar

```css
.header {
  background-color: var(--surface-dark);    /* #812549 */
  height: 64px;
  width: 100%;
  position: static;   /* scrolls away with page */
  display: flex;
  align-items: center;
  padding: 0 var(--space-4);
}

.header__logo {
  height: 28px;   /* export logo as SVG for resolution independence */
}
```

---

### 4.2 Search Input

```css
.search-input {
  width: 100%;
  height: 48px;
  background-color: var(--color-white);
  border: 1px solid var(--color-tertiary);    /* #87806D */
  border-radius: var(--radius-pill);
  padding: 0 var(--space-4);
  font-family: var(--font-primary);
  font-size: var(--text-label-md);
  font-weight: var(--weight-regular);
  color: var(--color-text);
}

.search-input::placeholder {
  color: var(--color-light-gray);   /* #C1BFBF */
}
```

---

### 4.3 Buttons

All buttons share these base properties:

```css
.btn {
  height: 48px;
  padding: 0 var(--space-6);          /* 0 24px */
  border-radius: var(--radius-pill);
  font-family: var(--font-primary);
  font-size: var(--text-label-md);    /* 14px */
  font-weight: var(--weight-medium);
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease, color 0.2s ease;
}
```

#### Primary Button (on `--surface-light`)

| State | Background | Text |
|---|---|---|
| Active | `#812549` | `#FFFFFF` |
| Hover | `#B75E78` | `#FFFFFF` |
| Click | `#812549` | `#FFFFFF` |
| Inactive | `#5F1C35` | `#FFFFFF` |

```css
.btn--primary {
  background-color: var(--color-primary);
  color: var(--color-white);
}
.btn--primary:hover {
  background-color: var(--color-primary-light);
}
.btn--primary:active {
  background-color: var(--color-primary);
}
.btn--primary:disabled {
  background-color: var(--color-primary-dark);
  cursor: not-allowed;
}
```

#### Secondary Button (on `--surface-light`)
*Ghost/outlined style when active.*

| State | Background | Text | Border |
|---|---|---|---|
| Active | `#F9F7ED` | `#812549` | `1px solid #812549` |
| Hover | `#B75E78` | `#FFFFFF` | none |
| Click | `#812549` | `#FFFFFF` | none |
| Inactive | `#EAE4CA` | `#C1BFBF` | none |

```css
.btn--secondary {
  background-color: var(--surface-light);
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
}
.btn--secondary:hover {
  background-color: var(--color-primary-light);
  color: var(--color-white);
  border: none;
}
.btn--secondary:active {
  background-color: var(--color-primary);
  color: var(--color-white);
  border: none;
}
.btn--secondary:disabled {
  background-color: var(--color-secondary-dark);
  color: var(--color-light-gray);
  border: none;
  cursor: not-allowed;
}
```

#### Teal Button (on `--surface-dark` / `#812549`)

| State | Background | Text |
|---|---|---|
| Active | `#00B9A6` | `#000000` |
| Hover | `#75C6BC` | `#000000` |
| Click | `#00B9A6` | `#000000` |
| Inactive | `#8DCEBD` | `#6AAA98` |

```css
.surface-dark .btn,
.btn--teal {
  background-color: var(--color-teal);
  color: var(--color-black);
}
.surface-dark .btn:hover,
.btn--teal:hover {
  background-color: var(--color-teal-hover);
}
.surface-dark .btn:active,
.btn--teal:active {
  background-color: var(--color-teal);
}
.surface-dark .btn:disabled,
.btn--teal:disabled {
  background-color: var(--color-teal-light);
  color: #6AAA98;
  cursor: not-allowed;
}
```

---

### 4.4 Filter Chips

```css
.chip {
  height: 31px;
  padding: 0 var(--space-3);          /* 0 12px */
  border-radius: var(--radius-pill);
  font-family: var(--font-primary);
  font-size: var(--text-label-md);    /* 14px */
  font-weight: var(--weight-medium);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  cursor: pointer;
}

/* Active chip */
.chip--active {
  background-color: #8DCEBD;
  border: 1px solid #62A592;
  color: #006658;
}

/* Inactive chip */
.chip--inactive {
  background-color: var(--color-secondary-dark);  /* #EAE4CA */
  border: 1px solid var(--color-tertiary-light);  /* #B6B4AB */
  color: #838071;
}
```

---

### 4.5 Filters Button

A standalone UI control — distinct from primary/secondary buttons.

| Property | Value |
|---|---|
| Background | `#FFFFFF` |
| Border | none |
| Border radius | `--radius-pill` |
| Font | Inter Medium, 14px |
| Text — active | `#000000` |
| Text — inactive | `#C1BFBF` |
| Icon color | `#838071` |

```css
.filters-btn {
  height: 48px;
  padding: 0 var(--space-4);
  background-color: var(--color-white);
  border: none;
  border-radius: var(--radius-pill);
  font-family: var(--font-primary);
  font-size: var(--text-label-md);
  font-weight: var(--weight-medium);
  color: var(--color-black);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}

.filters-btn--inactive {
  color: var(--color-light-gray);
}

.filters-btn__icon {
  color: #838071;
}

/* Badge */
.filters-badge {
  background-color: var(--color-red-light);   /* #E0A2AA */
  color: var(--color-white);
  font-size: var(--text-label-sm);            /* 12px */
  font-weight: var(--weight-medium);
  border-radius: var(--radius-pill);
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

---

### 4.6 Result Card

```css
.card {
  background-color: var(--color-white);
  border: 1px solid var(--color-secondary-dark);  /* #EAE4CA */
  border-radius: var(--radius-card);              /* 36px */
  overflow: hidden;
  position: relative;
}

/* Card image */
.card__image {
  width: 90%;
  height: 104px;
  object-fit: cover;
  border-radius: 20px 20px 0 0;
  display: block;
  margin: 0 auto;
}

/* Card body */
.card__body {
  padding: 20px;
}

/* Card title */
.card__title {
  font-size: var(--text-label-lg);    /* 16px */
  font-weight: var(--weight-bold);
  color: var(--color-text);
  margin: 0 0 var(--space-1) 0;
}

/* Card metadata (category, location) */
.card__meta {
  font-size: var(--text-label-sm);    /* 12px */
  font-weight: var(--weight-regular);
  color: var(--color-gray);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* "View Menu →" CTA */
.card__cta {
  font-size: var(--text-label-md);    /* 14px */
  font-weight: var(--weight-medium);
  color: var(--color-teal-dark);      /* #006658 */
  text-decoration: none;
  display: block;
  text-align: right;
  margin-top: var(--space-3);
}
```

---

### 4.7 Favorite Icon Button

A circular button overlaid on the card image.

| State | Container BG | Container Border | Icon BG | Icon Border |
|---|---|---|---|---|
| Default | `#F5F1DD` | `#B6B4AB` | `#F5F1DD` | `#87806D` |
| Hover | `#F5F1DD` | `#D80654` | `#F5F1DD` | `#B6B4AB` |
| Favorited | `#F5F1DD` | `#B6B4AB` | `#D80654` | `#D80654` |

```css
.fav-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  background-color: #F5F1DD;
  border: 1px solid var(--color-tertiary-light);  /* #B6B4AB */
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  transition: border-color 0.2s ease;
}

.fav-btn__icon {
  background-color: #F5F1DD;
  border: 1px solid var(--color-tertiary);        /* #87806D */
  border-radius: var(--radius-pill);
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Hover state */
.fav-btn:hover {
  border-color: var(--color-red);                 /* #D80654 */
}
.fav-btn:hover .fav-btn__icon {
  border-color: var(--color-tertiary-light);      /* #B6B4AB */
}

/* Favorited / active state */
.fav-btn--active .fav-btn__icon {
  background-color: var(--color-red);             /* #D80654 */
  border-color: var(--color-red);
}
```

---

## 5. Breakpoints

```css
/* Mobile first — base styles target mobile (320px+) */

/* Large phone */
@media (min-width: 480px) { }

/* Tablet */
@media (min-width: 768px) { }

/* Desktop — primary layout switch */
@media (min-width: 1024px) { }

/* Large desktop */
@media (min-width: 1280px) { }
```

---

## 6. TBD / Pending

| Item | Status |
|---|---|
| Icon library | TBD — to be confirmed by designer |
| Logo file | Export as SVG from Illustrator |
| Desktop layout specs | Pending design handoff |

---

*Last updated: June 2026. Maintained by the Wondish design team.*
