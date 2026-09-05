// graph-profile-viz — pure renderer of the construction sheets from graph-profile-data.
// Each sheet ships render-ready geometry (a clean domain-intrinsic mesh with its boundary
// sampled exactly, or a polyline); the viz just draws it. Complement duality is store-once:
// `self` -> draw + mark the crossover point; `reflect` -> also draw the reflected surface.
// The parametric map + implicit poly are carried in the sheet for reference, not rendering.

const COLORS = { data: '#d62728' };  // numerical sample-cloud red
// One color per display group; complement pairs share their group's color.
const PALETTE = ['#3b6ea5', '#c0572a', '#1a8c76', '#7d45a0', '#7f8c8d'];
const RIM_WIDTH = 2.5; // surface boundary outline width (crisp over the translucent fill)

// Pattern-size groups (one per row-of-vertices "coordinate system" the manifest carries — m=3's 3
// free coordinates, m=4's 10), populated by load() from `manifest.groups`. Every sheet's geometry
// point/vertex row is the concatenation of every group's free coordinates in this order (`offset`
// into the row, `width` coordinates wide), `null`-filled for any group a construction hasn't been
// migrated to (see the producer's `unified_row`) — so the row length is uniform across every sheet
// regardless of how many pattern sizes it actually has data for. This default (just the m=3 group)
// reproduces today's hardcoded m=3 behavior so `reflect`/`axisVal` still work before the manifest
// has loaded.
let GROUPS = [{ m: 3, offset: 0, width: 3, coords: ['d1', 'd2', 'd3'], implicitKey: 'd0', complementPerm: [3, 2, 1, 0], derived: {} }];
// Complement reflection: permutes each group's own [implicit, ...coords] slice of the row (i.e.
// [d0,d1,d2,d3] within the m=3 slice) via that group's `complementPerm`, then drops the implicit
// coordinate again — leaving every other group's slice untouched. A slice shorter than the group
// needs (a bare 3-wide boundary/corner/sliceRow point, never unified-width) or containing a `null`
// (this construction has no data for that group) is left as-is: there is nothing to reflect.
const reflect = (v) => {
  const out = v.slice();
  for (const grp of GROUPS) {
    if (grp.offset + grp.width > v.length) continue;
    const slice = v.slice(grp.offset, grp.offset + grp.width);
    if (slice.some((x) => x == null)) continue;
    const full = [1 - slice.reduce((a, x) => a + x, 0), ...slice];
    const permuted = grp.complementPerm.map((i) => full[i]).slice(1);
    for (let i = 0; i < grp.width; i++) out[grp.offset + i] = permuted[i];
  }
  return out;
};

// ---- presentation config (consumer-side: grouping, titles, colors) ----
// Merge data groups into display groups. The "Multipartite Graphs" group collects the multipartite /
// disjoint-clique constructions together with the triangle-minimal constructions at fixed edge density
// (Razborov scallops, Lo's regular band, Glebov h_A, bipartite); the visual aids and numerical bounds
// (linear interpolation, flag-algebra SDP samples) live in a separate "References" group so they read
// as references rather than constructions.
const DISPLAY_GROUP = {
  'razborov':              'cliques',
  'plateau':               'cliques',
  'rise':                  'cliques',
  'regular-razborov':      'cliques',
  'glebov-ha':             'cliques',
  'bipartite':             'cliques',
  'c5-blowup':             'cliques',
  'disjoint-cliques':  'cliques',
  'huang-et-al':       'clique-independent',       // Huang's clique + independent-set construction
  'razborov-lo-crease': 'cliques',                // crease on the triangle-minimal boundary
  'split-crease':       'clique-independent',      // threshold-graph crease
  // bound surfaces (groups bound-*) — shown in the section of the construction they bound:
  'bound-goodman-reg':  'regular',
  'bound-goodman-tri':  'cliques',
  'bound-razborov':     'cliques',
  'bound-huang':        'clique-independent',
};
// Per-id overrides take priority (for sheets whose data group differs from the display group).
const DISP_BY_ID = {
  'razborov-interp':       'references',   // visual aids + numerical bounds, not constructions
  '6-vertex flag algebra': 'references',
  '7-vertex flag algebra': 'references',
  'christoph-6-vertex':    'references',
  'christoph-7-vertex':    'references',
  'gnp':                   'regular',           // Erdős–Rényi quasirandom curve, on the Goodman surface
  'regular-cherry-ridge':  'regular',           // co-cherry-maximal regular family (d=1/4 ridge)
  'even-disjoint-cliques': 'cliques',           // balanced complete k-partite cusps + the complete graph K
  'multipartite-tpartite': 'cliques',           // complete t-partite curves (t=2..9) on the surface
};
const baseGroup = (s) => (s.group || s.family || '').replace(/^co-/, '');
const dispGroup = (s) => DISP_BY_ID[s.id] || DISPLAY_GROUP[baseGroup(s)] || baseGroup(s);
// Sheets that ALSO appear as a (duplicate) legend row under an extra group, besides their primary
// dispGroup — e.g. Razborov and Huang also read as rim curves of the disjoint-clique surface, and Lo's
// regular-razborov curve is both a triangle extreme and a rim of the regular (Goodman) surface.
// Keyed by base group; the duplicate row keeps the sheet's own colour and shares its enabled state
// (toggling either row flips the same trace).
const ALSO_IN_GROUP = {
  'huang-et-al':      ['cliques'],
  'regular-razborov': ['regular'],
  rise:               ['regular'],   // the rise climbs to the regular (Lo) minimizer — also a regular-graphs row
};
const extraGroups = (s) => ALSO_IN_GROUP[baseGroup(s)] || [];
// Per-(extra-group, sheet) legend title override: a sheet shown as a duplicate row under an extra
// group may read as its complement there.
const ALSO_TITLE = {};
// Explicit within-section row order (by sheet id); ids not listed keep their data/array order and
// sort after the listed ones. Co-density sheets ride along with their density row, so only the
// density ids matter here.
const SECTION_ORDER = [
  'regular', 'regular-cherry-ridge', 'gnp', 'goodman-reg', // Regular Graphs (rise rides along via ALSO_IN_GROUP)
  'clique-independent', 'huang-et-al', 'huang-bound', // Threshold Graphs
  'complete-multipartite', 'multipartite-tpartite', 'disjoint-cliques', 'even-disjoint-cliques', // Multipartite Graphs (core)
  'bipartite', 'c5-blowup', 'plateau', 'rise', 'razborov-lo-crease', 'glebov-ha', 'razborov', 'razborov-bound', 'goodman-tri', 'regular-razborov', // Multipartite Graphs (triangle-minimal members)
  '6-vertex flag algebra', '7-vertex flag algebra', 'christoph-6-vertex', 'christoph-7-vertex', 'razborov-interp', // refs
  'lp-relaxation-n4', 'lp-relaxation-n5', 'lp-relaxation-n6', 'lp-relaxation-n7', 'lp-relaxation-n8', 'lp-relaxation-n9', 'lp-relaxation-n10', 'lp-relaxation-n11', // LP relaxations (outer → inner)
];
const orderIdx = (s) => { const i = SECTION_ORDER.indexOf(s.id); return i < 0 ? 1e9 : i; };
// Sidebar group headers.
const GROUP_TITLE = {
  regular:          'Regular Graphs',
  cliques:          'Multipartite Graphs',
  'clique-independent': 'Threshold Graphs',
  references:       'References',
  'lp-relaxation':  'LP Relaxations',
};
// Member titles — the specific role of each sheet.
const TITLE = {
  regular: 'Regular Graphs',
  'regular-cherry-ridge': 'Co-cherry Ridge',
  gnp: 'G(n,p)',
  'regular-razborov': 'Lo',
  'disjoint-cliques': 'Disjoint Cliques',
  'complete-multipartite': 'Complete Multipartite',
  razborov: 'Razborov',
  'plateau': 'Razborov-Pikhurko',
  'rise': 'Rise',
  bipartite: 'Bipartite Graphs',
  'c5-blowup': 'Triangle-free Non-bipartite',
  'clique-independent': 'Threshold Graphs',
  'huang-et-al': 'Huang et al.',
  'co-huang-et-al': 'Complement of Huang et al.',
  'glebov-ha': 'Glebov et al.',
  'razborov-lo-crease': 'Razborov–Lo crease',
  'split-crease': 'Threshold-graph crease',
  'lp-relaxation-n4': 'n ≤ 4',
  'lp-relaxation-n5': 'n ≤ 5',
  'lp-relaxation-n6': 'n ≤ 6',
  'lp-relaxation-n7': 'n ≤ 7',
  'lp-relaxation-n8': 'n ≤ 8',
  'lp-relaxation-n9': 'n ≤ 9',
  'lp-relaxation-n10': 'n ≤ 10',
  'lp-relaxation-n11': 'n ≤ 11',
  'razborov-interp': 'Linear Interpolation',
  '6-vertex flag algebra': '6 Vertex (Bernard)',
  '7-vertex flag algebra': '7 Vertex (Bernard)',
  'christoph-6-vertex': '6 Vertex (Christoph)',
  'christoph-7-vertex': '7 Vertex (Christoph)',
  'even-disjoint-cliques': 'Even Complete Multipartite Graphs',
  'multipartite-tpartite': 'Complete t-Partite',
  simplex: 'Probability Simplex',
  'goodman-reg': 'Goodman (regularity)',
  'goodman-tri': 'Goodman (triangle)',
  'razborov-bound': 'Razborov',
  'huang-bound': 'Huang et al.',
};
// Member descriptions — clean exact definitions of each family (the graph or graphon it is),
// nothing else. Shown truncated with a show-more toggle. Falls back to `description` when absent.
const DESC = {
  regular: 'Graphons of constant degree $d \\in [0,1]$: $d_W(x) = d$ for almost every vertex $x$; the induced triangle density $d_3$ is the free second parameter.',
  razborov: 'Complete multipartite with $t$ parts of relative size $s$ and one part of relative size $1 - ts \\in [0, s]$, all edges between distinct parts and none within. Valid for every edge density $d \\in [0,1)$, with $t = \\lfloor 1/(1-d) \\rfloor$ and $s$ fixed by $d$.',
  'plateau': 'The flat floor of the triangle-minimal boundary. For scallop $t = \\lfloor 1/(1-d) \\rfloor$ with Razborov part size $s$: $t-1$ independent parts of relative size $s$, joined completely to one another and to a remaining part of relative size $1-(t-1)s$ that carries an arbitrary triangle-free graphon of edge density $\\rho = 2s(1-ts)/(1-(t-1)s)^2$. The triangle density depends only on $\\rho$, so it stays at the proven Razborov minimum while the co-cherry $d_1$ ranges from $0$ (complete-bipartite filling, Razborov) up to the Razborov–Lo crease (balanced regular-bipartite filling); the distinct fillings are the non-isomorphic Razborov minimizers.',
  'co-plateau': '$\\sigma$-complement (co-densities) of the plateau: $t-1$ disjoint cliques of relative size $s$, disjoint from a remaining part of relative size $1-(t-1)s$ carrying a co-triangle-free graphon (the complement of a triangle-free filling). The co-triangle density holds at the minimum while $d_2$ ranges to the crease — the complement of each Razborov minimizer.',
  'rise': 'Conjectured climb of the triangle-minimal boundary from the Razborov–Lo crease to the regular (Lo) minimizer — the same family as Lo. For scallop $t = \\lfloor 1/(1-d) \\rfloor$: two parts of relative size $\\ell/2$ and $t-1$ parts of relative size $(1-\\ell)/(t-1)$, all pairs of parts complete except the two size-$\\ell/2$ parts, joined at a reduced edge density $p < 1$ (at $p = 1$ it is a complete multipartite graph). At each edge density the arc sweeps $\\ell$ and $p$ from the crease ($d_1 = c^*(d)$, triangle density still at the Razborov minimum) to Lo ($p$ tuned so the graphon is regular, $\\delta_2 = d^2$, $d_3 = g(d)$). Conjectural.',
  'co-rise': '$\\sigma$-complement (co-densities) of the rise: two cliques of relative size $\\ell/2$ and $t-1$ cliques of relative size $(1-\\ell)/(t-1)$, all pairs disjoint except the two size-$\\ell/2$ cliques, joined at density $1-p$. Conjectural arc from the crease to the regular point.',
  'co-razborov': 'Disjoint union of cliques: $t$ cliques of relative size $s$ and one of relative size $1 - ts \\in [0, s]$, all edges within parts and none between. Valid for every edge density $d \\in (0,1]$, with $t = \\lfloor 1/d \\rfloor$ and $s$ fixed by $d$.',
  'regular-razborov': 'Complete multipartite with two parts of relative size $\\ell/2$ and $t-1$ parts of relative size $(1-\\ell)/(t-1)$, where $t = \\lfloor 1/(1-d) \\rfloor$ and $\\ell \\in [1/t,\\, 2/(t+1)]$. The two size-$\\ell/2$ parts are joined at a reduced edge density $p = 2 - 2(1-\\ell)/\\bigl((t-1)\\,\\ell\\bigr)$ instead of completely; all other pairs of parts stay complete and there are no edges within parts. This choice of $p$ makes every degree equal (regular), so $\\delta_2 = d^2$.',
  'co-regular-razborov': 'Disjoint union of cliques: two cliques of relative size $\\ell/2$ and $t-1$ cliques of relative size $(1-\\ell)/(t-1)$, where $t = \\lfloor 1/d \\rfloor$ and $\\ell \\in [1/t,\\, 2/(t+1)]$. The two size-$\\ell/2$ cliques are joined to each other at density $1 - p$ (with $p$ as in the regular min-triangle construction); all other clique pairs are disjoint. Complement of the regular min-triangle construction.',
  'disjoint-cliques': 'Disjoint union of cliques of arbitrary relative sizes.',
  'complete-multipartite': 'Complete multipartite: a vertex partition with all edges between distinct parts and none within.',
  bipartite: 'Two parts of relative size $a \\in [0, 1/2]$ and $1-a$ with edges between them at density $p \\in [0,1]$ and no edges within either part.',
  'c5-blowup': 'Five equal parts each of relative size $b \\in [0, 1/5]$, with edge density $p \\in [0,1]$ between cyclically adjacent pairs (in the $C_5$ pattern) and no other edges; the remaining mass $1-5b$ is an independent set. Triangle-free and non-bipartite. At $b = 1/5$, $p = 1$ this is the Andrásfai–Erdős–Sós extremal graphon at edge density $d = 2/5$.',
  'co-bipartite': 'Two cliques of relative size $a \\in [0, 1/2]$ and $1-a$ with edges between them at density $1 - p$, $p \\in [0,1]$.',
  'huang-et-al': 'Disjoint union of cliques: a single clique of relative size $a \\in [0,1]$ together with an independent set of relative size $1-a$, no edges between them.',
  'razborov-lo-crease': 'The Razborov–Lo crease: the upper rim of the Razborov plateau (edge density $d \\in [1/2, 2/3]$) where the flat Razborov-minimum surface meets the regular (Lo) band. The triangle-minimal boundary is continuous but non-smooth ($C^0$, not $C^1$) along it.',
  'split-crease': 'The threshold-graph crease: the $\\sigma$-self-intersection of the threshold-graph (clique + independent-set) surface, where it meets its own $\\sigma$-complement. The boundary is continuous but non-smooth there.',
  'co-huang-et-al': 'Complete multipartite: an independent set of relative size $a \\in [0,1]$ and a clique of relative size $1-a$, all edges between distinct parts.',
  'clique-independent': 'A clique of relative size $a$ and two independent sets of relative size $b$ and $1-a-b$ (with $a, b \\ge 0$ and $a + b \\le 1$); all edges run between the clique and the size-$(1-a-b)$ independent set, with no other edges between parts.',
  'co-clique-independent': 'A clique of relative size $1-a$ and an independent set of relative size $a$ (with $a, b \\ge 0$ and $a + b \\le 1$), the independent set joined completely to a sub-part of the clique of relative size $b$.',
  'glebov-ha': 'Independent sets of relative size $\\sigma, \\sigma, b, b$ (with $b = (1-2\\sigma)/2$); every pair of parts joined completely except the two size-$b$ parts, joined at density $1 - (4\\sigma-1)/((1-2\\sigma)\\sqrt{5-12\\sigma})$. $\\sigma \\in [1/4, 1/3]$.',
  'razborov-interp': 'Within each fixed-edge-density slice, the straight segment between the disjoint-union-of-cliques point and the constant-degree point.',
  // Complement (co-density) descriptions for the inline-reflected items (the data `co-…` sheets
  // carry their own descriptions above).
  'co-glebov-ha': 'Independent sets of relative size $\\sigma, \\sigma, b, b$ (with $b = (1-2\\sigma)/2$); every pair of parts joined completely except the two size-$b$ parts, joined at density $1 - (4\\sigma-1)/((1-2\\sigma)\\sqrt{5-12\\sigma})$. $\\sigma \\in [1/4, 1/3]$.',
  'co-razborov-interp': 'Complement densities of the linear-interpolation reference line.',
  'co-6-vertex flag algebra': 'Complement densities of the 6-vertex flag-algebra min-triangle bounds.',
  'co-7-vertex flag algebra': 'Complement densities of the 7-vertex flag-algebra min-triangle bounds.',
  'co-christoph-6-vertex': 'Complement densities of the 6-vertex flag-algebra min-triangle bounds (flagalgebra.rs).',
  'co-christoph-7-vertex': 'Complement densities of the 7-vertex flag-algebra min-triangle bounds (flagalgebra.rs).',
  simplex: 'The probability simplex $\\{\\, d_i \\ge 0,\\ \\sum_i d_i = 1 \\,\\}$ — the boundary frame of all feasible 3-profiles, drawn as a reference.',
  'lp-relaxation-n4': 'The level-4 LP relaxation: the convex hull of the induced 3-profiles of all graphs on $4$ vertices. This is exactly the full probability simplex — all four corners are realized by single 4-vertex graphs ($\\overline{K_4}$, $2K_2$, $C_4$, $K_4$), so the LP proves nothing about 3-profiles at $n = 4$.',
  'lp-relaxation-n5': 'The level-5 LP relaxation: the convex hull of the induced 3-profiles of all graphs on $5$ vertices. The first genuine LP cuts — e.g. the corner $d_1 = 1$ dies (no 5-vertex graph has every triple a single edge), pulling the hull strictly inside the simplex.',
  'lp-relaxation-n6': 'The level-6 LP relaxation: the convex hull of the induced 3-profiles of all graphs on $6$ vertices. Strictly tighter than $n = 5$.',
  'lp-relaxation-n7': 'The level-7 LP relaxation: the convex hull of the induced 3-profiles of all graphs on $7$ vertices. An outer polytope containing $\\Delta_3$ — the exact reach of positive subgraph-density (LP) certificates at $n = 7$. Flat facets only; it captures forbidden-subgraph boundaries (Mantel/Turán, Kruskal–Katona) but chords flat across every regular-tight piece (Goodman, the Razborov scallops).',
  'lp-relaxation-n8': 'The level-8 LP relaxation: the convex hull of the induced 3-profiles of all graphs on $8$ vertices. Nested inside the $n = 7$ polytope and strictly tighter; same flat-facet character.',
  'lp-relaxation-n9': 'The level-9 LP relaxation: the convex hull of the induced 3-profiles of all graphs on $9$ vertices. $\\mathrm{P}_{3,9} \\subsetneq \\cdots \\subsetneq \\mathrm{P}_{3,5} \\subsetneq \\mathrm{P}_{3,4} = \\text{simplex}$, all shrinking toward $\\mathrm{conv}(\\Delta_3)$.',
  'lp-relaxation-n10': 'The level-10 LP relaxation: the convex hull of the induced 3-profiles of all $\\approx 1.2 \\times 10^{7}$ graphs on $10$ vertices. Nested inside $n = 9$ and strictly tighter.',
  'lp-relaxation-n11': 'The level-11 LP relaxation: the convex hull of the induced 3-profiles of all $\\approx 1.0 \\times 10^{9}$ graphs on $11$ vertices — the tightest LP outer bound computed here. Still flat-faceted: even at this level the LP never reaches the curved, regular-tight boundary (Goodman, the Razborov scallops); that gap is intrinsic to the LP proof system, not a question of size.',
  'goodman-reg': 'Goodman regularity bound $\\delta_2 \\ge d^2$: the full surface $\\delta_2 = d^2$ (equivalently $\\mathrm{Var}(\\deg) = 0$) across the whole simplex, including its non-realizable parts. The realizable region lies on the $\\delta_2 \\ge d^2$ side; equality holds exactly for regular graphons. Self-complementary.',
  'goodman-tri': 'Goodman triangle bound $d_3 \\ge d(2d-1)$: the surface $d_3 = d(2d-1)$ for $d \\ge 1/2$. A valid but non-tight lower bound — it meets the Razborov floor only at $d = 1 - 1/k$ and dips strictly below between those points.',
  'razborov-bound': 'Razborov edge–triangle bound $d_3 \\ge g(d)$: the exact minimum triangle density $g(d)$ at edge density $d$ (the scalloped Razborov–Reiher curve), swept across the simplex. Tight — equality on the Razborov surface.',
  'huang-bound': 'Huang et al. bound on the (co-triangle, triangle) projection: the extremal curve $d_0 = (1-a)^2(1+2a),\\ d_3 = a^3$ traced by a clique of relative size $a$ together with an independent set, swept over the free $d_1$–$d_2$ split. The realizable region projects inside it.',
};
// One base hue per display group; members share it (complement → transparent, curves → darker).
// Hues are spread around the wheel so no two active groups read as the same colour.
const GROUP_COLOR = {
  regular: '#2e8b57',              // green  (~146°)
  cliques: '#b5179e',              // magenta (~313°) — the isolated arc between purple and red
  'clique-independent': '#e07b1a', // orange (~31°)
  'lp-relaxation': '#6a4cc7',      // indigo (~255°) — outer relaxations, distinct from every construction hue
};
// Per-sheet color overrides (bypass the group hue for individual sheets).
const SHEET_COLOR = {
  rise: '#1ab8cf',                 // cyan (~188°) — distinguishable from the Multipartite Graphs magenta
  bipartite: '#2f6fd6',            // blue (~215°) — Bipartite and Razborov-Pikhurko read blue, apart from the
  plateau: '#2f6fd6',              //   group magenta (which Complete Multipartite keeps)
  // LP-relaxation polytopes: one indigo per level, lighter outer (n=4) → darker inner (n=11), so the
  // nested translucent solids stay distinguishable when several are shown at once.
  'lp-relaxation-n4': '#ddd6f5',
  'lp-relaxation-n5': '#c7bced',
  'lp-relaxation-n6': '#b1a2e4',
  'lp-relaxation-n7': '#9b88da',
  'lp-relaxation-n8': '#846ecb',
  'lp-relaxation-n9': '#6d54b5',
  'lp-relaxation-n10': '#543c98',
  'lp-relaxation-n11': '#3a2a6e',
};
// Per-item type, shown as a pill after the title:
//   bound        — an analytic bound, not a single graph family (the flag-algebra SDP samples)
//   reference    — NOT a construction: a visual guide (the linear-interpolation surface)
//   construction — an explicit realizable graph family (everything else)
const TYPE_BOUND = new Set(['6-vertex flag algebra', '7-vertex flag algebra', 'christoph-6-vertex', 'christoph-7-vertex']);
const TYPE_REF = new Set(['razborov-interp', 'simplex']);
// Constructions that are NOT yet proven tight keep the "Construction" pill (conjectural / pending);
// every other construction is a proven extremal boundary and instead reads "3-TIGHT".
const NOT_TIGHT = new Set(['rise', 'glebov-ha', 'regular-cherry-ridge', 'regular-razborov', 'clique-independent',
  'razborov-lo-crease', 'split-crease']);
