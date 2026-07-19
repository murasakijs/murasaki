# Fidelity ledger

Compared at 1536×960 with `overview-concept.png` and `overview-implementation.png`, then checked at
1180×820 and 760×800.

| Comparison point | Concept evidence | Render evidence | Result |
| --- | --- | --- | --- |
| Shell | Navy global rail, white module sidebar, canvas, right detail | Same four-region desktop composition | Matched |
| Information hierarchy | Compact header, workflow, KPI strip, chart/table, record detail | Same order and first-viewport balance | Matched |
| Palette | True white, cool gray, navy, semantic module accents | Locked tokens and active module colors | Matched |
| Container model | Flat panels, tables and rails; almost no shadow | One-pixel borders, 8px radius, no card mosaic | Matched |
| Workflow | Customer → opportunity → order → allocation → revenue | Five interactive, linked semantic-color stages | Matched |
| Typography | Dense Japanese business UI with tabular values | System Japanese stack, explicit chrome/body/number sizes | Matched |
| Right panel | Persistent order detail and timeline | Live selected-record detail with actionable allocation state | Matched |
| Responsive behavior | Practical small-laptop continuation | 1180px drawer/overlay mode has no body overflow; 760px toolbar mode has no body overflow | Matched |

Above-the-fold copy diff: all required strings from `SPEC.md` are present on the overview; implementation
adds only live record values, accessibility labels, the explicit stock warning, and version metadata.

Intentional differences: the concept contains denser fictional counts and extra decorative chart lines.
The implementation shows the smaller explicit seed dataset and code-native bars so every displayed record
can participate in the working vertical slice. No material layout, color, asset, or interaction mismatch
remains.
