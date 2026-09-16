# AGENTS.md

## Scope

These instructions apply to all coding tasks in this repository, with special emphasis on:

- debugging
- bug fixes
- runtime investigation
- reliability changes
- compatibility changes
- refactoring performed during bug fixing

The primary goals are:

1. Find and fix demonstrated root causes rather than masking symptoms.
2. Keep bug-fix diffs small and causally justified.
3. Do not accumulate speculative "stability" code.
4. Do not preserve backward compatibility unless a real compatibility requirement exists.
5. Remove failed experiments instead of allowing them to become permanent complexity.

---

# 1. Evidence Before Modification

For a bug report, do not immediately modify production code.

First determine, as far as reasonably possible:

- What is actually happening?
- What should happen instead?
- How can the problem be reproduced?
- Is the problem deterministic or intermittent?
- What evidence distinguishes working and failing cases?

Use available observation mechanisms when appropriate:

- automated tests
- browser/runtime inspection
- screenshots
- console output
- network traces
- application logs
- debugger
- state inspection
- database inspection
- minimal reproduction
- instrumentation

If the user's description is incomplete or imprecise, do not silently invent a more specific bug.

Instead, investigate the actual behavior.

A user's observable symptom is evidence even when the user cannot describe the underlying technical mechanism.

---

# 2. Root Cause Before Fix

The default debugging sequence is:

```text
Observed symptom
→ Reproduction
→ Evidence
→ Hypothesis
→ Experiment
→ Root cause
→ Minimal fix
→ Verification
```

Avoid:

```text
Observed symptom
→ Guess
→ Large code change
→ Hope
```

Do not treat plausible explanations as established causes.

Statements such as:

- "this may be a race condition"
- "this could improve stability"
- "this is probably caused by timing"
- "this might prevent stale state"

are hypotheses, not evidence.

Test them before building permanent code around them.

---

# 3. One Main Hypothesis Per Experiment

When practical, test one major hypothesis at a time.

Avoid changing several independent mechanisms simultaneously, for example:

```text
add retry
+ add timeout
+ change caching
+ change state initialization
+ add fallback
+ refactor component
```

If the bug disappears after such a change, the actual cause becomes unclear.

Prefer:

```text
Hypothesis A
→ minimal experiment
→ result

Hypothesis B
→ minimal experiment
→ result
```

Multiple edits are acceptable when they form one inseparable causal fix.

---

# 4. Every Production Change Needs a Causal Justification

Before making a bug-fix change, be able to answer:

> Which observed fact does this change address?

Good justification:

> The failing request is sent before authentication state is restored; the trace consistently shows an unauthorized request during initialization. This change moves that request after authentication restoration.

Weak justification:

> This should make initialization more robust.

Weak justification is not sufficient.

If a change cannot be connected to observed evidence or a confirmed requirement, do not add it.

---

# 5. Prefer the Minimal Causal Diff

A bug fix should normally be the smallest reasonable change that directly addresses the demonstrated cause.

During a bug fix, do not automatically:

- refactor neighboring modules
- introduce a new abstraction
- replace libraries
- rename unrelated APIs
- redesign architecture
- change state-management strategy
- optimize unrelated code
- clean up unrelated style
- introduce a generic framework

unless the change is necessary to fix the demonstrated root cause.

A small understandable fix is preferred over a broad theoretically elegant rewrite.

---

# 6. Failed Fixes Must Be Reverted by Default

This is a hard rule.

If a change was introduced specifically to fix Bug A, and Bug A still reproduces after the change:

> Treat that change as a failed experiment.

By default, revert the change before trying a substantially different hypothesis.

Do not keep it merely because it:

- "improves robustness"
- "improves stability"
- "is safer"
- "may help in edge cases"
- "future-proofs the code"
- "is generally good practice"

A failed bug fix has no independent value unless that value is separately demonstrated.

Exceptions are allowed only when:

1. the user explicitly asks to keep it;
2. it fixes another independently demonstrated problem;
3. it is temporary instrumentation still required for the investigation.

If an exception applies, state why the change is being retained.

---

# 7. Only Revert Agent-Introduced Changes

The previous rule does not authorize destructive repository rollback.

Never discard unrelated user work.

Do not use destructive commands such as:

```text
git reset --hard
```

to remove a failed experiment unless the user explicitly authorizes it and the repository state is fully understood.

When reverting a failed experiment:

- identify the exact diff introduced for that experiment;
- revert only that diff;
- preserve unrelated working-tree changes;
- preserve changes made by the user or other agents.

---

# 8. No Speculative Stability Engineering

Do not add reliability mechanisms without evidence that the current system requires them.

Examples include:

