# Dependency security check

On 2026-11-22, `pnpm audit` initially reported 11 advisories in the dependency tree (5 high, 1 moderate, and 5 low). The affected packages were updated or constrained to patched versions. A subsequent full `pnpm audit` completed with **No known vulnerabilities found**.

The direct `sharp` dependency is pinned to 0.35.5. `pnpm-workspace.yaml` constrains the affected transitive dependencies to `happy-dom` 21.0.4, `dompurify` 3.4.17, and `esbuild` 0.25.12 for vulnerable older versions.

Advisories addressed:

- `sharp`: [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
- `happy-dom`: [GHSA-834v-8h66-3h79](https://github.com/advisories/GHSA-834v-8h66-3h79), [GHSA-c8p4-j97h-3vg8](https://github.com/advisories/GHSA-c8p4-j97h-3vg8)
- `esbuild`: [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
- `dompurify`: [GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p), [GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2), [GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f), [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7), [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr)

An audit is a point-in-time check, not a guarantee that future dependency releases will remain vulnerability-free. Run `pnpm audit` again as dependencies change.