const TYPE_LABEL = { bound: 'Flag Algebra', tight: '3-TIGHT', construction: 'Constr.', reference: 'Reference', ineq: 'Bound', lp: 'LP' };
function sheetType(s) {
  if (baseGroup(s) === 'lp-relaxation') return 'lp';     // level-n LP outer polytopes (proven outer bound)
  if (baseGroup(s).startsWith('bound')) return 'ineq';   // proven inequality surfaces (groups bound-*)
  if (TYPE_REF.has(s.id)) return 'reference';
  if (TYPE_BOUND.has(s.id)) return 'bound';
  return NOT_TIGHT.has(s.id) ? 'construction' : 'tight';
}
const COLOR_REF = '#9e9e9e'; // grey — the non-construction reference (the interpolation surface)
// One-sided overlay objects (the old "reference" group): off by default, and their σ-mirror is
// drawn inline so a single legend toggle shows both halves of an otherwise one-sided object.
const OVERLAY = new Set(['razborov-interp', '6-vertex flag algebra', '7-vertex flag algebra', 'christoph-6-vertex', 'christoph-7-vertex', 'glebov-ha', 'even-disjoint-cliques', 'rise', 'plateau', 'regular-cherry-ridge',
  // The three swept (non-graphon) bound surfaces are not emitted as separate co-* sheets by the
  // producer — their σ-mirror is drawn inline, avoiding shipping a second copy of a mesh that's
  // mathematically just a reflection (same reasoning as rise/plateau above).
  'goodman-tri', 'razborov-bound', 'huang-bound',
  // LP-relaxation polytopes are self-complementary: the sheet carries the density half (d ≤ 1/2)
  // and the d ≥ 1/2 co-half is drawn inline as its σ-mirror under the complement toggle.
  'lp-relaxation-n4', 'lp-relaxation-n5', 'lp-relaxation-n6', 'lp-relaxation-n7', 'lp-relaxation-n8', 'lp-relaxation-n9', 'lp-relaxation-n10', 'lp-relaxation-n11']);
// Darken a #rrggbb hex by factor f (<1 = darker) — used to shade scallop curves within a group.
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
// Rotate a #rrggbb hex's hue by `deg` (via HSL) — bounds take a hue adjacent to their construction.
function hueShift(hex, deg) {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dl = mx - mn;
  let h = 0, s = 0;
  if (dl) { s = l > 0.5 ? dl / (2 - mx - mn) : dl / (mx + mn); h = 60 * (mx === r ? (g - b) / dl + (g < b ? 6 : 0) : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4); }
  h = (h + deg + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  const R = Math.round((seg[0] + m) * 255), G = Math.round((seg[1] + m) * 255), B = Math.round((seg[2] + m) * 255);
  return '#' + ((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1);
}
// Desaturate + lighten a #rrggbb colour — tints complement (co-density) surfaces so they read as a
// washed-out version of their density partner's hue even when the transparency toggle forces opacity 1.
function coTint(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const L = 0.299 * r + 0.587 * g + 0.114 * b;             // perceived luminance — the grey to pull toward
  const sat = 0.5, lift = 0.3;                             // 50% toward grey, then 30% toward white
  const f = (c) => { const v = (c * sat + L * (1 - sat)) * (1 - lift) + 255 * lift; return Math.max(0, Math.min(255, Math.round(v))); };
  return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
}
// Per-bound hue offset (degrees) from its section colour — distinct per bound, co-version shares it.
const BOUND_HUE = { 'bound-goodman-reg': 26, 'bound-goodman-tri': -30, 'bound-razborov': 34, 'bound-huang': 28 };
// A sheet is a complement iff its FAMILY is co-prefixed (every data co-sheet carries a co- family).
// We key off family, not id, so a swapped pair (e.g. co-huang-et-al made primary) reads correctly.
const isCoSheet = (s) => /^co-/.test(s.family || '');
const isCurveSheet = (s) => s.kind === 'parametric_curve' || (s.geometry && s.geometry.kind === 'polyline');
// How the sheet is actually drawn — used for the little legend glyph (point / curve / surface).
function geomKind(s) {
  if (s.kind === 'frame') return 'frame';
  if (s.kind === 'points') return 'point';
  if (isCurveSheet(s)) return 'curve';
  return 'surface';
}
// A small inline SVG glyph mirroring how the sheet renders in the plot, in its own colour.
function typeIconSVG(kind, c) {
  if (kind === 'frame')   // triangle outline (the simplex frame)
    return `<svg viewBox="0 0 16 12"><path d="M8 1.5 L14.5 10.5 L1.5 10.5 Z" fill="none" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  if (kind === 'surface')
    return `<svg viewBox="0 0 16 12"><rect x="1.5" y="2.5" width="13" height="7" rx="1.5" fill="${c}" fill-opacity="0.38" stroke="${c}" stroke-width="1.2"/></svg>`;
  if (kind === 'curve')
    return `<svg viewBox="0 0 16 12"><path d="M1 8.5 Q5 1 8 6 T15 4" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  return `<svg viewBox="0 0 16 12"><g stroke="${c}" stroke-width="1.4" stroke-linecap="round">`   // points → × marks
    + `<path d="M2 3.5l2.2 2.2M4.2 3.5l-2.2 2.2"/><path d="M11.8 6.3l2.2 2.2M14 6.3l-2.2 2.2"/><path d="M7 1.5l2.2 2.2M9.2 1.5l-2.2 2.2"/></g></svg>`;
}
// One authoritative "active" set (by density id) that carries through every view — switching mode
// never resets it. Each density's co-sheet rides along. This is the default; the user's edits are
// persisted and override it until they hit "Default".
const DEFAULT_ON = new Set([
  'regular',                                   // Regular Graphs
  'clique-independent',                        // Threshold Graphs
  'complete-multipartite', 'even-disjoint-cliques', // Multipartite Graphs (core)
  'bipartite', 'plateau', 'rise',              // Multipartite Graphs (triangle-minimal members; creases off by default)
  'simplex',                                   // References — the probability-simplex frame
]);
// Every construction has m=3 data (see the producer's `M4Construction` doc comment — m=4 is only
// ever an addition on top), so one shared default-visible set governs every sheet regardless of
// which pattern sizes it also carries. Used both by the initial load and the "Default" button.
const defaultEnabled = (id) => DEFAULT_ON.has(id);
// Reset `list` (default: every sheet) to the authoritative default (co-density rides along its
// density row). Callable with a scoped subset — e.g. one legend section's sheets — so a per-section
// "Default" action only resets that section, leaving the rest of the current selection untouched.
function applyDefaults(list = sheets) {
  for (const s of list) enabled[s.id] = defaultEnabled(s.id);
  for (const s of list) {
    if (!isCoSheet(s)) continue;
    const d = list.find((x) => !isCoSheet(x) && x.group === s.group);
    if (d) enabled[s.id] = enabled[d.id];
  }
}
// Axes available across every view: built generically from the active manifest's `groups` (one
// entry per pattern size — m=3's 3 free coordinates, m=4's 10 — each with its own `derived` named
// linear functionals, shipped as {label,short,coeffs,const} local to that group) into one flat
// catalog, rather than a separate catalog per dimension behind a mode toggle. `p` is a sheet's full
// row (the concatenation of every group's free coordinates, `null`-padded per group where a
// construction has no data — see `unified_row` on the producer side); each axis knows which slice
// of the row (`groupOffset`/`groupWidth`) it reads, so `axisVal` can tell "no data for this axis on
// this sheet" (null) apart from a genuine zero.
//
// Human text for every axis — raw m=3/m=4 coordinates, both implicit "dependent" coordinates, AND
// the derived (linear-combination) axes — is presentation-only (like TITLE/DESC below): the producer
// ships the DATA (coefficients, complement permutation), not display strings, except at m=4 where it
// also ships machine-derived `classNames`/`implicitLabel`, and for `derived` axes where it ships its
// own `label`/`short` — this table takes priority over all of those (see buildAxes). One string per
// key, "notation (name)" — the bracketed name is stripped back off (see axisShortOf) for the compact
// dropdown/restriction-row option text (kept narrow — several entries are long, e.g. phi's), shown
// instead on hover (native title=) and as the full plot axis title, where there's room for it.
//
// Every entry is "notation (name)". The notation is built from exactly two vocabularies, kept
// strictly apart so neither is ever ambiguous:
//   - GRAPH notation for every raw m=3/m=4 coordinate: each is one specific small graph on <=4
//     vertices, composed from Kₙ (complete), Iₙ (empty/independent, n isolated vertices), Pₙ (path),
//     Cₙ (cycle), Kₘ,ₙ (complete bipartite), "⊔" (disjoint union of graphs), "∨" (join), "⁻" (minus
//     one edge) — never English words (the old "co-triangle"/"cherry") or producer-internal keys
//     (the old m4 short text was the raw JSON key, e.g. "paw", "claw").
//   - ARITHMETIC "+"/"-" for every derived axis's actual linear combination of DENSITY VALUES — and
//     since a derived axis's formula is itself built from those same raw coordinates, every d0/d1/
//     d2/d3 (and the edge-density "d", which is exactly the 2-vertex K₂ density) appearing in one is
//     substituted with its own graph notation too, e.g. h1 = 1-2d becomes "1−2K₂" — so the same
//     quantity is never spelled two different ways depending on which entry you're looking at.
const AXIS_LABEL = {
  // m=3 (4 classes by edge count 0..3)
  d0: 'I₃ (empty)',                        // co-triangle: 3 isolated vertices
  d1: 'K₂⊔I₁ (one edge)',                  // co-cherry: an edge + an isolated vertex
  d2: 'P₃ (path)',                          // cherry: the 2-edge path on 3 vertices
  d3: 'K₃ (triangle)',                      // triangle: the complete graph on 3 vertices
  // m=4 (11 classes by edge count 0..6; keys match the producer's isoclass::key4)
  empty4: 'I₄ (empty)',
  edge: 'K₂⊔I₂ (single edge)',
  'cherry-isolated': 'P₃⊔I₁ (path + isolated)',
  matching: '2K₂ (matching)',
  'tri-isolated': 'K₃⊔I₁ (triangle + isolated)',
  claw: 'K₁,₃ (star / claw)',
  p4: 'P₄ (path)',
  paw: 'K₁∨(K₂⊔I₁) (paw)',
  c4: 'C₄ (cycle)',
  diamond: 'K₄⁻ (K4 minus an edge)',
  k4: 'K₄ (complete)',
  // m=3 derived (linear functionals of d1,d2,d3 — see artifact.rs::m3_derived_axes for the source
  // coefficients). d is exactly the K₂ (edge) density (the standard 2-vertex homomorphism-density
  // identity), so every other formula below that's naturally expressed via d substitutes K₂ for it
  // rather than re-expanding all the way to raw d1,d2,d3 terms.
  d: 'K₂ (edge density)',
  delta2: 'P₃/3+K₃ (hom-cherry δ₂)',
  m: '(K₂⊔I₁)+P₃ (cherry band)',
  e: '2K₂−1 (edge asymmetry)',
  phi: '(4(K₂⊔I₁)−2P₃+2K₃−1)/3 (clustering φ)',
  mono: 'I₃+K₃ (monochromatic)',
  h1: '1−2K₂ (harmonic h₁)',
  h2: '1−4K₂+4P₃/3+4K₃ (harmonic h₂)',
  h3: '1−6K₂+4P₃+4K₃ (harmonic h₃)',
};
// Preferred dropdown order (presentation-only, doesn't affect axisVal): historically the induced
// densities were listed cherry/triangle/co-cherry/co-triangle first, not raw coordinate order.
// Any manifest-provided axis not listed here is appended in the manifest's own (per-group) order.
const AXIS_ORDER = ['d2', 'd3', 'd1', 'd0', 'd', 'delta2', 'm', 'e', 'phi', 'mono', 'h1', 'h2', 'h3'];
const axisOrderIdx = (key) => { const i = AXIS_ORDER.indexOf(key); return i < 0 ? 1e9 : i; };
// The compact dropdown/restriction-row form: strip the trailing " (name)" back off a full
// AXIS_LABEL/manifest-derived entry — same source, so short is always exactly a prefix of label,
// the two can never drift apart the way two independently hand-written fields once did.
const axisShortOf = (text) => text.replace(/\s*\([^)]*\)\s*$/, '');
// Populated by load() from the active manifest; empty only before the first successful load.
let AXES = [];
function buildAxes(groups) {
  const axes = [];
  for (const grp of groups) {
    const implicitText = AXIS_LABEL[grp.implicitKey] || (grp.implicitLabel || {}).label || grp.implicitKey;
    axes.push({
      key: grp.implicitKey, label: implicitText, short: axisShortOf(implicitText), kind: 'implicit',
      groupOffset: grp.offset, groupWidth: grp.width,
    });
    grp.coords.forEach((key, i) => {
      const text = AXIS_LABEL[key] || (grp.classNames && grp.classNames[i]) || key;
      axes.push({
        key, label: text, short: axisShortOf(text), kind: 'raw', idx: grp.offset + i,
        groupOffset: grp.offset, groupWidth: grp.width,
      });
    });
    for (const key of Object.keys(grp.derived || {})) {
      const d = grp.derived[key];
      const text = AXIS_LABEL[key] || d.label;
      axes.push({
        key, label: text, short: axisShortOf(text), kind: 'derived', coeffs: d.coeffs, const_: d.const,
        groupOffset: grp.offset, groupWidth: grp.width,
      });
    }
  }
  axes.sort((a, b) => axisOrderIdx(a.key) - axisOrderIdx(b.key));
  return axes;
}
const dEdge = (p) => (p[0] + 2 * p[1] + 3 * p[2]) / 3; // edge density
// Generic evaluator over the active AXES catalog — replaces the old per-axis hardcoded switch.
// `raw` reads the free coordinate directly; `implicit` is the dependent coordinate (1 - sum of the
// axis's own group slice); `derived` evaluates the shipped linear functional (const + coeffs·slice)
// local to that group. Every axis the viz has ever offered is linear (see the "Non-linear basis
// embedding" CLAUDE.md note), so this is lossless. Returns `null` — never a fabricated 0 — when `p`
// has no data for this axis's group (a shorter-than-expected row, or `null`-padded slots): a sheet
// that hasn't been migrated to this pattern size has nothing to report on one of its axes, which is
// different from a genuine zero (see `sheetSupportsAxes`, which gates rendering on this).
function axisVal(p, key) {
  const a = AXES.find((x) => x.key === key);
  if (!a) return 0;
  const slice = p.slice(a.groupOffset, a.groupOffset + a.groupWidth);
  if (slice.length < a.groupWidth || slice.some((x) => x == null)) return null;
  if (a.kind === 'implicit') return 1 - slice.reduce((s, x) => s + x, 0);
  if (a.kind === 'raw') return p[a.idx];
  return a.const_ + a.coeffs.reduce((s, c, i) => s + c * slice[i], 0);
}
const axisLabel = (key) => (AXES.find((a) => a.key === key) || {}).label || key;
const axisShort = (key) => (AXES.find((a) => a.key === key) || {}).short || key;
// Whether `sheet` has real (non-null) data for every axis in `axKeys`, checked against its own
// first vertex/point — never per-point: a sheet's group data is uniform (either every point in it
// carries a pattern size's columns, or none do, since that reflects a whole-construction migration
// status, not a per-sample one). A sheet with no geometry points at all is unsupported.
function sheetSupportsAxes(sheet, axKeys) {
  const g = sheet.geometry || {};
  const pts = g.vertices || g.points || [];
  const p0 = pts.find((p) => p != null);
  if (!p0) return false;
  return axKeys.every((k) => axisVal(p0, k) != null);
}
// Whether the JS-synthesized probability-simplex frame has data for every axis in `axKeys` (it is
// inherently an m=3 object — a tetrahedron over the free coordinates d1,d2,d3, a bare 3-wide point
// — so it renders only when every currently active axis resolves within that group; `axisVal`
// already returns null for a group extending past a row's actual length, e.g. m=4 here).
const simplexAxesOk = (axKeys) => axKeys.every((k) => axisVal([0, 0, 0], k) != null);

// Per-axis view limits, keyed by axis KEY (not slot index or DOM id) — so a limit follows the axis
// regardless of which slot displays it, and naturally survives a slot's axis changing or `dims`
// toggling (no separate a3z/pjy-style namespaces to keep in sync). Empty input → null → the axis
// auto-ranges (or the [0,1] cube default in 3D).
const axisLimits = {};
const parseNum = (str) => {                          // "0.4", "1/3", or "" (→ null)
  str = (str || '').trim();
  if (!str) return null;
  const m = str.match(/^(-?\d*\.?\d+)\s*\/\s*(-?\d*\.?\d+)$/);
  const v = m ? parseFloat(m[1]) / parseFloat(m[2]) : parseFloat(str);
  return isNaN(v) ? null : v;
};
// Explicit [min,max] for an axis key when the user set either bound (missing bound → default); else null.
function axisRange(key, dlo, dhi) {
  const L = axisLimits[key] || {};
  if (L.min == null && L.max == null) return null;
  return [L.min == null ? dlo : L.min, L.max == null ? dhi : L.max];
}
// uirevision fragment: changes when a limit changes (so Plotly applies the new range), stable otherwise
// (so zoom/pan is preserved across legend toggles).
const limKey = (key) => { const L = axisLimits[key] || {}; return (L.min ?? '') + ':' + (L.max ?? ''); };
// A restriction's value: slider + number entry + ± buttons, all kept in sync. Shared by every
// restriction row (module-level, not per-row-closure state, since the value itself lives in
// `restrictions[i]`).
const SLICE_STEP = 0.005;
const fmtSlice = (v) => parseFloat(v.toFixed(4)).toString();
const parseSlice = (str) => {                       // accept "0.42" or a fraction "1/3"
  str = (str || '').trim();
  const m = str.match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/);
  return m ? parseFloat(m[1]) / parseFloat(m[2]) : parseFloat(str);
};

