# Main-only development and preserved branch history

The repository owner requested that work go directly to `main` and temporary
branches be removed. The application release at `9e796828` already contains the
completed demo, ElevenLabs narration, Admin publication controls, rootless VPS
support and content corrections.

The consolidation commit preserves every audited branch tip in `main`'s Git
ancestry, including superseded implementations. It keeps the current application
tree: obsolete empty-class demo seeders are historical code, not active scripts.
The two previously branch-only VPS preflight workflows are retained on `main`,
with manual triggers, a disabled deployment gate and explicit image identity.

| Audited branch | Preserved head | Integration evidence |
| --- | --- | --- |
| `ccr-61fb71f1-s7zqvh` | `01651e59c6ce25a9fc8b0fdb6b2c07fdeee918ea` | Already an ancestor of the application release |
| `codex/admin-content-approval` | `552bf67834b9fd652a34bbde4b302f3e509e6a59` | Superseded PR119 implementation integrated by PR121 |
| `codex/automatic-content-narration` | `80df38366865e4b836f876e7ce4b386d476e8f6f` | Superseded PR118 implementation integrated by PR121 |
| `codex/connected-four-role-demo` | `9bd56cc225788d1c38c4fe45663e7009cfc5a836` | PR115 empty-class approach superseded by PR116's additive repair |
| `codex/content-review-corrections` | `3fb18edc907d5cb3fad97ecbd87765ba8df1e0d2` | PR122 merged |
| `codex/demo-polish-fixes` | `79ac8db16358cd096b32acb40fd3838dd50f45d0` | PR116 squash has the same tree |
| `codex/elevenlabs-demo-voices` | `4a292c6b596e284a5cdf36b1b1dbe4e54b660a8b` | PR117 merged |
| `codex/final-client-release` | `7d81fcb7b31aa731b7f5a4b26d68de808bc95cdc` | PR121 merged |
| `codex/rootless-vps-deployment` | `055f8f15b3644547fbeda1cee0bb97cb0ac1d12f` | PR120 merged |
| `codex/vps-ssh-preflight-20261105` | `78b514192b9b9a218d3d55963ccf1fff487c42b6` | Both preflight workflows included in consolidation |

The narrowly scoped cleanup workflow removes only these exact audited refs after
checking that their heads are in `main`. It refuses moved, unmerged, protected or
unexpected refs, preserves `main`, and uses an atomic push with per-ref leases.
The workflow's result and the repository's branch list provide deletion status.
No application deployment to the client VPS is enabled by this consolidation.
