# Murasaki glib patch

This directory vendors `glib` 0.18.5 from crates.io because the current Tao
and Wry Linux backends still depend on the unmaintained GTK3 `gtk` 0.18 line.
That line cannot select the upstream patched `glib` 0.20 release without a
breaking GTK stack migration.

Murasaki backports the upstream fix for
[GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g):

- make the `VariantStrIter::impl_get` output pointer mutable;
- pass `&mut p` to `g_variant_get_child` instead of writing through `&p`.

No other source behavior is changed.
