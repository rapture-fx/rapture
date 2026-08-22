# Rapture research method

## Question and variables

Rapture asks whether useful autonomous engineering throughput scales with worker count. Worker count is
the primary independent variable. The dependent measurements are accepted tasks per hour, speedup,
parallel efficiency, task latency, validation failures, integration failures, duplicated observable
commands, and available provider usage/cost.

A comparison should hold constant the repository commit and tree, task set, agent provider/model/version,
agent command, validation commands, environment, budget, and seed where a provider exposes one. Rapture
records these controls in the manifest and raw events. Results from different environment fingerprints
should not be pooled without an explicit warning and a separate analysis.

## Workload and worker-count method

Select deterministic, independently useful tasks that can start from the same base commit. Run the same
task set at each worker count, conventionally 1, 2, and 4 before considering 8. Repeated trials are a
first-class experiment field: each worker-count/repetition pair is a distinct trial with a stable
`trialId`. A root seed is persisted; each repetition derives a trial seed and a deterministic task
order. Matching repetitions at different worker counts receive that same order. Each task attempt
receives its own detached Git worktree. Worker-count matrices run sequentially so their local resource
contention does not overlap; tasks within a matrix use bounded concurrency.

Task selection must not be tailored after seeing results. Record exclusions, retries, warm caches, and
failed trajectories. Small fake-agent fixtures prove instrumentation and formula behavior only. They do
not estimate real-agent performance.

## Success and integration

An agent process exit code or textual claim is not success. A task is individually accepted only when all
configured deterministic validation commands pass. If integration is enabled, Rapture applies accepted
patches in deterministic task order and runs explicit post-integration validation. A failed or conflicting
integration makes accepted throughput zero for that worker-count matrix while retaining the individual
validation evidence.

Useful engineering throughput is accepted tasks divided by trial wall-clock hours. Trials are not
merged before aggregation:

`T_i(N) = accepted tasks in trial i at N workers / elapsed wall-clock hours of that trial`

`T(N) = median_i T_i(N)`

Speedup and parallel efficiency are:

`S(N) = T(N) / T(1)`

`E(N) = T(N) / (N * T(1))`

Paired per-repetition ratios `T_i(N) / T_i(1)` are also reported. Zero-duration and missing one-worker
baselines produce `null`, not fabricated values. Missing token or provider-cost evidence also remains
`null`. Three repetitions are an early variance probe, not a basis for statistical significance.

Phase timings use monotonic clocks. Wall-clock timestamps remain for audit. Serialized worktree
create/remove time is Rapture overhead, not agent execution. Because tasks in a trial may overlap,
the sum of per-task phase durations is not required to equal trial wall time. Incomplete phases stay
`null` and are omitted from medians.

## Evidence and reproducibility

`events.jsonl` is append-only and fsynced per event. Reports parse that persisted log and do not depend on
mutable in-memory counters. Wall-clock timestamps establish ordering and experiment windows; monotonic
timers measure process and task durations. Manifests capture repository/task hashes, tool versions, Node,
operating system, CPU count, adapter version, worker counts, and reproduction arguments. Raw stdout and
stderr are stored separately with practical secret-pattern redaction.

Partial experiments are evidence, not successful comparisons. Their status remains `failed`,
`interrupted`, or `incomplete`, and analysis must not silently treat missing tasks as failures or successes.

## Known confounders

- provider nondeterminism, model updates, rate limits, and cache state
- task difficulty imbalance and task-order effects
- local CPU, memory, disk, and network contention
- validation suites with incomplete behavioral coverage
- agent access to repository-external state
- warm package, compiler, or test caches
- small samples and very short fixture durations
- duplicated repository exploration that an adapter cannot expose
- human intervention not yet captured reliably in V0

Repeated trials and seeded task ordering are now part of the experiment contract. Provider/model identity
and environment must be pinned as tightly as practical. Raw session, PR, or patch counts are not useful
throughput because they ignore independent validation and composition. Fake-agent fixture results validate
instrumentation only; they are not evidence about real coding-agent scaling.

## Future changeability research

Long-horizon changeability is deliberately outside V0. A later experiment would compare functionally
equivalent implementations at the same checkpoint by giving fresh agents identical subsequent tasks and
budgets, then measuring success rate, latency, tokens, changed files, repair attempts, and regressions.
That executable longitudinal probe differs from static maintainability scoring: it measures the cost of a
real future change rather than assigning a code-smell composite. It should be built only after the scaling
profiler is stable and only if longitudinal evidence adds signal beyond cheap static metrics.