- retries
- arbitrary delays
- extra timeouts
- polling loops
- duplicate state
- fallback implementations
- catch-all exception swallowing
- synchronization layers
- redundant validation
- caches
- watchdog logic
- recovery paths
- extra state machines

Each mechanism adds behavior and increases the system's state space.

For example, do not turn:

```text
request
→ result
```

into:

```text
request
→ retry
→ timeout
→ fallback
→ recovery
→ cached fallback
```

unless actual requirements or observed failure modes justify those mechanisms.

Do not mask a deterministic bug with retry logic.

Do not mask a race condition with arbitrary sleep/delay values.

Do not mask incorrect state transitions with additional fallback states.

Fix the cause when possible.

---

# 9. Instrumentation Is Not the Fix

Temporary diagnostic code is allowed and encouraged when necessary.

Examples:

- logs
- counters
- assertions
- trace IDs
- temporary UI markers
- timing measurements

However:

> Diagnostic instrumentation must not quietly become production architecture.

Once the investigation is complete:

- remove temporary instrumentation that is no longer needed;
- retain only instrumentation that has a clear ongoing operational value.

---

# 10. Intermittent Bugs Require Observation, Not Immediate Retries

When a bug is intermittent, first compare successful and failing executions.

Look for differences in:

- timing
- request order
- state transitions
- initialization order
- concurrency
- lifecycle
- environment
- user interaction
- network responses
- persisted data
- logs

Increase observability before increasing retries.

The goal is to find:

> What is different when the failure occurs?

An intermittent symptom is not itself evidence that retries are the correct solution.

---

# 11. Verification Must Reproduce the Original Scenario

After implementing a fix, repeat the original reproduction procedure whenever possible.

A bug is not verified merely because:

- the project builds;
- lint passes;
- type checking passes;
- unit tests unrelated to the bug pass;
- the code looks correct.

These are useful regression checks, but they do not prove that the original symptom is fixed.

Verification should include:

```text
Original reproduction
→ previously failed
→ same reproduction after fix
→ now behaves as expected
```

If this cannot be performed, state clearly:

> Implemented, but not verified against the original symptom.

Do not claim:

> Fixed.

without sufficient verification.

---

# 12. Bug Fix and Refactor Are Separate Tasks

Do not silently convert a bug-fix task into a refactor.

During a bug fix:

Allowed:

- reproduction
- diagnosis
- instrumentation
- tests
- minimal implementation changes
- directly necessary cleanup

Normally defer:

- architecture redesign
- broad cleanup
- API redesign
- dependency replacement
- generalized abstraction
- performance optimization unrelated to the bug

If a refactor would be beneficial but is not necessary for the fix:

1. complete the bug fix first;
2. mention the possible refactor separately;
3. do not perform it unless requested.

---

# 13. Backward Compatibility Is Opt-In

Do not automatically preserve old behavior.

For internal, unreleased, or single-consumer project code, the default assumption is:

> Old internal interfaces may be changed or removed when the current design replaces them.

Do not automatically create:

- compatibility wrappers
- deprecated aliases
- V1/V2 dual implementations
- legacy adapters
- migration shims
- old-format fallback parsers
- old and new code paths in parallel

unless a real consumer requires them.

---

# 14. Compatibility Requires a Real Requirement

Before preserving backward compatibility, identify the consumer.

Valid reasons may include:

- a published public API;
- external applications use the interface;
- persisted user data exists in the old format;
- deployed clients cannot be upgraded simultaneously;
- a documented compatibility requirement exists;
- the user explicitly requires compatibility.

Invalid reasons include:

- "someone may use this later";
- "this is safer";
- "this preserves flexibility";
- "future versions might need it";
- "it's best practice to avoid breaking changes";

when no actual consumer exists.

If no consumer can be identified, prefer removing obsolete behavior.

---

# 15. Do Not Maintain Old and New Implementations Without Need

Avoid patterns such as:

```text
OldImplementation
NewImplementation
CompatibilityAdapter
LegacyFallback
MigrationHelper
```

when the project can simply use:

```text
NewImplementation
```

Parallel implementations increase:

- maintenance burden
- branching behavior
- testing requirements
- debugging difficulty
- future migration cost

When a new implementation intentionally replaces an old internal implementation:

1. verify real dependencies;
2. migrate those dependencies;
3. remove the obsolete path.

---

# 16. Prefer Migration Over Permanent Compatibility

When compatibility is temporarily required, prefer an explicit migration plan rather than indefinite dual support.

A compatibility layer should ideally have:

- a known reason;
- a known consumer;
- a clear removal condition.

Avoid permanent "temporary" adapters.

Where useful, document:

```text
Why this compatibility path exists
Which consumer requires it
When it can be removed
```

---

# 17. Do Not Future-Proof Hypothetical Requirements

Apply YAGNI.

Do not create current complexity for hypothetical future needs.

Avoid introducing:

- generic extension systems
- plugin architectures
- configurable abstraction layers
- generic compatibility frameworks
- feature-flag systems
- generalized persistence adapters
- additional indirection

unless a current requirement justifies them.

The possibility of a future rewrite is not a reason to build compatibility with that hypothetical rewrite.

If future architecture is expected to change substantially, keeping today's implementation simple is often preferable.

---

# 18. Prefer Deleting Obsolete Code

When evidence shows a code path is obsolete and no compatibility requirement remains:

> Delete it.

Do not leave it commented out.

Do not preserve it behind an unused flag.

Do not maintain it "just in case."

Version control already preserves history.

---

# 19. Tests Should Capture the Bug When Practical

When a bug can reasonably be expressed as an automated regression test:

1. create or identify a test that reproduces the failure;
2. confirm that it fails for the expected reason;
3. implement the minimal fix;
4. confirm that the test passes.

Do not create elaborate test infrastructure for a trivial issue solely to satisfy this rule.

For visual/UI bugs where automated testing is impractical, use appropriate runtime/browser verification instead.

---

# 20. Do Not Change Expected Behavior to Make a Test Pass

If a test exposes a bug:

Fix the implementation when the expected behavior is correct.

Do not weaken:

- assertions
- acceptance criteria
- error checks
- expected output

merely so that the test passes.

If the expected behavior itself is wrong or ambiguous, establish that separately.

---

# 21. Distinguish Symptom Suppression From Root-Cause Fixes

A change that makes a symptom disappear is not automatically a correct fix.

Before completion, determine whether the change:

### Fixes the cause

Example:

> Incorrect lifecycle ordering caused stale state; lifecycle ordering was corrected.

or merely:

### Suppresses the symptom

Example:

> Added a 500 ms delay, making the race less frequent.

Prefer root-cause fixes.

If only symptom mitigation is currently practical, explicitly describe it as mitigation rather than presenting it as a root-cause fix.

---

# 22. Complexity Has a Cost

Treat every new code path as a liability that requires justification.

When choosing between two correct solutions, prefer the one with fewer:

- states
- branches
- abstractions
- compatibility paths
- hidden retries
- synchronization mechanisms
- dependencies

provided it still satisfies demonstrated requirements.

"More robust" is not automatically better if robustness is achieved by introducing unnecessary complexity.

---

# 23. Completion Report for Bug Fixes

For meaningful bug fixes, final reporting should clearly distinguish:

## Root cause

What actually caused the bug.

## Change

What was changed and why.

## Verification

What was actually run or observed.

## Remaining uncertainty

Anything not verified.

Do not claim additional benefits such as:

- improved scalability
- improved resilience
- future compatibility
- greater robustness

unless those claims were actually established.

---

# 24. When the Root Cause Is Still Unknown

If investigation has not established a sufficient explanation:

Do not pretend otherwise.

It is acceptable to report:

> The bug is reproduced, but the root cause is not yet established.

or:

> This change mitigates the symptom, but the underlying mechanism is still uncertain.

That is preferable to introducing speculative architecture based on an unverified theory.

---

# 25. Default Debugging Decision Rule

When uncertain whether to:

```text
add more code
```

or:

```text
collect more evidence
```

prefer:

> Collect more evidence.

When uncertain whether to:

```text
keep a failed experimental change
```

or:

```text
remove it
```

prefer:

> Remove it.

When uncertain whether to:

```text
preserve an old internal API
```

or:

```text
replace it cleanly
```

and no real consumer requires compatibility, prefer:

> Replace it cleanly.

---

# 26. Core Rules Summary

The following rules override convenience-driven implementation habits:

1. **Observe before guessing.**
2. **Reproduce before fixing when practical.**
3. **Evidence before architecture.**
4. **One main hypothesis per experiment.**
5. **Use the smallest causal change.**
6. **A failed fix is reverted by default.**
7. **Do not retain failed changes for vague "stability" reasons.**
8. **Do not add retries, fallbacks, delays, or defensive layers without evidence.**
9. **Bug fixes and refactors are separate tasks.**
10. **Verify the original symptom before claiming success.**
11. **Backward compatibility is opt-in.**
12. **Compatibility must have a real consumer.**
13. **Remove obsolete paths instead of maintaining old and new implementations indefinitely.**
14. **Apply YAGNI to future-proofing and compatibility.**
15. **Never destroy unrelated user work while reverting Agent experiments.**