// Hover tooltips: each rendered point carries its four densities (always, regardless of the
// chosen display axes) plus the construction's parameter values θ as customdata. The
// densities are computable from the point p=[d1,d2,d3]; θ rides along from the sheet geometry
// (`params`, emitted per vertex/point by -data). Index layout: [d1,d2,d3,d0,d,δ₂, θ…].
function densCustom(v, prm) {
  const d0 = 1 - v[0] - v[1] - v[2];
  return [v[0], v[1], v[2], d0, dEdge(v), v[2] + v[1] / 3, ...(prm || [])];
}
// A co-density trace: an inline-reflected sheet (' (co)' suffix) or a data `co-…` sheet.
function isComplementSheet(sheet) {
  const id = sheet.id || '';
  return id.endsWith(' (co)') || id.startsWith('co-');
}
// Title of the underlying density construction, with the co-ness stripped off.
function baseTitle(sheet) {
  let id = sheet.id || '';
  if (id.endsWith(' (co)')) id = id.slice(0, -5);
  else if (id.startsWith('co-')) id = id.slice(3);
  return TITLE[id] || id;
}
// Hover header: complement traces read "Complement Densities of <base>".
function sheetDisplayName(sheet) {
  if (isComplementSheet(sheet)) return 'Complement Densities of ' + baseTitle(sheet);
  return TITLE[sheet.id] || sheet.id;
}
// The construction description, picking the complement variant for co-density sheets.
function sheetDesc(sheet) {
  const id = sheet.id || '';
  if (id.endsWith(' (co)')) {                       // inline-reflected: prefer the co- description
    const base = id.slice(0, -5);
    return DESC['co-' + base] || DESC[base] || sheet.description || '';
  }
  return DESC[id] || sheet.description || '';        // data co-… sheets carry their own DESC entry
}
// Everything the custom hover tooltip needs, stashed on each hoverable trace as `_tip`.
function tipMeta(sheet) {
  return { title: sheetDisplayName(sheet), desc: sheetDesc(sheet), color: sheet._color,
    params: (sheet.params || []).map((p) => p.name) };
}
// A dark tooltip background nudged a bit toward the hovered sheet's hue.
function tipBg(hex) {
  if (!hex || hex[0] !== '#') return 'rgba(24, 26, 32, 0.92)';
  const n = parseInt(hex.slice(1), 16), base = [24, 26, 32], t = 0.2;
  const m = (i, c) => Math.round(base[i] * (1 - t) + c * t);
  return `rgba(${m(0, (n >> 16) & 255)}, ${m(1, (n >> 8) & 255)}, ${m(2, n & 255)}, 0.92)`;
}

// ── Custom hover tooltip (rounded, padded, slightly transparent; MathJax in the description) ──
// Plotly's native hover label can't be styled this way, so we draw our own HTML element and
// drive it from plotly_hover/plotly_unhover. The description (LaTeX) is MathJax-typeset only when
// the hovered construction changes; the densities/parameters are plain unicode (cheap per-hover).
const tipEl = document.getElementById('tip');
const tipHead = document.getElementById('tip-head');
const tipBody = document.getElementById('tip-body');
let tipMouse = { x: 0, y: 0 }, tipKey = null;
// Touch handling: hover tooltips would otherwise pop up and stick on every tap (no unhover on
// touch). Instead, suppress them on touch and reveal on long-press; a plain tap dismisses.
let pendingTip = null, lastInputTouch = false, touchTipArmed = false, lpTimer = null, lpStart = null, lastTouchTime = 0;
const PARAM_UNI = { sigma: 'σ', delta: 'δ', alpha: 'α', beta: 'β', theta: 'θ' };
const DENS_SKIP = new Set(['d', 'd0', 'd1', 'd2', 'd3', 'delta2', 'δ₂']);
const fmt3 = (x) => (x == null || isNaN(x) ? '–' : (+x).toFixed(3));
function tipBodyHTML(cd, params) {
  const ps = (params || []).map((name, i) => ({ name, i })).filter((o) => !DENS_SKIP.has(o.name));
  let html = '';
  if (ps.length) {                                  // parameters first
    const body = ps.map((o) => `${PARAM_UNI[o.name] || o.name} = ${fmt3(cd[6 + o.i])}`).join(' · ');
    html += `<div class="tip-sec"><span class="tip-label">Parameters</span>${body}</div>`;
  }
  html += `<div class="tip-sec${ps.length ? ' tip-div' : ''}"><span class="tip-label">Densities</span>`
    + `d₀ = ${fmt3(cd[3])} · d₁ = ${fmt3(cd[0])} · d₂ = ${fmt3(cd[1])} · d₃ = ${fmt3(cd[2])}`
    + `<br>edge d = ${fmt3(cd[4])} · δ₂ = ${fmt3(cd[5])}</div>`;
  return html;
}
function positionTip() {
  const pad = 16, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = tipMouse.x + pad, y = tipMouse.y + pad;
  if (x + w > window.innerWidth - 8) x = tipMouse.x - w - pad;
  if (y + h > window.innerHeight - 8) y = tipMouse.y - h - pad;
  tipEl.style.left = Math.max(8, x) + 'px';
  tipEl.style.top = Math.max(8, y) + 'px';
}
function showPlotTip(meta, cd) {
  const key = meta.title + ' ' + meta.desc;
  if (key !== tipKey) {                       // re-typeset the description only on construction change
    tipHead.innerHTML = `<div class="tip-title">${meta.title}</div>`
      + (meta.desc ? `<div class="tip-desc">${meta.desc}</div>` : '');
    if (window.MathJax && MathJax.typesetPromise) {   // advance the cache only once MathJax can typeset
      tipKey = key;
      MathJax.typesetPromise([tipHead]).catch(() => {});
    }
  }
  tipBody.innerHTML = tipBodyHTML(cd, meta.params);
  tipEl.style.background = tipBg(meta.color);
  tipEl.classList.add('show');
  positionTip();
}
function onTipHover(ev) {
  const pt = ev.points && ev.points[0];
  const meta = pt && pt.data && pt.data._tip, cd = pt && pt.customdata;
  if (!meta || !cd) return;
  if (lastInputTouch && !touchTipArmed) { pendingTip = { meta, cd }; return; }  // touch: hold for long-press
  showPlotTip(meta, cd);
}
function onTipUnhover() { tipEl.classList.remove('show'); tipKey = null; pendingTip = null; }
// Show the same styled tooltip (name + MathJax description, no densities) when hovering a legend row.
function showLegendTip(sheet, e) {
  if (lastInputTouch && !touchTipArmed) return;   // touch: a tap toggles the row, no sticky hover tip
  const meta = tipMeta(sheet);
  tipHead.innerHTML = `<div class="tip-title">${meta.title}</div>`
    + (meta.desc ? `<div class="tip-desc">${meta.desc}</div>` : '');
  tipBody.innerHTML = '';
  tipKey = null;   // legend tips share #tip with plot hovers; force a re-typeset on next plot hover
  if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([tipHead]).catch(() => {});
  tipEl.style.background = tipBg(meta.color);
  tipMouse = { x: e.clientX, y: e.clientY };
  tipEl.classList.add('show');
  positionTip();
}
// Open / unproven parts of the structure, flagged with a "!" on their legend row. Currently only the
// generalized-Razborov band (rise) is open (frontier i); extend this map as proofs land.
const OPEN_NOTE = {
  rise: { symbol: '!', title: 'Boundary not yet proven',
    desc: 'Matching bounds have not been established here, but flag-algebra probing supports it.' },
  'clique-independent': { symbol: '?', title: 'Proof not yet verified',
    desc: 'The extremal threshold-graph argument (a shifting proof) is drafted but has not yet been checked.' },
};
// The styled tooltip with a free-form note (no sheet, no densities) — for the legend "!" flags.
function showNoteTip(note, e) {
  if (lastInputTouch && !touchTipArmed) return;
  tipHead.innerHTML = `<div class="tip-title">${note.title}</div><div class="tip-desc">${note.desc}</div>`;
  tipBody.innerHTML = '';
  tipKey = null;
  if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([tipHead]).catch(() => {});
  tipEl.style.background = tipBg('#e8000d');
  tipMouse = { x: e.clientX, y: e.clientY };
  tipEl.classList.add('show');
  positionTip();
}

// Hover-highlight: dim every plot trace except the hovered legend entry's (matched by trace name, so
// it covers the surface, its rim, the σ-mirror and any points). One restyle in, one debounced restyle
// out so sliding between rows doesn't flash. Trace-level opacity → works in 3D, projection and slice.
let _hiActive = false, _hiOrig = null, _hiTimer = null, _previewId = null;
const baseSheetId = (x) => (x || '').replace(/ \(co\)$/, '').replace(/^co-/, '');
// renderSidebar() rebuilds every `.sheet` row's DOM node from scratch; if the mouse is resting on a
// row when that happens (e.g. right after clicking it to toggle), the browser fires a fresh
// mouseenter on the replacement node even though the pointer never moved — which would otherwise
// re-run highlightSheet's preview logic and spuriously flip the just-toggled sheet back into view
// (and, in a gl3d scene, force an extra unwanted redraw/rescale). renderSidebar() sets this flag so
// exactly that one synthetic re-hover is swallowed; any real subsequent hover clears it normally.
let _suppressNextHighlight = false;
function highlightSheet(s) {
  if (lastInputTouch && !touchTipArmed) return;
  if (_suppressNextHighlight) { _suppressNextHighlight = false; return; }
  clearTimeout(_hiTimer);                                   // moving between rows: cancel any pending clear
  const want = baseSheetId(s.id);
  const newPreview = enabled[s.id] ? null : want;           // a disabled row is rendered transiently to preview it
  if (newPreview !== _previewId) { _previewId = newPreview; draw(); }
  const gd = document.getElementById('plot');
  if (!gd || !gd.data || !gd.data.length) return;
  if (!gd.data.some((t) => baseSheetId(t.name) === want)) return;   // sheet has nothing to draw here
  if (!_hiActive || !_hiOrig || _hiOrig.length !== gd.data.length)
    _hiOrig = gd.data.map((t) => (t.opacity == null ? 1 : t.opacity));
  const op = gd.data.map((t, i) => (baseSheetId(t.name) === want ? _hiOrig[i] : _hiOrig[i] * 0.12));
  Plotly.restyle('plot', { opacity: op }, op.map((_, i) => i));
  _hiActive = true;
}
function clearHighlight() {
  clearTimeout(_hiTimer);
  _hiTimer = setTimeout(() => {
    if (_previewId != null) { _previewId = null; _hiActive = false; _hiOrig = null; draw(); return; }  // drop the preview
    if (!_hiActive) return;
    const gd = document.getElementById('plot');
    if (gd && gd.data && _hiOrig && _hiOrig.length === gd.data.length)
      Plotly.restyle('plot', { opacity: _hiOrig }, _hiOrig.map((_, i) => i));
    _hiActive = false; _hiOrig = null;
  }, 60);
}

// Double-click a legend row to isolate it (show only that entry + its co, hide every other sheet);
// double-click the isolated row again to restore the previous visibility. The simplex frame is left
// as-is for spatial context. A single-click delay (in the row handler) distinguishes toggle from this.
let _clickT = null, _preIsolate = null;
function isolateSheet(ids) {
  const idset = new Set(ids);
  const rows = sheets.filter((x) => x.kind !== 'frame');
  const isolated = ids.some((id) => enabled[id]) && rows.every((x) => !!enabled[x.id] === idset.has(x.id));
  if (isolated && _preIsolate) {                          // already isolated to this → restore prior view
    for (const x of sheets) if (x.id in _preIsolate) enabled[x.id] = _preIsolate[x.id];
    _preIsolate = null;
  } else {
    _preIsolate = {};
    for (const x of sheets) _preIsolate[x.id] = enabled[x.id];   // snapshot, then keep only this row's ids
    for (const x of rows) enabled[x.id] = idset.has(x.id);
  }
  clearTimeout(_hiTimer); _hiActive = false; _hiOrig = null;   // drop any hover dimming bookkeeping
  renderSidebar();
  draw();
}
// Plotly.purge (render-strategy switch, see draw()) drops listeners, so re-attach after every draw.
function bindTip() {
  const gd = document.getElementById('plot');
  if (!gd || !gd.on) return;
  if (gd.removeAllListeners) {
    gd.removeAllListeners('plotly_hover'); gd.removeAllListeners('plotly_unhover');
    gd.removeAllListeners('plotly_relayout');
  }
  gd.on('plotly_hover', onTipHover);
  gd.on('plotly_unhover', onTipUnhover);
  gd.on('plotly_relayout', () => {            // persist the live camera (3D-strategy scenes) / pan-zoom (flat 2D)
    const fl = gd._fullLayout;
    if (is3D()) {                              // read the *current* camera straight from the layout —
      const cam = fl && fl.scene && fl.scene.camera;   // robust to relayout events that omit the camera key
      if (cam) lastCam = { ...cam, up: { ...cam.up }, center: { ...cam.center }, eye: { ...cam.eye } };
    } else if (isLockedProj2D()) {             // locked orthographic scene: keep pan/zoom (no rotation)
      const cam = fl && fl.scene && fl.scene.camera;
      if (cam) lastCam2D0 = { ...cam, up: { ...cam.up }, center: { ...cam.center }, eye: { ...cam.eye } };
    } else {                                   // flat 2D pan/zoom (restrictions >= 1; keyed by the current axes)
      if (fl && fl.xaxis && fl.xaxis.autorange && fl.yaxis && fl.yaxis.autorange) delete view2d[flatKey()];
      else if (fl && fl.xaxis && fl.xaxis.range && fl.yaxis && fl.yaxis.range)
        view2d[flatKey()] = { x: fl.xaxis.range.slice(), y: fl.yaxis.range.slice() };
    }
    saveView();
  });
}
const plotWrap = document.getElementById('plot-wrap');
const ghost = () => Date.now() - lastTouchTime < 700;   // mouse events synthesized right after a touch
plotWrap.addEventListener('mousemove', (e) => {
  if (ghost()) return;
  lastInputTouch = false;
  tipMouse = { x: e.clientX, y: e.clientY };
  if (tipEl.classList.contains('show')) positionTip();
});
plotWrap.addEventListener('mouseleave', () => { if (!ghost()) onTipUnhover(); });
// Touch: reveal the hovered point's tooltip only after a stationary long-press; a plain tap (used to
// pan/zoom the plot) dismisses any open tip. Plotly fires plotly_hover on touch-down — onTipHover
// stashes it as pendingTip, and the long-press timer below promotes it to a visible tooltip.
plotWrap.addEventListener('touchstart', (e) => {
  lastInputTouch = true; lastTouchTime = Date.now();
  clearTimeout(lpTimer); touchTipArmed = false; pendingTip = null;
  if (e.touches.length !== 1) return;                // pinch: never a long-press
  const t = e.touches[0];
  lpStart = { x: t.clientX, y: t.clientY };
  tipMouse = { x: t.clientX, y: t.clientY };
  lpTimer = setTimeout(() => {
    touchTipArmed = true;
    if (pendingTip) showPlotTip(pendingTip.meta, pendingTip.cd);
  }, 450);
}, { passive: true });
plotWrap.addEventListener('touchmove', (e) => {
  lastTouchTime = Date.now();
  if (!lpStart || !e.touches.length) return;
  const t = e.touches[0];
  tipMouse = { x: t.clientX, y: t.clientY };
  if (Math.hypot(t.clientX - lpStart.x, t.clientY - lpStart.y) > 12) clearTimeout(lpTimer);  // panning, not a press
}, { passive: true });
plotWrap.addEventListener('touchend', () => {
  lastTouchTime = Date.now();
  clearTimeout(lpTimer);
  if (!touchTipArmed) onTipUnhover();                // plain tap: clear any lingering tip
  pendingTip = null;
  setTimeout(() => { touchTipArmed = false; }, 350); // keep armed briefly past release, then re-gate
}, { passive: true });

