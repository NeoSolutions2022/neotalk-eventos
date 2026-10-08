# Live handoff latency and mini-player controls

The first prefetch implementation stopped at the API task result. Unity still
downloaded each pose at the playback handoff. The updated widget also downloads
the immutable bytes; the platform warms both translated lookahead entries and
the mirrored player. The new external command is capability-gated so an older
widget remains usable during rollout.

Under pressure, the platform previously merged up to 36 source words into one
animation job. The full-clip Unity preparation then delayed long phrases badly
in a real software-rendered pitch test. Jobs now stay within the normal twelve
word ceiling. Capacity remains bounded to the previous 864-word maximum, using
72 shorter slots rather than 24 potentially large ones; translation concurrency
stays at two. Spoken order and actual terminal-frame completion are preserved.

Loop entry counts silence already elapsed while the last phrase played. The
previous default imposed a new 2200 ms wait after completion, even after long
silence. The remaining silence window and the existing 120 ms handoff now apply.

Opening an external player starts an inactive room when capture is available.
The player contains a start/end button that uses the latest controller closure,
reflects startup state, and retains the existing microphone permission flow.
Closing the output still only closes that output.

## Measured and checked

- Real Elia .27 A/B, same clips and runtime, 1200 ms controlled pose download:
  median terminal-frame-to-next-start 3641.6 ms -> 2671.5 ms (26.6% lower),
  three transitions per version, all terminal frames reached. Workspace evidence
  `outputs/latency-ab.json`, harness `tmp/latency-ab.cjs`.
- Platform build passed; 78 platform tests cover queue bounds, cancellation,
  actual component orchestration, retries, both output generations, loop silence,
  and five virtual minutes at 140/180/220 wpm with no capture pause. Virtual
  timing is explicitly synthetic and does not certify rendering throughput.
- Widget unit tests cover bounded byte cache, download deduplication, actual
  cached URL loading, optional failure fallback and in-flight eviction protection.

Real integrated pitch PASS: `outputs/pitch-soak-1791426880535/ledger.json`.
Sixty seconds / 180 input words completed as 17 ordered batches, each at most
twelve source words. Both real .27 Unity players reached every terminal frame;
neither reinitialized. Injected translation 502, pose-submit 502 and heartbeat
503 recovered, without an overload warning or an uncaught browser exception.
Opening the mini-player started capture; its stop/start controls passed.
This run used controlled ASR/API and a software-rendered browser. Drain took
606782 ms; median native handoff gap was 32094 ms (maximum 40889 ms) for the
longer generated poses. This exposes a serious remaining native preparation
bottleneck, not an acceptable production latency certification. The short-clip
A/B improvement must not be extrapolated to this workload. The final 120 ms
idle-loop change and in-flight cache eviction protection were unit-tested
after this browser run began, rather than being certified by this run.

The initial long-job run was interrupted for latency investigation,
not approved as a completed stability test. Tests use original poses and the
actual React/widget/Unity implementations with controlled ASR/API doubles.
Software rendering is slower than many physical GPUs; no production SLA,
one-hour reliability guarantee, or physical microphone/mobile certification.

## Follow-up: .28 native preparation, 08 October

Unity's pole optimizer now skips paths with infinite cost and inadmissible edges,
without reducing the 49-candidate graph or changing the valid path arithmetic.
Seven real archived sequences / 1123 frames / three repetitions and 100 seeded
adversarial sequences produced bit-identical plans; cancellation and malformed
input rejection remained intact. Build exit 0, protected scene/profile/source
hashes preserved. The existing exported .27 remained untouched.

Eight same-input .27/.28 WebGL cases all improved preparation by 19.6%–43.5%.
The six-sign case fell from 26512.9 to 15957 ms; execution time was essentially
unchanged and every case reached the real terminal frame. Browser evidence:
`outputs/solver-browser-ab.json`. This is controlled local API / SwiftShader,
not an estimate of production latency or acceleration of the gesture itself.

Integrated .28 PASS: `outputs/pitch-soak-1791429770592/ledger.json`. Twenty
distinct texts / 180 words / 17 completed ordered batches, two actual players,
no runtime reset, no lost text, no uncaught browser exception, all terminal
frames reached. Translation 502/429, pose submission 502, and heartbeat 503 were
injected and recovered. Mini-player auto-start and stop/restart controls passed.
Drain took 444260 ms; median native handoff was 18322 ms, maximum 33729 ms.
This is still a significant delay on the software renderer. The prior pitch
used a different six-text set, so its timing is NOT a same-corpus A/B; only the
eight same-input cases support the comparative percentage above.

An additional orchestration test ran 100 distinct natural texts / 840 words at
220 words/min in virtual time: all text persisted and drained, maxQueue 28, no
capture pause/reset/overload notice. The simulated playback timing is not Unity
rendering or real ASR. The 20-text browser run uses deterministic keyword
translation, not linguistic GPT quality certification or a physical microphone.

The .28 binary is prepared in the separate Avatar3DFrontend checkout. No push
or deploy. The offline experiment remains outside this changeset. The evidence
approves a comparative improvement for these cases, not zero failure forever,
one-hour device coverage, or ideal end-to-end latency for all long phrases.
