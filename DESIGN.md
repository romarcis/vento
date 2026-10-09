# Design

Dark, warm-graphite appliance UI in the spirit of a Braun/Olivetti catalog: matte, flat, hairline scales, tiny radii. Operate mode.

- **Ground:** `#1a1917` graphite, panels `#22211e`/`#2b2926`, lines `#3b3833`. Text `#ece7dc`, secondary `#aaa395`.
- **Signal orange `#ff6a1a`:** only for things the user authors or selects (draft curve, selected fan, selected point, primary action). State colours: ok `#86c77e`, warn `#f2c23a`, crit `#ff5646`, used only for meaning.
- **Type:** Archivo variable (width axis), bundled in `src/fonts`. Condensed uppercase 11px legends, normal-width tabular numerals for readouts (26px sensors, 22px RPM).
- **Shape:** 3px radius, 1px hairlines, no shadows, no gradients except the functional 10% tick scale under each sensor.
- **Signature move:** the live operating point rides the draft/applied curve with a vertical hairline, a label, and a 60 s range band; the applied curve stays as a dashed ghost under the orange draft.
- **Layout:** header, six-cell sensor strip, fan rail (252px), curve editor with point inputs beneath, footer.
- **Motion:** 150ms ease-out on hover; sensor bars ease 600ms; reduced-motion disables all.