function meshTrace(verts, faces, color, name, hover) {
  const P = verts.map(proj3);
  const t = {
    type: 'mesh3d', name,
    x: P.map((q) => q[0]), y: P.map((q) => q[1]), z: P.map((q) => q[2]),
    i: faces.map((f) => f[0]), j: faces.map((f) => f[1]), k: faces.map((f) => f[2]),
    color, opacity: 0.4, flatshading: false, lighting: { ambient: 0.65, diffuse: 0.75 },
    showlegend: false,
  };
  if (hover) { t.customdata = hover.customdata; t.hoverinfo = 'none'; t._tip = hover.tip; }
  else { t.hoverinfo = 'name'; }
  return t;
}
function polylineTrace(polylines, color, width, lmode) {
  const X = [], Y = [], Z = [];
  for (const pl of polylines) {
    for (const p of pl) { const q = proj3(p); X.push(q[0]); Y.push(q[1]); Z.push(q[2]); }
    X.push(null); Y.push(null); Z.push(null);
  }
  return { type: 'scatter3d', mode: lmode || 'lines', x: X, y: Y, z: Z,
    line: { color, width: width || 3 }, opacity: 0.9, hoverinfo: 'skip', showlegend: false };
}

function cornerTrace(corners, color) {
  const P = corners.map((c) => proj3(c.point));
  return { type: 'scatter3d', mode: 'markers', name: 'vertices',
    x: P.map((q) => q[0]), y: P.map((q) => q[1]), z: P.map((q) => q[2]),
    marker: { size: 2.5, color }, hoverinfo: 'name', showlegend: false };
}
function surfaceTraces(sheet, color) {
  const g = sheet.geometry; // {vertices, faces, facesSelf, params, boundary: [{constraint, points}], corners}
  let edges = g.boundary.map((e) => e.points);
  const cdata = g.vertices.map((v, i) => densCustom(v, g.params ? g.params[i] : null));
  // Self-complementary facets are drawn here (with the density facets) but dropped from the co-mirror
  // (reflectSheet zeroes facesSelf), so a self-complementary facet renders exactly once.
  const allFaces = g.facesSelf && g.facesSelf.length ? g.faces.concat(g.facesSelf) : g.faces;
  // Surface render mode: 'wireframe' drops the fill entirely (outlines only); 'solid' forces opaque;
  // 'transparent' keeps the sheet's own translucency.
  const m = surfaceMode === 'wireframe' ? null
    : meshTrace(g.vertices, allFaces, color, sheet.id, { customdata: cdata, tip: tipMeta(sheet) });
  if (m) {
    if (sheet._opacity != null) m.opacity = sheet._opacity;  // complement → more transparent; reference faint
    if (surfaceMode === 'solid') m.opacity = 1;              // opaque fills
  }
  // Boundary outline: a darker shade of the fill hue, crisp (full opacity) so the rim reads over
  // the translucent surface; complement rims are drawn fainter to stay subordinate.
  // LP-relaxation polytopes get a light, thin facet wireframe (in their own hue) rather than the
  // default darkened rim, so the flat-facet structure of the nested outer bounds reads clearly.
  const isLP = baseGroup(sheet) === 'lp-relaxation';
  if (isLP) {
    // Lift the wireframe a hair radially off the facets (from the σ-symmetric polytope centre) so the
    // outlines read even when the fills are opaque (Solid mode) — otherwise coplanar lines z-fight.
    const vs = g.vertices; let cx = 0, cy = 0, cz = 0;
    for (const v of vs) { const r = reflect(v); cx += v[0] + r[0]; cy += v[1] + r[1]; cz += v[2] + r[2]; }
    const k = 2 * (vs.length || 1), C = [cx / k, cy / k, cz / k], F = 1.006;
    const lift = (p) => [C[0] + (p[0] - C[0]) * F, C[1] + (p[1] - C[1]) * F, C[2] + (p[2] - C[2]) * F];
    edges = edges.map((pl) => pl.map(lift));
  }
  const rim = polylineTrace(edges, isLP ? color : shade(color, 0.6), isLP ? 1.3 : RIM_WIDTH);
  rim.name = sheet.id;   // so hover-highlight keeps the rim too (it's the whole trace in Wireframe mode)
  const fullRimOp = isLP ? 0.9 : 1;
  // A co-density rim is faded in Light mode but renders at full strength in Show (like the density rim).
  rim.opacity = (sheet._isCo && complementMode !== 'show') ? 0.5 : fullRimOp;
  const out = m ? [m, rim] : [rim];   // wireframe mode → rim only
  if (g.corners && g.corners.length && surfaceMode !== 'wireframe') out.push(cornerTrace(g.corners, color));
  return out;
}
function curveTrace(sheet, color) {
  const g = sheet.geometry;
  // points may contain null separators (a multi-segment polyline) → pass them through to break the line
  const P = g.points.map((p) => (p ? proj3(p) : null));
  const cdata = g.points.map((v, i) => (v ? densCustom(v, g.params ? [g.params[i]] : null) : null));
  return { type: 'scatter3d', mode: 'lines', name: sheet.id,
    x: P.map((q) => (q ? q[0] : null)), y: P.map((q) => (q ? q[1] : null)), z: P.map((q) => (q ? q[2] : null)),
    line: { color, width: 6 }, opacity: sheet._opacity ?? 0.95,
    customdata: cdata, hoverinfo: 'none', _tip: tipMeta(sheet), showlegend: false };
}
// External sample points (kind: "points") — discrete data, rendered as markers, not a curve.
function pointsTrace3D(sheet, color) {
  const g = sheet.geometry;
  const P = g.points.map(proj3);
  const cdata = g.points.map((v) => densCustom(v, null));
  return { type: 'scatter3d', mode: 'markers', name: sheet.id,
    x: P.map((q) => q[0]), y: P.map((q) => q[1]), z: P.map((q) => q[2]),
    marker: { size: sheet.markerSize || 2.5, color, symbol: sheet.markerSymbol || 'x', opacity: sheet._isCo ? 0.4 : 1 },
    customdata: cdata, hoverinfo: 'none', _tip: tipMeta(sheet), showlegend: false };
}
const SIMPLEX_COLOR = COLOR_REF;  // the probability-simplex frame is a grey reference
// Renders only when the caller has confirmed the active axes are all within the m=3 group (see
// `simplexAxesOk`) — bare 3-wide corners are then sufficient (`axisVal` never reads past index 2).
function simplexWire() {
  const v = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]].map(proj3);
  const E = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  const X = [], Y = [], Z = [];
  for (const [a, b] of E) { X.push(v[a][0], v[b][0], null); Y.push(v[a][1], v[b][1], null); Z.push(v[a][2], v[b][2], null); }
  return { type: 'scatter3d', mode: 'lines', hoverinfo: 'skip', x: X, y: Y, z: Z, line: { color: SIMPLEX_COLOR, width: 2 }, showlegend: false };
}

// ---- app ----
let sheets = [], enabled = {}, hasCoSheet = new Set();
let collapsedGroups = new Set();   // legend sections folded shut (display only — does not change visibility)
let complementMode = 'light'; // global complement (co-density) render: 'hide' | 'light' (faded tint) | 'show' (full)
let surfaceMode = 'solid';    // global surface render: 'solid' (opaque) | 'transparent' | 'wireframe' (outlines only)
// ── View model ───────────────────────────────────────────────────────────
// Everything is inherently a projection: `dims` (2 or 3) is the only mode-like toggle, `axes` is a
// dims-long array of freely-chosen axis keys (any slot, any key — no per-slot presets tied to a
// specific mode), and `restrictions` is a list of {axis, value} hyperplane cuts a user can add/
// remove freely (0 = plain projection, 1 = a classic single-axis slice, 2+ = a further reduction —
// see reduceCell/applyRestrictions above). Three render *strategies* fall out of this with no
// user-facing toggle of their own:
//   - dims===3                       → a rotatable 3D scene (is3D()).
//   - dims===2, restrictions.length===0 → a locked-orthographic 3D scene (isLockedProj2D()): a true
//     flat 2D shadow renderer was tried and reverted (see git history around 2026-06-04/05) because
//     a mesh's projected boundary curve isn't its 2D silhouette once the projection folds (e.g. the
//     regular surface onto d1-d3) — even-odd fill rules produce holes/noise with no cheap general
//     fix. The GPU's own depth/alpha compositing handles this correctly, so this strategy is kept
//     for the unrestricted case; it is an internal rendering choice, not a mode the user picks.
//   - dims===2, restrictions.length>=1 → a real flat 2D plot: a restriction always cuts geometry to
//     arity <= 2 (mesh triangle -> line segment at worst), so there is no fill/occlusion problem left.
let dims = 3;
let axes = ['d1', 'd2', 'd3'];   // length always === dims
let restrictions = [];           // [{axis, value}, ...]
const is3D = () => dims === 3;
const isLockedProj2D = () => dims === 2 && restrictions.length === 0;
const complementsVisible = () => complementMode !== 'hide';
let needCenter = true;      // (re)centre the 3D (dims=3) camera on next draw
let lastCam = null;         // latest 3D camera, captured from plotly_relayout (the reliable source)
let needCenter2D0 = true;   // re-lock the locked-projection (dims=2, 0 restrictions) camera on next draw
let lastCam2D0 = null;      // latest locked-projection camera (pan/zoom preserved across legend toggles)
let view2d = {};            // persisted 2D pan/zoom (flat 2D, restrictions>=1), keyed by dims+axes
// The three axes currently driving a 3D-strategy scene: `axes` itself when dims===3, or
// [axes[0], axes[1], depth] when isLockedProj2D() (so the same surface/curve/point builders render
// both). Set at the top of each draw. Not used by the flat-2D strategy (axisVal(p, axes[i]) directly).
let viewAxes = axes;
const proj3 = (p) => [axisVal(p, viewAxes[0]), axisVal(p, viewAxes[1]), axisVal(p, viewAxes[2])];
// Projection depth: the scene's collapsed (look-down) axis for isLockedProj2D() — any coordinate not
// in the plane. The fold that broke the flat 2D shadow resolves here, because its two sheets differ
// in this coordinate. Built from the active AXES catalog (not a hardcoded m3 key list) so it stays
// meaningful whichever axes/pattern sizes are in play; prefers raw coordinates, then the implicit
// one, then derived axes (the same rough preference the old hardcoded list encoded: real
// coordinates over more exotic combinations).
function projDepth(ax0, ax1) {
  const byPref = [...AXES.filter((a) => a.kind === 'raw'), ...AXES.filter((a) => a.kind === 'implicit'), ...AXES.filter((a) => a.kind === 'derived')];
  const found = byPref.find((a) => a.key !== ax0 && a.key !== ax1);
  return (found && found.key) || (AXES[0] && AXES[0].key) || 'd2';
}
// Pick an axis not already in `axes` — used to extend `axes` by one slot when dims goes 2 -> 3.
function pickUnusedAxis() {
  const used = new Set(axes);
  const byPref = [...AXES.filter((a) => a.kind === 'raw'), ...AXES.filter((a) => a.kind === 'implicit'), ...AXES.filter((a) => a.kind === 'derived')];
  const found = byPref.find((a) => !used.has(a.key));
  return (found && found.key) || (AXES[0] && AXES[0].key) || 'd3';
}
// key for the current flat-2D view (the two plotted axes) — a different axis pair ⇒ a different slot
const flatKey = () => `2:${axes[0]},${axes[1]}`;

// ── Persisted view configuration (localStorage) ─────────────────────────────
// Stores the whole view (dims, axes, restrictions, per-axis limits, complement toggle, legend
// visibility) so a reload restores it. Chrome settings (theme, sidebar width/collapse) persist
// separately in index.html under their own gpv-* keys; the Reset button clears every gpv-* key.
const VKEY = 'gpv-view';
const loadView = () => { try { return JSON.parse(localStorage.getItem(VKEY) || 'null'); } catch { return null; } };
// A returning user's blob may predate this view model — two prior generations existed: a flat
// `mode`/`ax3`/`axx`/`axy`/`pjx`/`pjy`/`sliceAxis`/`sliceC` shape (three parallel modes), and before
// that an `enabledByProfile` shape (two profiles sharing sheet ids, from the since-removed m3/m4
// toggle). Migrate the first into the new shape rather than silently discard it; the second is
// already handled downstream by `load()`'s own `enabledByProfile.m3` fallback (carried through here
// unchanged) so a three-generations-old blob still degrades gracefully rather than resetting.
function migrateLegacyView(v) {
  if (!v || v.dims) return v;                     // already new shape, or nothing saved
  if (!['3d', 'slice', 'proj'].includes(v.mode)) return null;   // unrecognized shape — fall through to defaults
  const carry = {
    complementMode: v.complementMode, showComplements: v.showComplements,
    surfaceMode: v.surfaceMode, surfaceTransparency: v.surfaceTransparency,
    enabled: v.enabled, enabledByProfile: v.enabledByProfile, collapsed: v.collapsed,
  };
  const limAt = (slotId, key) => (key && v.axisLimits && v.axisLimits[slotId]) ? { [key]: v.axisLimits[slotId] } : {};
  if (v.mode === '3d' && Array.isArray(v.ax3) && v.ax3.length === 3) {
    const axisLimits = Object.assign({}, limAt('a3x', v.ax3[0]), limAt('a3y', v.ax3[1]), limAt('a3z', v.ax3[2]));
    return { dims: 3, axes: v.ax3.slice(), restrictions: [], axisLimits, cam3d: v.cam3d, ...carry };
  }
  if (v.mode === 'slice') {
    const axisLimits = Object.assign({}, limAt('axx', v.axx), limAt('axy', v.axy));
    const view2d = {};
    const legacy = v.view2d && v.view2d[`slice:${v.axx},${v.axy}`];
    if (legacy) view2d[`2:${v.axx},${v.axy}`] = legacy;
    return { dims: 2, axes: [v.axx, v.axy], restrictions: [{ axis: v.sliceAxis, value: v.sliceC }], axisLimits, view2d, ...carry };
  }
  if (v.mode === 'proj') {
    const axisLimits = Object.assign({}, limAt('pjx', v.pjx), limAt('pjy', v.pjy));
    return { dims: 2, axes: [v.pjx, v.pjy], restrictions: [], axisLimits, cam2d0: v.projCam, ...carry };
  }
  return null;
}
let _saveT = null;
function saveView() {                       // debounced: coalesce rapid slider/limit edits into one write
  if (_saveT) return;
  _saveT = setTimeout(() => {
    _saveT = null;
    try {
      localStorage.setItem(VKEY, JSON.stringify(
        { dims, axes, restrictions, axisLimits, complementMode, surfaceMode, enabled,
          collapsed: [...collapsedGroups], cam3d: lastCam, cam2d0: lastCam2D0, view2d }));
    } catch { /* storage full or blocked — ignore */ }
  }, 200);
}
const validAxis = (k) => AXES.some((a) => a.key === k);
function applySavedView(v) {                 // overlay a saved view onto the defaults (validating each field)
  if (!v) return;
  if (v.dims === 2 || v.dims === 3) dims = v.dims;
  if (Array.isArray(v.axes) && v.axes.length === dims && v.axes.every(validAxis)) axes = v.axes.slice();
  // `axes.length === dims` is a declared invariant (see the `dims` state-model comment) — a
  // corrupted/hand-edited blob could set `dims` above without a matching-length `axes` (the
  // `if` above only overwrites `axes` when the lengths already agree), so restore it here rather
  // than leave a stale wrong-length default silently in place.
  if (axes.length > dims) axes = axes.slice(0, dims);
  else while (axes.length < dims) axes.push(pickUnusedAxis());
  if (Array.isArray(v.restrictions)) {
    // [-1,1], not [0,1]: matches setVal's clamp — every AXES entry is bounded within [-1,1] (the
    // harmonic h1/h2/h3 basis genuinely ranges over [-1,1], not just the [0,1] densities).
    restrictions = v.restrictions.filter((r) => r && validAxis(r.axis) && typeof r.value === 'number' && r.value >= -1 && r.value <= 1)
      .map((r) => ({ axis: r.axis, value: r.value }));
  }
  if (['hide', 'light', 'show'].includes(v.complementMode)) complementMode = v.complementMode;
  else if (typeof v.showComplements === 'boolean') complementMode = v.showComplements ? 'light' : 'hide'; // migrate old views
  if (['solid', 'transparent', 'wireframe'].includes(v.surfaceMode)) surfaceMode = v.surfaceMode;
  else if (typeof v.surfaceTransparency === 'boolean') surfaceMode = v.surfaceTransparency ? 'transparent' : 'solid';
  if (Array.isArray(v.collapsed)) collapsedGroups = new Set(v.collapsed);
  if (v.axisLimits) for (const k in v.axisLimits) if (validAxis(k)) axisLimits[k] = v.axisLimits[k];
  if (v.view2d && typeof v.view2d === 'object') view2d = v.view2d;
  if (v.cam3d && v.cam3d.eye) {           // restore the 3D camera (only honoured if we open in dims=3)
    lastCam = v.cam3d;
    if (dims === 3) needCenter = false;
  }
  if (v.cam2d0 && v.cam2d0.eye) {         // restore the locked-projection camera (pan/zoom of the locked view)
    lastCam2D0 = v.cam2d0;
    if (dims === 2 && restrictions.length === 0) needCenter2D0 = false;
  }
}

// ── 3D camera navigation: centered pivot, keyboard, reset ───────────────────
const v3 = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  norm(a) { const l = this.len(a) || 1; return this.scale(a, 1 / l); },
  rot(v, k, th) {                       // Rodrigues rotation of v about unit axis k by angle th
    const c = Math.cos(th), s = Math.sin(th), kxv = this.cross(k, v), kd = this.dot(k, v);
    return { x: v.x * c + kxv.x * s + k.x * kd * (1 - c),
      y: v.y * c + kxv.y * s + k.y * kd * (1 - c),
      z: v.z * c + kxv.z * s + k.z * kd * (1 - c) };
  },
};
// Rotation pivots on the scene origin. Default axis ranges hug the displayed data (dataBounds3D), so
// under aspectmode:'cube' the data's bounding-box centre sits at (0,0,0) — i.e. rotation orbits the
// middle of whatever is shown, not the fixed (¼,¼,¼) simplex centroid.
function defaultCamera() {
  return { center: { x: 0, y: 0, z: 0 }, eye: { x: 1.25, y: 1.25, z: 1.25 }, up: { x: 0, y: 0, z: 1 },
    projection: { type: 'orthographic' } };
}
// Locked orthographic camera looking straight down the depth axis: a true parallel projection of
// the 3D geometry onto the axes[0]-axes[1] plane. The GPU does the projection, so folds/occlusion
// are handled natively. Requires viewAxes = [axes[0], axes[1], depth] (proj3 reads it). Rotation is
// disabled in the scene (isLockedProj2D() only).
function projCamera() {
  return { center: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 0, z: 2.2 }, up: { x: 0, y: 1, z: 0 },
    projection: { type: 'orthographic' } };
}
function camNow() {
  const stored = isLockedProj2D() ? lastCam2D0 : lastCam;   // each scene keeps its own camera
  if (stored) return stored;
  const gd = document.getElementById('plot');
  const live = gd && gd._fullLayout && gd._fullLayout.scene && gd._fullLayout.scene.camera;
  return live || (isLockedProj2D() ? projCamera() : defaultCamera());
}
const resetProj = () => { lastCam2D0 = null; needCenter2D0 = true; draw(); };   // re-lock the projection
const setCam = (cam) => Plotly.relayout('plot', { 'scene.camera': cam });
function orbitCam(dAz, dEl) {
  const cam = camNow(), up = cam.up || { x: 0, y: 0, z: 1 };
  let e = v3.sub(cam.eye, cam.center);
  if (dAz) e = v3.rot(e, v3.norm(up), dAz);
  if (dEl) e = v3.rot(e, v3.norm(v3.cross(e, up)), dEl);
  setCam({ ...cam, eye: v3.add(cam.center, e) });
}
function panCam(dx, dy) {
  const cam = camNow(), up = cam.up || { x: 0, y: 0, z: 1 };
  const e = v3.sub(cam.eye, cam.center), right = v3.norm(v3.cross(e, up)), sUp = v3.norm(v3.cross(right, e));
  const k = v3.len(e) * 0.06;
  const off = v3.add(v3.scale(right, dx * k), v3.scale(sUp, dy * k));
  setCam({ ...cam, eye: v3.add(cam.eye, off), center: v3.add(cam.center, off) });
}
const zoomCam = (f) => { const cam = camNow(); setCam({ ...cam, eye: v3.add(cam.center, v3.scale(v3.sub(cam.eye, cam.center), f)) }); };
const resetCam = () => setCam(defaultCamera());
function presetCam(i) {
  const cam = camNow(), ctr = cam.center, dist = v3.len(v3.sub(cam.eye, ctr)) || 2.16;
  const dir = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }][i];
  setCam({ ...cam, eye: v3.add(ctr, v3.scale(dir, dist)), up: i === 2 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 } });
}
// ── 2D (slice / projection) pan · zoom · reset via axis ranges (yaxis is scaleanchored to x, so
// scaling both axes by the same factor keeps the aspect locked) ─────────────────────────────────
function axRange(ax) {
  const gd = document.getElementById('plot');
  const a = gd && gd._fullLayout && gd._fullLayout[ax];
  return a && a.range ? a.range.slice() : null;
}
function pan2d(fx, fy) {
  const xr = axRange('xaxis'), yr = axRange('yaxis'); if (!xr || !yr) return;
  const dx = (xr[1] - xr[0]) * fx, dy = (yr[1] - yr[0]) * fy;
  Plotly.relayout('plot', { 'xaxis.range': [xr[0] + dx, xr[1] + dx], 'yaxis.range': [yr[0] + dy, yr[1] + dy] });
}
function zoom2d(f) {
  const xr = axRange('xaxis'), yr = axRange('yaxis'); if (!xr || !yr) return;
  const cx = (xr[0] + xr[1]) / 2, hx = (xr[1] - xr[0]) / 2 * f, cy = (yr[0] + yr[1]) / 2, hy = (yr[1] - yr[0]) / 2 * f;
  Plotly.relayout('plot', { 'xaxis.range': [cx - hx, cx + hx], 'yaxis.range': [cy - hy, cy + hy] });
}
const reset2d = () => Plotly.relayout('plot', { 'xaxis.autorange': true, 'yaxis.autorange': true });
// Zoom about a screen point (px, py) — used for pinch so it zooms toward the fingers' midpoint.
function zoom2dAbout(f, px, py) {
  const gd = document.getElementById('plot');
  const xr = axRange('xaxis'), yr = axRange('yaxis'); if (!xr || !yr) return;
  const sz = gd._fullLayout && gd._fullLayout._size, r = gd.getBoundingClientRect();
  let ax = (xr[0] + xr[1]) / 2, ay = (yr[0] + yr[1]) / 2;
  if (sz) {
    ax = xr[0] + ((px - r.left - sz.l) / sz.w) * (xr[1] - xr[0]);
    ay = yr[1] - ((py - r.top - sz.t) / sz.h) * (yr[1] - yr[0]);   // screen y down → data y up
  }
  Plotly.relayout('plot', {
    'xaxis.range': [ax - (ax - xr[0]) * f, ax + (xr[1] - ax) * f],
    'yaxis.range': [ay - (ay - yr[0]) * f, ay + (yr[1] - ay) * f],
  });
}
// Mobile touch for the 2D plots: one finger pans, two fingers pinch-zoom. gl3d handles its own
// touch in 3D, so we no-op there. Capture phase + stopPropagation keeps Plotly's drag layer from
// also handling the gesture (which would double-pan).
(function () {
  const gd = document.getElementById('plot');
  let kind = null, lx = 0, ly = 0, ld = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  gd.addEventListener('touchstart', (e) => {
    if (is3D() || isLockedProj2D()) return;   // gl3d handles its own touch; locked-proj has no top-level xaxis/yaxis to pan (matches its pre-existing keyboard/mouse-only touch support)
    if (e.touches.length === 1) { kind = 'pan'; lx = e.touches[0].clientX; ly = e.touches[0].clientY; }
    else if (e.touches.length >= 2) { kind = 'pinch'; ld = dist(e.touches); }
    e.stopPropagation(); e.preventDefault();
  }, { capture: true, passive: false });
  gd.addEventListener('touchmove', (e) => {
    if (is3D() || isLockedProj2D() || !kind) return;
    const sz = gd._fullLayout && gd._fullLayout._size;
    if (kind === 'pan' && e.touches.length === 1 && sz) {
      const dx = e.touches[0].clientX - lx, dy = e.touches[0].clientY - ly;
      lx = e.touches[0].clientX; ly = e.touches[0].clientY;
      pan2d(-dx / sz.w, dy / sz.h);                 // content follows the finger
    } else if (kind === 'pinch' && e.touches.length >= 2) {
      const d = dist(e.touches), m = mid(e.touches);
      if (ld > 0 && d > 0) zoom2dAbout(ld / d, m.x, m.y);   // spread → zoom in
      ld = d;
    }
    e.stopPropagation(); e.preventDefault();
  }, { capture: true, passive: false });
  gd.addEventListener('touchend', (e) => {
    if (is3D() || isLockedProj2D()) return;
    if (e.touches.length === 0) kind = null;
    else if (e.touches.length === 1) { kind = 'pan'; lx = e.touches[0].clientX; ly = e.touches[0].clientY; }
    else if (e.touches.length >= 2) { kind = 'pinch'; ld = dist(e.touches); }
    e.stopPropagation();
  }, { capture: true, passive: false });
})();

// Shift+drag pan for free-rotate 3D: the NAV_HELP text below claims "⇧-drag pan", but Plotly's native
// gl3d 'orbit' dragmode has no such shift-modifier — a shift+drag was confirmed (via before/after
// camera inspection: `center` never moved, only `eye`/`up` did) to just orbit exactly like a plain
// drag. So we drive it ourselves and suppress Plotly's own handling of the same gesture — except
// mouse events turned out not to be enough here: Plotly's gl3d canvas drives its drag/orbit off
// *Pointer* events (`pointerdown`/`pointermove`), not legacy mouse events — confirmed by logging both
// side by side: `pointermove` kept firing on the canvas, `defaultPrevented: false`, for every step of
// a drag whose parallel `mousemove` we'd already stopped. A browser dispatches both event families for
// the same physical gesture independently; stopping one says nothing about the other. So this listens
// on the pointer events instead. `PAN_DRAG_SCALE` converts a pixel delta into panCam()'s own
// per-keypress dx/dy units (100px of drag ≈ one keyboard ⇧+arrow nudge) — not trying to be
// pixel-exact, just proportional.
const PAN_DRAG_SCALE = 100;
(function () {
  const gd = document.getElementById('plot');
  let dragging = false, lx = 0, ly = 0;
  gd.addEventListener('pointerdown', (e) => {
    if (!is3D() || !e.shiftKey) return;
    dragging = true; lx = e.clientX; ly = e.clientY;
    e.preventDefault(); e.stopPropagation();
  }, { capture: true });
  gd.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (!e.shiftKey) { dragging = false; return; }   // shift released mid-drag: let go, don't fight the orbit
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    panCam(-dx / PAN_DRAG_SCALE, dy / PAN_DRAG_SCALE);   // content follows the cursor, matching pan2d's touch handler
    e.preventDefault(); e.stopPropagation();
  }, { capture: true });
  window.addEventListener('pointerup', () => { dragging = false; });
})();

document.addEventListener('keydown', (e) => {           // ignored while typing in a control
  const t = document.activeElement;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
  if (is3D()) {                                         // arrows orbit, ⇧ pans, +/- zoom, R reset, 1/2/3 presets
    const A = 0.12, P = 1, Z = 1.1, sh = e.shiftKey;
    switch (e.key) {
      case 'ArrowLeft':  sh ? panCam(-P, 0) : orbitCam(-A, 0); break;
      case 'ArrowRight': sh ? panCam(P, 0)  : orbitCam(A, 0); break;
      case 'ArrowUp':    sh ? panCam(0, P)  : orbitCam(0, A); break;
      case 'ArrowDown':  sh ? panCam(0, -P) : orbitCam(0, -A); break;
      case '+': case '=': zoomCam(1 / Z); break;
      case '-': case '_': zoomCam(Z); break;
      case 'r': case 'R': resetCam(); break;
      case '1': presetCam(0); break;
      case '2': presetCam(1); break;
      case '3': presetCam(2); break;
      default: return;
    }
  } else if (isLockedProj2D()) {                        // locked projection: arrows pan, +/- zoom, R re-lock (no rotate)
    const P = 1, Z = 1.1;
    switch (e.key) {
      case 'ArrowLeft':  panCam(-P, 0); break;
      case 'ArrowRight': panCam(P, 0); break;
      case 'ArrowUp':    panCam(0, P); break;
      case 'ArrowDown':  panCam(0, -P); break;
      case '+': case '=': zoomCam(1 / Z); break;
      case '-': case '_': zoomCam(Z); break;
      case 'r': case 'R': resetProj(); break;
      default: return;
    }
  } else {                                              // flat 2D (restrictions >= 1): arrows pan, +/- zoom, R reset
    const P = 0.12, Z = 1.15;
    switch (e.key) {
      case 'ArrowLeft':  pan2d(-P, 0); break;
      case 'ArrowRight': pan2d(P, 0); break;
      case 'ArrowUp':    pan2d(0, P); break;
      case 'ArrowDown':  pan2d(0, -P); break;
      case '+': case '=': zoom2d(1 / Z); break;
      case '-': case '_': zoom2d(Z); break;
      case 'r': case 'R': reset2d(); break;
      default: return;
    }
  }
  e.preventDefault();
});
// (fixes a latent inert branch in the old code: dblclick called reset2d() for 'proj' mode too,
// even though that mode's scene had no top-level xaxis/yaxis for reset2d's relayout to touch —
// harmless no-op there since Reset · Camera already used the correct 3-way branch.)
document.getElementById('plot').addEventListener('dblclick', () => { is3D() ? resetCam() : isLockedProj2D() ? resetProj() : reset2d(); });

function setLoading(msg) {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.remove('hidden', 'error');
  document.getElementById('loadmsg').textContent = msg;
}
function setLoadError(msg) {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.remove('hidden');
  el.classList.add('error');
  document.getElementById('loadmsg').textContent = msg;
}
const hideLoading = () => document.getElementById('loading')?.classList.add('hidden');

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r.json();
}

// Reference surface (derived, closed-form — not a construct sheet). Within each fixed-edge
// slice it linearly interpolates between the razborov point (disjoint cliques, cherry = 0) and
// the regular-razborov point (cherry = closed-form max, on δ₂ = d² so triangle = d² − cherry/3).
// Lofting those segments over edge density d gives a ruled quad mesh — a candidate boundary to
// compare the SDP samples against. Covers the d < 1/2 scallops k = 2 ([1/3,1/2]) and 3 ([1/4,1/3]).
function razborovInterpSheet() {
  const coraz = (k, d) => {                         // disjoint cliques: k·s² + (1−ks)² = d
    const A = k * (k + 1), B = -2 * k, C = 1 - d;
    const s = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);  // root in [1/(k+1), 1/k]
    const a = 1 - k * s, d3 = k * s ** 3 + a ** 3;
    return [3 * d - 3 * d3, 0, d3];                 // [d1, d2=0, d3]
  };
  const cherryMax = (k, d) => 3 * (1 - (k - 1) * d) * (1 - k * d) * ((k + 1) * d - 1);
  const regRaz = (k, d) => {
    const d2 = cherryMax(k, d), d3 = d * d - d2 / 3;   // regular ⇒ δ₂ = d²
    return [3 * d - 2 * d2 - 3 * d3, d2, d3];
  };
  const verts = [], faces = [], params = [], N = 60;
  for (const k of [2, 3]) {
    const lo = 1 / (k + 1), hi = 1 / k;
    for (let i = 0; i <= N; i++) {
      const d = lo + (hi - lo) * i / N, b = verts.length;
      verts.push(coraz(k, d)); params.push([d, 0]);
      verts.push(regRaz(k, d)); params.push([d, 1]);
      if (i > 0) faces.push([b - 2, b - 1, b + 1], [b - 2, b + 1, b]);
    }
  }
  return { id: 'razborov-interp', family: 'reference', group: 'reference',
    kind: 'surface', complement: 'none', opacity: 0.22,
    description: 'Not a graph construction — a visual guide only. Within each fixed edge-density '
      + 'slice it is the straight segment from the co-Razborov / disjoint-clique point (cherry '
      + 'd₂ = 0, maximal triangle) to the regular-Razborov point (maximal cherry on the Goodman '
      + 'surface δ₂ = d²). Lofting these segments over edge density gives a ruled surface — a '
      + 'candidate boundary to compare the SDP samples against, covering the scallops k = 2 '
      + '(d ∈ [1/3, 1/2]) and k = 3 (d ∈ [1/4, 1/3]). Shown in grey; off by default.',
    geometry: { kind: 'mesh', vertices: verts, faces, params, boundary: [], corners: [] } };
}

// The co-cherry-maximal regular graphons: the d=1/4 ridge of the Goodman surface — a straight
// segment from the triangle-free 1/4-regular graphon to the four-equal-cliques point (d2=0,
// d3=1/16). Derived from the already-loaded `regular` sheet (a plain d=1/4 restriction — the
// regular profile is affine in d3 at fixed d, and the realizable-band clip happens to pin that
// slice to exactly [0,1/16], so a single restriction gives the whole ridge, no separate "upper
// envelope" logic needed) rather than a second hand-typed copy of `regular_profile(d,d3)`. The
// dedicated sheet still exists because the d1-d3 projection of the solid `regular` mesh occludes
// this thin interior ridge from most angles — it is purely a rendering highlight, not new data.
function deriveCherryRidgeSheet(regularSheet) {
  if (!regularSheet) return null;
  const cells = reduceGeometry(regularSheet, [{ axis: 'd', value: 0.25 }]);
  if (!cells.length) return null;
  const points = [cells[0][0].pt, ...cells.map((c) => c[1].pt)];
  return { id: 'regular-cherry-ridge', family: 'regular-cherry-ridge', group: 'regular-cherry-ridge',
    kind: 'parametric_curve', complement: 'reflect', color: '#7048e8',
    description: 'Regular graphons at edge density $1/4$ (so $\\delta_2 = 1/16$), from the '
      + 'triangle-free $1/4$-regular graphon to the four-equal-cliques point ($d_2 = 0$).',
    geometry: { kind: 'polyline', points } };
}

// The probability-simplex frame as a toggleable reference (on by default — see DEFAULT_ON). It has
// no standard geometry — `kind: 'frame'` keeps renderSheets from drawing it; drawScene3D /
// drawFlat2D draw the frame directly, gated on `enabled.simplex`.
function simplexSheet() {
  return { id: 'simplex', family: 'simplex', group: 'references', kind: 'frame', complement: 'self' };
}
// Loads the manifest + sheets and (re)builds everything derived from them: the axis catalog
// (spanning every pattern-size group), the sheet list, styling, and the legend/controls. Always
// restores the persisted view (dims/axes/restrictions/limits/legend visibility/camera) — there is
// only one manifest now, so a saved axis key is either still valid (`applySavedView`'s `validAxis`
// guard) or simply dropped, never silently wrong-profile.
async function load() {
  const v = `?t=${Date.now()}`; // cache-bust the data too
  try {
    setLoading('Loading manifest…');
    const manifest = await fetchJSON(`data/manifest.json${v}`);
    // Build the axis catalog and pattern-size groups from this manifest — must happen before
    // anything below reads AXES (applySavedView's validAxis) or calls reflect() (sheet loading).
    GROUPS = manifest.groups;
    AXES = buildAxes(GROUPS);
    const files = manifest.sheets;
    let done = 0;
    setLoading(`Loading sheets 0/${files.length}…`);
    // allSettled so a single bad/missing sheet degrades gracefully instead of blanking the app.
    const results = await Promise.allSettled(files.map(async (file) => {
      const s = await fetchJSON(`data/sheets/${file}${v}`);
      setLoading(`Loading sheets ${++done}/${files.length}…`);
      return s;
    }));
    sheets = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) console.warn(`graph-profile-viz: ${failed.length} sheet(s) failed to load`, failed.map((r) => r.reason && r.reason.message));
    if (!sheets.length) { setLoadError('Failed to load any data sheets.'); return; }
    // External sample overlays (collaborator data, not produced by `gpd construct`) live in a
    // separate file so re-emitting constructions never clobbers them. Optional — skip if absent.
    setLoading('Loading overlays…');
    try {
      const extra = await fetchJSON(`data/overlays.json${v}`);
      if (Array.isArray(extra)) sheets.push(...extra);
    } catch { /* no overlays present */ }
  } catch (e) {
    setLoadError(`Failed to load data: ${e.message}`);
    return;
  }
  // Drop the Glebov h_B pair entirely, and the co-h_A sheet (its complement now rides inline
  // with glebov-ha as a reference item). The creases (Razborov–Lo, threshold-graph) ARE shown,
  // as plain construction curves.
  sheets = sheets.filter((s) => !['glebov-hb', 'co-glebov-hb', 'co-glebov-ha'].includes(s.family || s.id));
  sheets.push(razborovInterpSheet());   // grey reference surface (derived, closed-form) — no graphon
  sheets.push(simplexSheet());          // the probability-simplex frame, a toggleable reference
  // even-disjoint-cliques, multipartite-tpartite, gnp, goodman-reg, goodman-tri, razborov-bound and
  // huang-bound now all come from the producer (data/manifest.json + data/sheets) — only the
  // cherry-ridge highlight is still derived client-side (a pure rendering fix, not new data; see
  // deriveCherryRidgeSheet's doc comment).
  const ridge = deriveCherryRidgeSheet(sheets.find((s) => s.id === 'regular'));
  if (ridge) sheets.push(ridge);
  const savedView = migrateLegacyView(loadView());   // restore the persisted view (dims/axes/…) before styling
  applySavedView(savedView);
  // Present the multipartite side as primary across the boundary constructions. For real complement
  // pairs, flip which half carries the co-/non-co family tag so the multipartite one becomes the
  // canonical (bold) row with its clique-side complement riding along faded. For the one-sided overlay
  // curve (Glebov h_A) there is no data complement, so reflect its geometry instead — the bold primary
  // becomes the multipartite complement and the original (clique-side) rides along via the overlay.
  const fam = (id, f) => { const s = sheets.find((x) => x.id === id); if (s) s.family = f; };
  fam('disjoint-cliques', 'co-disjoint-cliques'); fam('complete-multipartite', 'disjoint-cliques');
  fam('huang-et-al', 'co-huang-et-al'); fam('co-huang-et-al', 'huang-et-al');   // complement primary
  // one-sided overlays with no data complement (Glebov h_A, flag-algebra samples, interpolation guide):
  // reflect their geometry so the multipartite complement is the bold primary (labels unchanged).
  for (const id of ['glebov-ha', 'razborov-interp', '6-vertex flag algebra', '7-vertex flag algebra',
    'christoph-6-vertex', 'christoph-7-vertex']) {
    const g = (sheets.find((x) => x.id === id) || {}).geometry;
    if (g && g.points) g.points = g.points.map(reflect);
    if (g && g.vertices) g.vertices = g.vertices.map(reflect);
  }
  // Style each sheet from its display group's base hue: members of a group share the hue, scallop
  // curves take a darker shade of it, and a construction's complement reads as a desaturated + lightened
  // version of the SAME hue (coTint) — visible even with the transparency toggle off — plus lower opacity.
  // Pass 1: each sheet's base hue. Numerical data → its own `color` or red; references → grey; else group hue.
  let pi = 0;
  const baseHue = {};
  for (const s of sheets) {
    const g = dispGroup(s);
    s._type = sheetType(s);
    baseHue[s.id] = s.kind === 'points' ? (s.color || COLORS.data)
      : s._type === 'reference' ? COLOR_REF
      : s._type === 'ineq' ? hueShift(GROUP_COLOR[g] || '#888888', BOUND_HUE[baseGroup(s)] ?? 28) // bound → hue adjacent to its section
      : SHEET_COLOR[s.id] || (GROUP_COLOR[g] || (GROUP_COLOR[g] = PALETTE[pi++ % PALETTE.length]));
  }
  // Pass 2: a complement borrows its density partner's hue (so per-sheet overrides carry across the pair),
  // then desaturates + lightens it; scallop curves take a darker shade of the resulting hue.
  for (const s of sheets) {
    const co = isCoSheet(s), curve = isCurveSheet(s);
    const meshK = (s.geometry && s.geometry.kind === 'mesh');
    let base = baseHue[s.id], densBase = base;   // densBase = un-tinted hue (for the 'show' complement mode)
    if (co) {
      const d = sheets.find((x) => !isCoSheet(x) && x.group === s.group);
      if (d && baseHue[d.id]) { base = baseHue[d.id]; densBase = baseHue[d.id]; }
      base = coTint(base);
    }
    s._color = curve ? shade(base, 0.68) : base;       // scallops a darker shade of the (tinted) hue
    s._isCo = co;
    s._opacity = meshK ? (s.opacity != null ? s.opacity : (co ? 0.24 : 0.42)) : (co ? 0.5 : 0.95);
    if (co) {
      // Light = faded tint (default); Show = full density appearance. applyCoAppearance() picks per draw.
      s._lightColor = s._color; s._lightOpacity = s._opacity;
      s._fullColor = curve ? shade(densBase, 0.68) : densBase;
      s._fullOpacity = meshK ? (s.opacity != null ? s.opacity : 0.42) : 0.95;
    }
    enabled[s.id] = defaultEnabled(s.id);
  }
  // Collapse density/co-density into one toggle: each co inherits its density's enabled state, and
  // densities owning a real co- sheet are marked so renderSheets does not also reflect them inline.
  // Pairing is by the shared `group` field: `-data` emits `group` with the `co-` prefix stripped,
  // so a density and its co-sheet carry the same group (see applyDefaults / renderSidebar too).
  hasCoSheet = new Set();
  for (const s of sheets) {
    if (!isCoSheet(s)) continue;
    const d = sheets.find((x) => !isCoSheet(x) && x.group === s.group);
    if (d) { hasCoSheet.add(d.id); enabled[s.id] = enabled[d.id]; }
  }
  // Restore persisted legend visibility for ids still present (unknown/new ids keep their default);
  // then re-sync each co-sheet to its density so a pair stays consistent. Fall back to the older
  // `enabledByProfile.m3` shape (pre-unification localStorage, keyed per now-removed Profile toggle)
  // so a returning user's legend customization isn't silently discarded on their first load after
  // this shipped.
  const persistedEnabled = (savedView && savedView.enabled)
    || (savedView && savedView.enabledByProfile && savedView.enabledByProfile.m3);
  if (persistedEnabled) {
    for (const s of sheets) if (s.id in persistedEnabled) enabled[s.id] = !!persistedEnabled[s.id];
    for (const s of sheets) {
      if (!isCoSheet(s)) continue;
      const d = sheets.find((x) => !isCoSheet(x) && x.group === s.group);
      if (d) enabled[s.id] = enabled[d.id];
    }
  }
  renderSidebar();
  setupControls();
  setupLegendActions();
  draw();
  hideLoading();
}

// A handful of the m3 group's "derived" axes are secretly pure edge-density quantities (affine in
// `d` alone: d itself, e = 2d-1, h1 = 1-2d) — a 2-vertex statistic in disguise, computed from the
// m3 coefficient vector only because that's the group that was always present. Bucket them under
// their own "2-vertex" heading rather than "3-vertex", where they'd otherwise sit indistinguishable
// from genuinely 3-vertex quantities (delta2, m, phi, mono, h2, h3 all need the joint 3-vertex
// structure, not just the marginal edge count).
const TWO_VERTEX_KEYS = new Set(['d', 'e', 'h1']);
// Which dropdown section an axis belongs to: raw (isomorphism-class) and derived (linear-
// combination) axes get separate sections per pattern size, so "3-vertex densities" is never a mix
// of both kinds. Same-looking keys from different groups (m3's derived `d` = overall edge density
// vs m4's raw `edge` = the single-edge-class K2+2K1 density) also land in visibly different
// sections instead of two near-identical words sitting next to each other in a flat list.
function axisBucket(a) {
  if (TWO_VERTEX_KEYS.has(a.key)) return '2-vertex densities';
  const grp = GROUPS.find((g) => g.offset === a.groupOffset);
  const m = grp ? grp.m : '?';
  return a.kind === 'derived' ? `${m}-vertex densities (derived)` : `${m}-vertex densities`;
}
// Explicit order (not "whichever bucket a dropdown happens to see first") — derived from `GROUPS`
// pattern sizes would need this list extended if a group beyond m=3/m=4 is ever added.
const AXIS_BUCKET_ORDER = ['2-vertex densities', '3-vertex densities', '3-vertex densities (derived)', '4-vertex densities', '4-vertex densities (derived)'];
function fillAxisSelect(id, value, onpick) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  const byBucket = new Map();
  for (const a of AXES) {
    const b = axisBucket(a);
    if (!byBucket.has(b)) byBucket.set(b, []);
    byBucket.get(b).push(a);
  }
  for (const b of AXIS_BUCKET_ORDER) {
    const items = byBucket.get(b);
    if (!items || !items.length) continue;   // e.g. "4-vertex densities (derived)" — none exist yet
    const og = document.createElement('optgroup');
    og.label = b;
    for (const a of items) {
      const o = document.createElement('option');
      o.value = a.key; o.textContent = a.short; o.title = a.label;   // compact notation; full name on hover
      og.appendChild(o);
    }
    el.appendChild(og);
  }
  el.value = value;
  el.onchange = (e) => { onpick(e.target.value); draw(); };
}

function setupControls() {
  const axSlots = document.getElementById('ax-slots');

  // One <label><select><input-min><input-max></label> row per axis slot (dims-many), always shown
  // and rebuilt whenever dims or the axis choices change.
  const labels = ['x', 'y', 'z'];
  function buildAxisSlots() {
    axSlots.innerHTML = '';
    for (let i = 0; i < dims; i++) {
      const label = document.createElement('label');
      const span = document.createElement('span'); span.textContent = `${labels[i]}-axis`;
      const sel = document.createElement('select'); sel.id = `slot${i}`;
      const mn = document.createElement('input'); mn.className = 'axlim'; mn.placeholder = 'min'; mn.inputMode = 'decimal'; mn.autocomplete = 'off';
      const mx = document.createElement('input'); mx.className = 'axlim'; mx.placeholder = 'max'; mx.inputMode = 'decimal'; mx.autocomplete = 'off';
      label.append(span, sel, mn, mx);
      axSlots.appendChild(label);
      // an axis-key limit follows the axis, not the slot — re-sync the inputs whenever this slot's
      // selected axis changes (a plain slot-id-keyed cache would show the WRONG key's stale limit).
      const syncLim = () => { const L = axisLimits[axes[i]] || {}; mn.value = L.min != null ? L.min : ''; mx.value = L.max != null ? L.max : ''; };
      fillAxisSelect(sel.id, axes[i], (v) => {
        axes[i] = v; needCenter = true; needCenter2D0 = true;
        syncLim(); renderSidebar();
      });
      syncLim();
      const updLim = () => { axisLimits[axes[i]] = { min: parseNum(mn.value), max: parseNum(mx.value) }; draw(); };
      mn.oninput = updLim; mx.oninput = updLim;
    }
  }
  buildAxisSlots();

  // Restriction rows: one per entry in `restrictions`, each "[axis] = [− value +] [×]" — rebuilt
  // whenever a restriction is added/removed (the axis/value themselves update in place, no rebuild).
  const restrictionsEl = document.getElementById('restrictions');
  function buildRestrictionRows() {
    restrictionsEl.innerHTML = '';
    restrictions.forEach((r, i) => {
      const row = document.createElement('div'); row.className = 'restriction-row slicerow';
      const sel = document.createElement('select'); sel.id = `rax${i}`;
      const eq = document.createElement('span'); eq.className = 'eq'; eq.textContent = '=';
      const stepper = document.createElement('div'); stepper.className = 'stepper';
      const dec = document.createElement('button'); dec.type = 'button'; dec.className = 'step'; dec.textContent = '−'; dec.setAttribute('aria-label', 'decrease');
      const num = document.createElement('input'); num.type = 'text'; num.inputMode = 'text'; num.autocomplete = 'off';
      num.title = 'decimal or fraction, e.g. 0.42 or 1/3'; num.value = fmtSlice(r.value);
      const inc = document.createElement('button'); inc.type = 'button'; inc.className = 'step'; inc.textContent = '+'; inc.setAttribute('aria-label', 'increase');
      stepper.append(dec, num, inc);
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'r-remove'; rm.textContent = '×'; rm.title = 'Remove this restriction'; rm.setAttribute('aria-label', 'remove restriction');
      row.append(sel, eq, stepper, rm);
      restrictionsEl.appendChild(row);

      fillAxisSelect(sel.id, r.axis, (v) => { restrictions[i] = { ...restrictions[i], axis: v }; needCenter = true; needCenter2D0 = true; renderSidebar(); });
      const setVal = (v, src) => {
        if (isNaN(v)) return;
        // [-1,1], not [0,1]: every AXES entry is bounded within [-1,1] (the [0,1] densities are a
        // subset; the harmonic h1/h2/h3 basis genuinely ranges over [-1,1] — clamping to [0,1] would
        // silently make negative harmonic values unreachable).
        restrictions[i] = { ...restrictions[i], value: Math.min(1, Math.max(-1, v)) };
        if (src !== 'num') num.value = fmtSlice(restrictions[i].value); // don't fight the field being typed in
        draw();
      };
      const stepVal = (dir) => setVal(parseFloat((Math.round(restrictions[i].value / SLICE_STEP) * SLICE_STEP + dir * SLICE_STEP).toFixed(4)), 'btn');
      dec.onclick = () => stepVal(-1);
      inc.onclick = () => stepVal(1);
      num.oninput = () => setVal(parseSlice(num.value), 'num');
      num.onblur = () => { num.value = fmtSlice(restrictions[i].value); };
      rm.onclick = () => {
        restrictions.splice(i, 1); needCenter = true; needCenter2D0 = true;
        buildRestrictionRows(); renderSidebar(); draw();
      };
    });
  }
  buildRestrictionRows();
  document.getElementById('add-restriction').onclick = () => {
    const used = new Set([...restrictions.map((r) => r.axis), ...axes]);   // avoid both another restriction's axis AND a currently-plotted one
    const dflt = (AXES.find((a) => a.key === 'd' && !used.has(a.key)) || AXES.find((a) => !used.has(a.key)) || AXES[0] || {}).key || 'd';
    restrictions.push({ axis: dflt, value: 0.5 });
    needCenter = true; needCenter2D0 = true;
    buildRestrictionRows(); renderSidebar(); draw();
  };

  // dims toggle: 2D or 3D. Trims/extends `axes` to match, preserving existing choices where possible.
  const dimsBtn = { 2: document.getElementById('d2btn'), 3: document.getElementById('d3btn') };
  const setDims = (n) => {
    dims = n;
    for (const k in dimsBtn) dimsBtn[k].classList.toggle('on', Number(k) === n);
    if (axes.length > dims) axes = axes.slice(0, dims);
    else while (axes.length < dims) axes.push(pickUnusedAxis());
    needCenter = true; needCenter2D0 = true;
    buildAxisSlots(); renderSidebar(); draw();
  };
  for (const k in dimsBtn) dimsBtn[k].onclick = () => setDims(Number(k));
  for (const k in dimsBtn) dimsBtn[k].classList.toggle('on', Number(k) === dims);
}

// Global render-mode controls (Complements/Surfaces), in the same labeled-segmented style as View.
// Mounted in #render-controls — a static slot in #controls (ahead of Axes), not #sheets — and
// independent of `sheets`/`AXES`, so unlike the legend/axis pickers it can (and does) render
// immediately at startup instead of staying blank until the manifest finishes loading.
function renderRenderControls() {
  const mount = document.getElementById('render-controls');
  mount.innerHTML = '';
  const mkSeg = (label, opts, active, onPick) => {
    const block = document.createElement('div'); block.className = 'segblock';
    const lab = document.createElement('div'); lab.className = 'seglabel'; lab.textContent = label;
    const ctl = document.createElement('div'); ctl.className = 'segctl';
    for (const o of opts) {
      const b = document.createElement('button'); b.textContent = o.text;
      if (o.key === active) b.classList.add('on');
      b.onclick = () => onPick(o.key);
      ctl.append(b);
    }
    block.append(lab, ctl);
    return block;
  };
  mount.append(
    mkSeg('Complements',
      [{ key: 'hide', text: 'Hide' }, { key: 'light', text: 'Light' }, { key: 'show', text: 'Show' }],
      complementMode, (k) => { complementMode = k; renderRenderControls(); draw(); }),
    mkSeg('Surfaces',
      [{ key: 'solid', text: 'Solid' }, { key: 'transparent', text: 'Transparent' }, { key: 'wireframe', text: 'Wireframe' }],
      surfaceMode, (k) => { surfaceMode = k; renderRenderControls(); draw(); }),
  );
}

// Render the legend: one section per display group, one row per density sheet (its co-density
// rides along). Hovering a row shows the construction's description; descriptions are not inline.
function renderSidebar() {
  _suppressNextHighlight = true;   // about to replace every row's DOM node — see the flag's own comment
  const div = document.getElementById('sheets');
  div.innerHTML = '';
  // Primary groups keep their first-seen order; any extra group not already shown is appended.
  const primaryGroups = [...new Set(sheets.map(dispGroup))];
  const extra = [...new Set(sheets.flatMap(extraGroups))].filter((g) => !primaryGroups.includes(g));
  for (const grp of [...primaryGroups, ...extra]) {
    const collapsed = collapsedGroups.has(grp);
    // Computed before the header so the per-section All/None/Default actions are scoped to exactly
    // the rows this section renders, regardless of whether it's currently collapsed.
    const inSec = sheets.filter((x) => dispGroup(x) === grp || extraGroups(x).includes(grp));
    const hdr = document.createElement('div'); hdr.className = 'khdr' + (collapsed ? ' collapsed' : '');
    const arrow = document.createElement('span'); arrow.className = 'khdr-arrow'; arrow.textContent = '▾';
    const label = document.createElement('span'); label.className = 'khdr-label'; label.textContent = GROUP_TITLE[grp] || grp;
    hdr.append(arrow, label);
    // Per-section select-all/none/default — scoped to inSec only, so sections toggle independently.
    const secActions = document.createElement('span'); secActions.className = 'khdr-actions';
    const mkSecAction = (text, fn) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
      b.onclick = (e) => { e.stopPropagation(); fn(); renderSidebar(); draw(); };  // stop: don't also toggle collapse
      return b;
    };
    secActions.append(
      mkSecAction('All', () => { inSec.forEach((s) => { enabled[s.id] = true; }); }),
      mkSecAction('None', () => { inSec.forEach((s) => { enabled[s.id] = false; }); }),
      mkSecAction('Default', () => applyDefaults(inSec)),
    );
    hdr.append(secActions);
    hdr.onclick = () => { collapsed ? collapsedGroups.delete(grp) : collapsedGroups.add(grp); renderSidebar(); };
    div.appendChild(hdr);
    if (collapsed) continue;   // fold the section shut — rows hidden, sheet visibility unchanged
    // Primary members of this group come first (borrowed ALSO_IN_GROUP rows follow), then the
    // explicit SECTION_ORDER; unlisted ids keep their array order.
    inSec.sort((a, b) =>
      ((dispGroup(a) === grp ? 0 : 1) - (dispGroup(b) === grp ? 0 : 1)) || (orderIdx(a) - orderIdx(b)));
    for (const s of inSec.filter((x) => !isCoSheet(x))) {        // one row per density; its co rides along
      const ids = [s.id, ...inSec.filter((x) => isCoSheet(x) && x.group === s.group).map((x) => x.id)];
      const wrap = document.createElement('div');
      wrap.className = 'sheet' + (enabled[s.id] ? '' : ' off');
      wrap.style.setProperty('--sheet-color', s._color);
      // single click toggles (briefly delayed so a double-click can pre-empt it); double click isolates
      wrap.onclick = () => {
        clearTimeout(_clickT);
        _clickT = setTimeout(() => {
          _clickT = null;
          const on = !enabled[s.id]; for (const id of ids) enabled[id] = on; renderSidebar(); draw();
        }, 250);
      };
      wrap.ondblclick = () => { clearTimeout(_clickT); _clickT = null; isolateSheet(ids); };
      wrap.addEventListener('mouseenter', (e) => { showLegendTip(s, e); highlightSheet(s); });   // tip + highlight
      wrap.addEventListener('mousemove', (e) => { tipMouse = { x: e.clientX, y: e.clientY }; if (tipEl.classList.contains('show')) positionTip(); });
      wrap.addEventListener('mouseleave', () => { onTipUnhover(); clearHighlight(); });
      const title = document.createElement('div');
      title.className = 'sheet-title';
      const icon = document.createElement('span');
      icon.className = 'sheet-icon';
      icon.innerHTML = typeIconSVG(geomKind(s), s._color);   // point / curve / surface glyph
      const name = document.createElement('span');
      name.className = 'sheet-name';
      name.textContent = (ALSO_TITLE[grp] && ALSO_TITLE[grp][s.id]) || TITLE[s.id] || s.id;
      title.append(icon, name);
      const note = OPEN_NOTE[(s.id || '').replace(/^co-/, '')];   // open/unproven flag
      if (note) {
        name.style.flex = '0 1 auto';            // don't grow → the flag sits right after the name
        const flag = document.createElement('span');
        flag.className = 'open-flag';
        flag.textContent = note.symbol || '!';
        flag.addEventListener('mouseenter', (e) => { e.stopPropagation(); showNoteTip(note, e); });
        flag.addEventListener('mousemove', (e) => { e.stopPropagation(); tipMouse = { x: e.clientX, y: e.clientY }; if (tipEl.classList.contains('show')) positionTip(); });
        flag.addEventListener('mouseleave', (e) => { e.stopPropagation(); showLegendTip(s, e); });
        title.append(flag);
      }
      if (TYPE_LABEL[s._type]) {                 // no pill for plain constructions
        const tag = document.createElement('span');
        tag.className = 'tag tag-' + s._type;
        tag.textContent = TYPE_LABEL[s._type];
        title.append(tag);
      }
      wrap.appendChild(title);
      div.appendChild(wrap);
    }
  }
}

function setupLegendActions() {
  // Select-all / Unselect-all / Default are rendered inside renderSidebar (toolbar above the list).
  // Reset group: hover unfolds the options on pointer devices; on touch the tab taps open/closed
  // via an `.open` class, dismissed by tapping anywhere outside.
  const resetGroup = document.getElementById('reset-group');
  const resetTab = document.getElementById('reset-tab');
  if (resetTab && resetGroup) {
    resetTab.onclick = (e) => { e.stopPropagation(); resetGroup.classList.toggle('open'); };
    document.addEventListener('click', (e) => { if (!resetGroup.contains(e.target)) resetGroup.classList.remove('open'); });
  }
  // Reset · Camera: reset only the view (3D camera or 2D axis ranges), leaving settings intact.
  const resetCamBtn = document.getElementById('reset-cam');
  if (resetCamBtn) resetCamBtn.onclick = () => { is3D() ? resetCam() : isLockedProj2D() ? resetProj() : reset2d(); resetGroup?.classList.remove('open'); };
  // Reset · All: wipe every persisted gpv-* key (view + theme + sidebar width/collapse) and reload fresh.
  const resetAllBtn = document.getElementById('reset-all');
  if (resetAllBtn) resetAllBtn.onclick = () => {
    if (!confirm('Reset all settings to defaults? This clears your saved view, theme and sidebar size.')) return;
    Object.keys(localStorage).filter((k) => k.startsWith('gpv')).forEach((k) => localStorage.removeItem(k));
    location.reload();
  };
}

const NAV_HELP = {
  '3d': 'drag rotate · scroll zoom · ⇧-drag pan<br>arrows rotate · ⇧+arrows pan · +/− zoom · R / dbl-click reset',
  'proj': 'locked projection · drag pan · scroll zoom<br>orientation fixed (no rotate) · arrows pan · +/− zoom · R reset',
  '2d': 'drag pan · scroll zoom<br>arrows pan · +/− zoom · R / dbl-click reset',
};
// Visible "nothing to show" state instead of a silent blank plot — the concrete failure this fixes:
// picking a 4-vertex axis (K4, etc.) with every sheet that carries real 4-vertex data hidden in the
// legend (huang-et-al defaults to off) used to render an empty canvas with zero explanation.
// Narrowly scoped to "no enabled sheet supports the current axis+restriction-axis set" — a
// restriction value outside a surface's parameter range is a different, self-explanatory situation
// (the trace is just empty, same as e.g. slicing outside [0,1]) and deliberately out of scope here.
// One more renderSheets() call per draw — already called 2x internally by drawScene3D/drawFlat2D's
// own trace-building, all over a sheet list of ~30 with no per-frame hot loop — not worth threading
// through every render function's signature to save (Law #1: measure, don't guess; this hasn't been
// measured as a real cost, unlike the mesh-cutting duplication reduceCellsFor exists to avoid).
function updateNoDataIndicator() {
  const el = document.getElementById('no-data');
  if (!el) return;
  const allAxisKeys = [...new Set([...axes, ...restrictions.map((r) => r.axis)])];
  const shown = renderSheets();
  const anyEnabled = shown.length > 0 || enabled.simplex;
  const anySupports = shown.some((s) => sheetSupportsAxes(s, allAxisKeys)) || (enabled.simplex && simplexAxesOk(allAxisKeys));
  el.classList.toggle('show', anyEnabled && !anySupports);
}
// Whichever of the three render strategies is active changes the underlying Plotly scene type
// (gl3d rotate <-> gl3d locked-orthographic <-> plain xy2d) — purge once here, in the one place that
// decides which strategy is active, rather than scattering a purge call across every state mutation
// that could flip it (dims toggling, a restriction being added/removed while dims===2, ...).
let _lastRenderKind = null;
function draw() {
  const kind = is3D() ? '3d' : isLockedProj2D() ? 'proj' : '2d';
  const help = document.getElementById('nav-help');
  if (help) { help.style.display = 'block'; help.innerHTML = NAV_HELP[kind]; }
  if (_lastRenderKind !== null && _lastRenderKind !== kind) {
    Plotly.purge('plot');
    needCenter = true; needCenter2D0 = true;
  }
  _lastRenderKind = kind;
  if (kind === '2d') drawFlat2D(); else drawScene3D();
  updateNoDataIndicator();
  saveView();   // persist the view on every state change (debounced)
}

// σ-complement of a sheet (co-densities): reflect every geometry point, keep topology.
function reflectSheet(s) {
  const g = s.geometry, ng = { ...g };
  // Self-complementary facets are their own σ-mirror: keep them only on the primary so they render
  // once (drawing them here too would coincide → z-fighting).
  if (g.facesSelf) ng.facesSelf = [];
  if (g.points) ng.points = g.points.map(reflect);
  if (g.vertices) ng.vertices = g.vertices.map(reflect);
  if (g.boundary) ng.boundary = g.boundary.map((e) => ({ ...e, points: e.points.map(reflect) }));
  if (g.corners) ng.corners = g.corners.map((c) => ({ ...c, point: reflect(c.point) }));
  // σ maps edge density d↦1−d, so the co-surface's edge rows are the mirrored points at 1−vals,
  // re-sorted ascending. (Only the 'd' axis is defined under σ here; future axes would need their own.)
  if (g.sliceRows) ng.sliceRows = g.sliceRows.filter((sr) => sr.axis === 'd').map((sr) => ({
    axis: sr.axis,
    vals: sr.vals.map((c) => 1 - c).reverse(),
    rows: sr.rows.map((r) => r.map(reflect)).reverse(),
  }));
  const meshK = (s.geometry && s.geometry.kind === 'mesh');
  return { ...s, id: s.id + ' (co)', geometry: ng, _isCo: true,
    _lightColor: coTint(s._color), _lightOpacity: meshK ? 0.24 : 0.5,   // faded tint (Light mode)
    _fullColor: s._color, _fullOpacity: s._opacity != null ? s._opacity : (meshK ? 0.42 : 0.95), // full (Show mode)
    _color: coTint(s._color), _opacity: meshK ? 0.24 : 0.5 };
}
// Apply the current complement render mode to a co-sheet: 'show' → full density appearance, else faded tint.
function applyCoAppearance(s) {
  const full = complementMode === 'show';
  if (full && s._fullColor) { s._color = s._fullColor; s._opacity = s._fullOpacity; }
  else if (s._lightColor) { s._color = s._lightColor; s._opacity = s._lightOpacity; }
}
// Sheets to render: each enabled sheet, plus the σ-mirror of enabled reference items (h_A, the
// interpolation surface, the flag-algebra samples) — these are one-sided, so the co-density
// version rides along under the same toggle/color with no separate legend entry.
function renderSheets(includePreview = true) {
  const out = [];
  const showCo = complementsVisible();
  for (const s of sheets) {
    // a disabled sheet is force-shown while its legend row is hovered (preview), else only if enabled
    const previewed = includePreview && baseSheetId(s.id) === _previewId;
    if ((!enabled[s.id] && !previewed) || s.kind === 'frame') continue;
    if (!showCo && isCoSheet(s)) continue;       // complements globally hidden: drop data co- sheets
    out.push(s);
    if (showCo && OVERLAY.has(s.id) && !hasCoSheet.has(s.id)) out.push(reflectSheet(s)); // inline co only when no data co- sheet
  }
  for (const s of out) if (s._isCo) applyCoAppearance(s);   // Light vs Show complement rendering
  return out;
}

// Build the 3D trace set (surfaces, curves, points, simplex frame) from the current viewAxes, with
// zero restrictions — shared by the free-rotate 3D scene and the locked-orthographic-projection
// scene (isLockedProj2D() always has restrictions.length === 0 by definition).
function build3DTraces() {
  const traces = [];
  if (enabled.simplex && simplexAxesOk(viewAxes)) traces.push(simplexWire());   // toggleable reference
  for (const s of renderSheets()) {
    if (!sheetSupportsAxes(s, viewAxes)) continue;   // no data for one of the 3 currently-viewed axes
    if (s.kind === 'points') traces.push(pointsTrace3D(s, s._color));
    else if (s.kind === 'parametric_curve') traces.push(curveTrace(s, s._color));
    else traces.push(...surfaceTraces(s, s._color));
  }
  return traces;
}
// The probability simplex's 6 wireframe edges as arity-2 cells (for reduceCell/applyRestrictions).
function simplexEdgeCells() {
  const V = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const E = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  return E.map(([a, b]) => [{ pt: V[a], prm: null }, { pt: V[b], prm: null }]);
}
// The simplex frame reduced by the current restrictions: at 1 restriction, a point per crossing
// edge; at 2+, whatever (generically very sparse) points also happen to satisfy every further
// restriction exactly. Deliberately scoped this narrow rather than a full N-dim polytope
// face-finder for a decorative reference object.
const reducedSimplexPoints = () => applyRestrictions(simplexEdgeCells(), restrictions).map((cell) => cell[0].pt);
// `reduceGeometry(sheet, restrictions)` cuts every triangle/segment of a sheet — real work for a
// large mesh — and both `reducedTraces3D` and `dataBounds3D` need it for the same sheet on the same
// draw; `cache` (built once per draw in `drawScene3D`, keyed by sheet object) makes that one cut,
// not two, on every restriction slider drag.
function reducedCellsFor(s, cache) {
  if (cache.has(s)) return cache.get(s);
  const cells = reduceGeometry(s, restrictions);
  cache.set(s, cells);
  return cells;
}
// dims===3 with restrictions >= 1: each sheet's geometry reduced to line segments (1 restriction on
// a mesh, or a curve untouched by the grid-aware fast path) or points (2+ restrictions, or 1
// restriction on an already-1D curve/points sheet), rendered inside the still-rotatable 3D scene.
function reducedTraces3D(cache) {
  const traces = [];
  const allAxisKeys = [...new Set([...axes, ...restrictions.map((r) => r.axis)])];
  for (const s of renderSheets()) {
    if (!sheetSupportsAxes(s, allAxisKeys)) continue;
    const cells = reducedCellsFor(s, cache);
    if (!cells.length) continue;
    if (cells[0].length === 2) {
      const X = [], Y = [], Z = [], CD = [];
      for (const cell of cells) {
        for (const r of cell) { const q = proj3(r.pt); X.push(q[0]); Y.push(q[1]); Z.push(q[2]); CD.push(densCustom(r.pt, r.prm)); }
        X.push(null); Y.push(null); Z.push(null); CD.push(null);
      }
      traces.push({ type: 'scatter3d', mode: 'lines', name: s.id, x: X, y: Y, z: Z,
        line: { color: s._color, width: 6 }, opacity: s._opacity ?? 0.95, customdata: CD, hoverinfo: 'none', _tip: tipMeta(s), showlegend: false });
    } else {
      const Q = cells.map((c) => proj3(c[0].pt));
      traces.push({ type: 'scatter3d', mode: 'markers', name: s.id,
        x: Q.map((q) => q[0]), y: Q.map((q) => q[1]), z: Q.map((q) => q[2]),
        marker: { size: 4, color: s._color, opacity: s._isCo ? 0.4 : 1 },
        customdata: cells.map((c) => densCustom(c[0].pt, c[0].prm)), hoverinfo: 'none', _tip: tipMeta(s), showlegend: false });
    }
  }
  if (enabled.simplex && simplexAxesOk(allAxisKeys)) {
    const pts = reducedSimplexPoints();
    if (pts.length) {
      const Q = pts.map(proj3);
      traces.push({ type: 'scatter3d', mode: 'markers', hoverinfo: 'skip',
        x: Q.map((q) => q[0]), y: Q.map((q) => q[1]), z: Q.map((q) => q[2]),
        marker: { size: 3, color: SIMPLEX_COLOR }, showlegend: false });
    }
  }
  return traces;
}
// Pad a [lo,hi] outward (~5% of span) and round to clean 3-decimal bounds; degenerate (flat) axes get
// a small symmetric window so the scene isn't collapsed.
function niceRange(lo, hi) {
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  let span = hi - lo;
  if (span < 1e-9) return [Math.floor((lo - 0.05) * 1000) / 1000, Math.ceil((hi + 0.05) * 1000) / 1000];
  const pad = span * 0.05;
  return [Math.floor((lo - pad) * 1000) / 1000, Math.ceil((hi + pad) * 1000) / 1000];
}
// Bounding box of the currently-displayed geometry in the three view axes (excludes the simplex frame,
// since renderSheets() already drops it). Drives the default 3D / locked-projection axis ranges so
// each axis fills the data, and — with camera.center=(0,0,0) and a cube/data box — makes rotation
// pivot on the object's centre. With restrictions active (is3D() only — isLockedProj2D() always has
// zero), fits the *reduced* geometry instead of the raw mesh/curve, so the cube frames what's
// actually shown rather than the unrestricted extent. Returns three [lo,hi] ranges, or null when
// nothing is shown. Deliberately ignores a legend-hover preview (renderSheets(false)): a preview is
// meant to show a disabled sheet's shape inside the *current* view, not resize/rescale that view out
// from under the user just because they moved their mouse over a row.
function dataBounds3D(cache) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let any = false;
  const acc = (p) => {
    const q = proj3(p);
    for (let i = 0; i < 3; i++) { if (q[i] < lo[i]) lo[i] = q[i]; if (q[i] > hi[i]) hi[i] = q[i]; }
    any = true;
  };
  const allAxisKeys = [...new Set([...viewAxes, ...restrictions.map((r) => r.axis)])];
  for (const s of renderSheets(false)) {
    if (!sheetSupportsAxes(s, allAxisKeys)) continue;
    if (restrictions.length && is3D()) {
      for (const cell of reducedCellsFor(s, cache)) for (const r of cell) acc(r.pt);
    } else {
      const g = s.geometry || {};
      for (const p of (g.vertices || g.points || [])) {
        if (!p) continue;   // skip null separators in multi-segment polylines
        acc(p);
      }
    }
  }
  // The simplex frame is drawn outside renderSheets(); when shown it must still size the axes.
  if (enabled.simplex && simplexAxesOk(allAxisKeys)) {
    const corners = restrictions.length && is3D() ? reducedSimplexPoints() : [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const p of corners) acc(p);
  }
  return any ? [0, 1, 2].map((i) => niceRange(lo[i], hi[i])) : null;
}
// showspikes:false — the hover projection spikes have a WebGL rendering artifact in Safari (a white
// gap that only clears on camera move). nticks/tickfont thin the numbers so they don't crowd the title.
// `def` is the data-driven default range; a user-set limit (axisLimits, keyed by axis key) overrides
// either bound. Pass '' for a collapsed/hidden axis with no UI limit control (the depth axis in the
// locked-projection scene) to skip the axisLimits lookup entirely.
const sceneAxis = (key, def, extra) => ({ title: { text: axisLabel(key) }, range: (key ? axisRange(key, def[0], def[1]) : null) || def,
  zeroline: false, showspikes: false, nticks: 6, tickfont: { size: 10 }, ...(extra || {}) });
// Merges the old draw3D (dims===3) and draw2Dproj (dims===2, restrictions.length===0 — the
// "everything is a projection" case that keeps the locked-orthographic-camera rendering strategy,
// see the `dims` state-model comment above) into one function: both are gl3d scenes differing only
// in camera/aspect/dragmode and (once restrictions enter the picture) whether the raw or reduced
// geometry is drawn.
function drawScene3D() {
  viewAxes = is3D() ? axes : [axes[0], axes[1], projDepth(axes[0], axes[1])];
  const cellsCache = new Map();   // shared with dataBounds3D so each sheet is cut at most once here
  const bb = dataBounds3D(cellsCache) || [[0, 1], [0, 1], [0, 1]];
  const traces = restrictions.length ? reducedTraces3D(cellsCache) : build3DTraces();
  const scene = is3D()
    ? {
        xaxis: sceneAxis(viewAxes[0], bb[0]), yaxis: sceneAxis(viewAxes[1], bb[1]), zaxis: sceneAxis(viewAxes[2], bb[2]),
        aspectmode: 'cube', dragmode: 'orbit',
        // Re-centre only on a fresh scene / axis change / restriction change; on a plain toggle pass
        // the *current* camera straight back so the view never moves. (uirevision proved unreliable here.)
        camera: needCenter ? defaultCamera() : camNow(),
      }
    : {
        xaxis: sceneAxis(viewAxes[0], bb[0]), yaxis: sceneAxis(viewAxes[1], bb[1]),
        zaxis: sceneAxis('', bb[2], { showticklabels: false, title: { text: '' } }), // depth — collapsed, hidden
        aspectmode: 'data', dragmode: 'pan',   // data → true in-plane aspect; pan only (no rotate)
        camera: (needCenter2D0 || !lastCam2D0) ? projCamera() : lastCam2D0,
      };
  Plotly.react('plot', traces, {
    margin: { l: 0, r: 0, t: 0, b: 0 },
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    scene, showlegend: false,
  }, { responsive: true, displayModeBar: false }).then(bindTip);
  if (is3D()) {
    if (needCenter) lastCam = null;   // just centered → drop stale camera; relayout will repopulate it
    needCenter = false;               // subsequent toggles keep the user's camera
  } else {
    if (needCenter2D0) lastCam2D0 = null;   // just re-locked → relayout repopulates from the live camera
    needCenter2D0 = false;
  }
}

// Every axis is linear in the free coordinates, so each level set (restriction) is a hyperplane and
// the intersections are exact regardless of how many free coordinates a point has (3 at m=3, 10 at
// m=4) — see reduceCell/applyRestrictions/reduceGeometry above, which generalize a single-plane cut
// to zero or more. Componentwise linear interpolation between two same-length points — the one
// piece of geometry every reduction step needs, generalized once instead of hardcoded per index.
const lerpPoint = (a, b, t) => a.map((x, i) => x + t * (b[i] - x));
// ---- grid-aware slicing: interpolate the producer's iso-axis cross-section rows ----
// `sliceRows` carries, per axis, rows already lying on axis = vals[i] (the producer inverted the
// parameterization). Bracketing `c` in `vals` and interpolating the two rows by normalized position
// reconstructs the exact cross-section without cutting any triangle diagonal — so the slice is clean
// even on steep surfaces (rise/plateau), where triangle-slicing the mesh produces a sawtooth.
function sampleRow(row, f) { // f in [0,1] → point along the row by fractional index
  if (row.length === 1) return row[0];
  const x = f * (row.length - 1), i = Math.min(row.length - 2, Math.floor(x)), u = x - i;
  return lerpPoint(row[i], row[i + 1], u);
}
function sliceRowSection(sr, c) { // {axis,vals,rows} → ordered N-coordinate polyline at axis = c, or null
  const { vals, rows } = sr, n = vals.length;
  if (n < 2 || c < vals[0] - 1e-9 || c > vals[n - 1] + 1e-9) return null; // surface absent at this slice
  let i = 0;
  while (i < n - 2 && vals[i + 1] <= c) i++;
  const t = Math.max(0, Math.min(1, (c - vals[i]) / Math.max(vals[i + 1] - vals[i], 1e-12)));
  const r0 = rows[i], r1 = rows[i + 1], M = Math.max(r0.length, r1.length), out = [];
  for (let k = 0; k < M; k++) {
    const f = M > 1 ? k / (M - 1) : 0;
    out.push(lerpPoint(sampleRow(r0, f), sampleRow(r1, f), t));
  }
  return out;
}

// ---- N-restriction geometry reduction ----
// Generalizes sliceMesh/slicePolyline from exactly one hyperplane cut to zero or more, applied in
// sequence. A "cell" is an array of {pt, prm} corners: a mesh triangle (arity 3, every producer mesh
// is already triangulated — `faces`/`facesSelf` are always length-3), a curve segment (arity 2), or
// a single point (arity 1, from a `points`-kind sheet). Each restriction cuts a cell's arity by one:
// triangle -> segment (2 edge crossings), segment -> point (1 crossing); arity-1 has nowhere lower
// to interpolate to, so a restriction there is an equality filter instead (keep the point iff it
// already lies on the hyperplane, within tolerance).
function meshCells(g) {
  const faces = g.facesSelf && g.facesSelf.length ? g.faces.concat(g.facesSelf) : g.faces;
  return faces.map((f) => f.map((i) => ({ pt: g.vertices[i], prm: g.params ? g.params[i] : null })));
}
function curveCells(g) {
  const cells = [];
  for (let n = 0; n < g.points.length - 1; n++) {
    if (g.points[n] == null || g.points[n + 1] == null) continue; // multi-segment null separator
    cells.push([0, 1].map((k) => ({ pt: g.points[n + k], prm: g.params ? [g.params[n + k]] : null })));
  }
  return cells;
}
function pointCells(g) {
  return g.points.filter((p) => p != null).map((p) => [{ pt: p, prm: null }]);
}
// Equality tolerance for an arity-1 (already-a-point) cell under a restriction — shared with
// drawFlat2D's discrete-`points`-sheet filter so the same restriction picks up the same points
// regardless of dims (a `points`-kind sheet's arity-1 cells only ever go through this branch).
const RESTRICTION_POINT_EPS = 1e-3;
// Cut one cell by one restriction {axis, value}. Returns the reduced cell (one arity lower), or
// null if the restriction doesn't cross it (mesh/curve) or doesn't match it (a point). `prm`
// composes correctly across repeated calls: each step's prm is a linear interpolation of the
// previous step's already-interpolated prm, and linear interpolation composes linearly.
function reduceCell(cell, restriction) {
  const { axis, value } = restriction;
  if (cell.length === 1) {
    const v = axisVal(cell[0].pt, axis);
    return (v != null && Math.abs(v - value) < RESTRICTION_POINT_EPS) ? cell : null;
  }
  const s = cell.map((r) => { const v = axisVal(r.pt, axis); return v == null ? null : v - value; });
  if (s.some((x) => x == null)) return null;
  const edges = cell.length === 3 ? [[0, 1], [1, 2], [2, 0]] : [[0, 1]];
  const cross = [];
  for (const [a, b] of edges) {
    if ((s[a] < 0) !== (s[b] < 0) && s[a] !== s[b]) {
      const t = s[a] / (s[a] - s[b]);
      cross.push({
        pt: lerpPoint(cell[a].pt, cell[b].pt, t),
        prm: (cell[a].prm && cell[b].prm) ? lerpPoint(cell[a].prm, cell[b].prm, t) : null,
      });
    }
  }
  const want = cell.length === 3 ? 2 : 1; // triangle -> segment needs 2 crossings; segment -> point needs 1
  return cross.length === want ? cross : null;
}
// Fold every restriction over a cell list in order; a cell dropped by any step never returns.
function applyRestrictions(cells, restrictions) {
  let cur = cells;
  for (const r of restrictions) cur = cur.map((c) => reduceCell(c, r)).filter(Boolean);
  return cur;
}
// Reduce one sheet's geometry by `restrictions`. Uses the producer's precomputed `sliceRows` (if
// present and the first restriction's axis matches one) as a grid-aware fast path for restriction
// #1 only — avoids the triangle-diagonal sawtooth on steep surfaces (rise/plateau), exactly like
// `sliceRowSection` always has; restriction #2+ always runs through the generic reducer above
// regardless of which path produced restriction #1's cells, so there is never a mix of strategies
// within a single restriction step.
function reduceGeometry(sheet, restrictions) {
  const g = sheet.geometry;
  let cells = g.kind === 'mesh' ? meshCells(g) : g.kind === 'polyline' ? curveCells(g) : pointCells(g);
  let rest = restrictions;
  if (g.kind === 'mesh' && restrictions.length && g.sliceRows) {
    const sr = g.sliceRows.find((r) => r.axis === restrictions[0].axis);
    if (sr) {
      const sec = sliceRowSection(sr, restrictions[0].value);
      cells = sec ? Array.from({ length: sec.length - 1 }, (_, i) => [{ pt: sec[i], prm: null }, { pt: sec[i + 1], prm: null }]) : [];
      rest = restrictions.slice(1);
    }
  }
  return applyRestrictions(cells, rest);
}

// Cross-section of the probability simplex (tetrahedron) at g = c → feasible-polygon frame (used
// for exactly 1 restriction; see reducedSimplexPoints for 2+). Like `simplexWire`, the caller gates
// on `simplexAxesOk` first, so `g` (built from axes[0]/axes[1]/the restriction's axis) is guaranteed
// to read only the m=3 group and bare 3-wide corners suffice.
function sliceSimplex(c, g) {
  const V = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const E = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  const pts = [];
  for (const [a, b] of E) {
    const da = g(V[a]), db = g(V[b]);
    if ((da - c) * (db - c) < 0) {
      const t = (c - da) / (db - da);
      pts.push([
        V[a][0] + t * (V[b][0] - V[a][0]),
        V[a][1] + t * (V[b][1] - V[a][1]),
        V[a][2] + t * (V[b][2] - V[a][2]),
      ]);
    }
  }
  return pts;
}
// Flat 2D (dims===2, restrictions.length >= 1 — always true here, `draw()` routes the 0-restriction
// case to drawScene3D's locked-orthographic strategy instead). A restriction always cuts geometry to
// arity <= 2, so a plain 2D scatter/lines plot renders it exactly, no fold/occlusion problem left.
function drawFlat2D() {
  const px = (p) => axisVal(p, axes[0]), py = (p) => axisVal(p, axes[1]);
  const traces = [];
  const allAxisKeys = [...new Set([...axes, ...restrictions.map((r) => r.axis)])];

  // feasible-polygon / point frame (the flat d_i=0 faces, restricted) — the simplex reference
  if (enabled.simplex && simplexAxesOk(allAxisKeys)) {
    if (restrictions.length === 1) {
      let frame = sliceSimplex(restrictions[0].value, (p) => axisVal(p, restrictions[0].axis)).map((p) => [px(p), py(p)]);
      if (frame.length >= 3) {
        const cx = frame.reduce((a, q) => a + q[0], 0) / frame.length;
        const cy = frame.reduce((a, q) => a + q[1], 0) / frame.length;
        frame.sort((u, v) => Math.atan2(u[1] - cy, u[0] - cx) - Math.atan2(v[1] - cy, v[0] - cx));
        frame.push(frame[0]);
        traces.push({ type: 'scatter', mode: 'lines', x: frame.map((q) => q[0]), y: frame.map((q) => q[1]),
          line: { color: SIMPLEX_COLOR, width: 1 }, fill: 'toself', fillcolor: 'rgba(0,0,0,0.03)', hoverinfo: 'skip', showlegend: false });
      }
    } else {   // 2+ restrictions: whatever (generically sparse) points also satisfy every further one
      const pts = reducedSimplexPoints().map((p) => [px(p), py(p)]);
      if (pts.length) traces.push({ type: 'scatter', mode: 'markers', x: pts.map((q) => q[0]), y: pts.map((q) => q[1]),
        marker: { size: 4, color: SIMPLEX_COLOR }, hoverinfo: 'skip', showlegend: false });
    }
  }

  for (const s of renderSheets()) {
    if (!sheetSupportsAxes(s, allAxisKeys)) continue;   // no data for one of this view's axes
    const g = s.geometry;
    if (g.kind === 'mesh' || g.kind === 'polyline') {
      // reduceGeometry takes the grid-aware fast path (no triangle-diagonal sawtooth) for a mesh's
      // first restriction when the producer shipped iso-axis rows for that axis; every further
      // restriction (and every curve restriction) goes through the generic reducer.
      const cells = reduceGeometry(s, restrictions);
      if (!cells.length) continue;
      if (cells[0].length === 2) {
        const X = [], Y = [], CD = [];
        for (const cell of cells) {
          X.push(px(cell[0].pt), px(cell[1].pt), null);
          Y.push(py(cell[0].pt), py(cell[1].pt), null);
          CD.push(densCustom(cell[0].pt, cell[0].prm), densCustom(cell[1].pt, cell[1].prm), null);
        }
        // A restriction near a pinch (e.g. rise/plateau at a scallop cusp) can reduce a whole sheet
        // to one on-screen segment a fraction of a pixel long — a real feature, invisible at default
        // zoom rather than "dropped". `lines+markers` guarantees every point keeps a fixed-size dot
        // regardless of screen-space segment length, so nothing vanishes below the pixel grid.
        traces.push({ type: 'scatter', mode: 'lines+markers', name: s.id, x: X, y: Y, customdata: CD,
          line: { color: s._color, width: 2 }, marker: { color: s._color, size: 3 },
          opacity: (s._isCo && complementMode !== 'show') ? 0.5 : 1, hoverinfo: 'none', _tip: tipMeta(s), showlegend: false });
      } else {
        traces.push({ type: 'scatter', mode: 'markers', name: s.id,
          x: cells.map((c) => px(c[0].pt)), y: cells.map((c) => py(c[0].pt)),
          customdata: cells.map((c) => densCustom(c[0].pt, c[0].prm)), hoverinfo: 'none', _tip: tipMeta(s),
          marker: { color: s._color, size: 7, opacity: s._isCo ? 0.55 : 1 }, showlegend: false });
      }
    } else if (g.kind === 'points') {
      // discrete sample points: keep those satisfying every restriction (equality filter each)
      const on = g.points.filter((p) => p != null && restrictions.every((r) => {
        const v = axisVal(p, r.axis); return v != null && Math.abs(v - r.value) < RESTRICTION_POINT_EPS;
      }));
      if (on.length) traces.push({ type: 'scatter', mode: 'markers', name: s.id,
        x: on.map((p) => px(p)), y: on.map((p) => py(p)),
        customdata: on.map((p) => densCustom(p, null)), hoverinfo: 'none', _tip: tipMeta(s),
        marker: { color: s._color, size: s.markerSize || 3.5, symbol: s.markerSymbol || 'x', opacity: s._isCo ? 0.4 : 1 }, showlegend: false });
    }
  }

  // Explicit per-axis limits override the auto extent. Only drop the equal-aspect scaleanchor when
  // the user's explicit ranges are themselves asymmetric (different spans) — honouring that request
  // takes priority. Equal-span ranges (e.g. both set to [0,1]) have nothing to conflict with, so
  // scaleanchor stays on and the plot stays square, same as when no limits are set at all.
  const sv = view2d[flatKey()] || {};   // restored pan/zoom for this axis pair (explicit limits take precedence)
  const rx = axisRange(axes[0], 0, 1) || sv.x || null, ry = axisRange(axes[1], 0, 1) || sv.y || null;
  const rxSpan = rx ? rx[1] - rx[0] : null, rySpan = ry ? ry[1] - ry[0] : null;
  const dropScaleanchor = rxSpan != null && rySpan != null && Math.abs(rxSpan - rySpan) > 1e-9;
  Plotly.react('plot', traces, {
    margin: { l: 62, r: 16, t: 10, b: 54 },
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    uirevision: flatKey() + '|' + limKey(axes[0]) + '|' + limKey(axes[1]),   // axis/limit change resets the view; pan/zoom otherwise preserved
    dragmode: 'pan',       // drag pans (scroll zooms via scrollZoom) — aligns with the 3D view
    xaxis: { title: { text: axisLabel(axes[0]), standoff: 16 }, zeroline: false, ...(rx ? { range: rx } : {}) },
    yaxis: { title: { text: axisLabel(axes[1]), standoff: 18 }, zeroline: false, ...(ry ? { range: ry } : {}), ...(dropScaleanchor ? {} : { scaleanchor: 'x' }) },
    showlegend: false,
  }, { responsive: true, displayModeBar: false, scrollZoom: true }).then(bindTip);
}

renderRenderControls();   // independent of the manifest fetch — visible immediately, no loading flash
load();

// Deployed commit, so "is this fix actually live yet" is never a guessing game across the preview
// vs. production vs. a stale browser/CDN cache — window.BUILD_COMMIT comes from version.js, which
// only exists in a CI-built deploy (see .gitlab-ci.yml); absent in local dev, where this just stays
// hidden rather than showing a misleading placeholder.
if (window.BUILD_COMMIT) {
  const bv = document.getElementById('build-version');
  if (bv) {
    bv.textContent = window.BUILD_COMMIT;
    bv.href = window.BUILD_COMMIT_URL || '#';
    bv.style.display = 'block';
  }
}
