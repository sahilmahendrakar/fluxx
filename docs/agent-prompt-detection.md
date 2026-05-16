# Agent Silence Detection & `needs-input` Status Transition

Design doc for automatically detecting when an agent session has stopped
producing output (silence) and transitioning the associated task from
`in-progress` to `needs-input`.

## Approach: Silence Timer

The same technique tmux `monitor-silence` uses. While an agent is working it
streams output near-continuously (chunks every 10-50ms). When it stops and
waits for user input, output stops entirely. We detect that silence.

**No regex. No per-agent heuristics. No pattern matching.**

The rule is simple and deterministic:
1. PTY output stops for N seconds while the process is still alive --> `needs-input`
2. PTY output resumes --> `in-progress`

## 1. Where Detection Lives

**`SilenceDetector` in `src/terminal-runtime/SilenceDetector.ts`**

DaemonCore creates one detector per agent session. It's a tiny class: a timer
that resets on every PTY chunk.

The daemon is the right place because it already owns the PTY and sees every
byte with zero IPC latency.

## 2. SilenceDetector Class

```typescript
// src/terminal-runtime/SilenceDetector.ts

export type SilenceState = 'active' | 'silent';

export class SilenceDetector {
  private state: SilenceState = 'active';
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onStateChange: (state: SilenceState) => void,
    private readonly silenceMs: number = 5_000,
  ) {
    // Arm immediately -- if the agent never produces output, we still detect.
    this.arm();
  }

  /** Called on every PTY output chunk. */
  onData(): void {
    if (this.state === 'silent') {
      this.state = 'active';
      this.onStateChange('active');
    }
    this.arm();
  }

  /** Reset and start the silence timer. */
  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.state = 'silent';
      this.onStateChange('silent');
    }, this.silenceMs);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
```

That's the entire detection logic. No strategy pattern, no rolling buffers,
no prompt regexes.

## 3. Detection-to-Status-Update Flow

```
PTY output chunk arrives
    |
    v
SessionRuntime.onData(chunk, seq)
    |
    |-- broadcast({ kind: 'data', ... })           [existing, unchanged]
    |
    +-- detector.onData()                           [new]
            |
            +-- resets silence timer
            +-- if was 'silent' --> emit 'active'
                    |
                    v
                DaemonCore broadcasts:
                  { kind: 'agent-state', id, state: 'active' }


No output for silenceMs...
    |
    v
Timer fires
    |
    +-- detector transitions to 'silent'
            |
            v
        DaemonCore broadcasts:
          { kind: 'agent-state', id, state: 'silent' }
```

### Main-process side

Main-process stream delivery (e.g. `deliverTerminalStreamFrameToRenderers`) gains a new case:

```typescript
if (frame.kind === 'agent-state') {
  const taskId = this.sessionTaskId(frame.id);
  if (!taskId) return;

  if (frame.state === 'silent') {
    taskStore.update(taskId, { status: 'needs-input' });
  } else if (frame.state === 'active') {
    taskStore.update(taskId, { status: 'in-progress' });
  }
  broadcast(`session:agent-state:${frame.id}`, { state: frame.state });
  return;
}
```

The `taskId` is resolved from the `Session` object already tracked by
`TerminalRuntimeManager` (sessions carry `taskId`).

### Protocol additions

```typescript
// Add to StreamFrame union in protocol.ts
| { kind: 'agent-state'; id: string; state: 'active' | 'silent' }
```

## 4. DaemonCore Integration

The `SessionEntry` interface gains a `detector` field:

```typescript
interface SessionEntry {
  runtime: SessionRuntime;
  session: Session;
  detector: SilenceDetector;
}
```

In `DaemonCore.createSession()`:

```typescript
const detector = new SilenceDetector(
  (state) => {
    this.broadcast({ kind: 'agent-state', id, state });
  },
);

// In the onData callback:
onData: (data, seq) => {
  this.broadcast({ kind: 'data', target: 'session', id, data, seq });
  detector.onData();
},
```

In `DaemonCore.stopSession()`, add `entry.detector.dispose()` before cleanup.

No changes to `SessionRuntime`, `writeSession`, or any other existing code
paths.

## 5. Silence Timeout Value

**Default: 5 seconds.**

| Value | Trade-off |
|---|---|
| 1s | Fast detection but false positives during slow network/build pauses |
| 5s | Good balance -- agents stream continuously while working, 5s gap is definitive |
| 30s | What tmux users typically set; too slow for our use case since we own the UI |

The timeout is a constructor parameter so it can be tuned or made configurable
later without changing the architecture.

Agents produce output while working:
- Claude Code streams tokens as they generate (~10-50ms between chunks)
- Tool execution (file edits, bash) produces output before/after each tool
- The only time output stops for multiple seconds is at a prompt

## 6. Edge Cases

| Scenario | Behavior |
|---|---|
| Agent exits while in `silent` | `session-exit` frame handles task status separately; detector is disposed |
| Long build with no stdout (e.g. `npm install`) | Will trigger `silent` after 5s. Acceptable -- user sees the task card move, and it moves back to `in-progress` as soon as output resumes. Brief false positive is better than missing a real prompt. |
| Agent thinking with no output | Same as above -- brief `needs-input` until output resumes. This is actually useful: it tells the user "nothing is happening right now." |
| User manually sets status via MCP | Next output chunk or silence timer will overwrite. If manual control is needed, detector can be paused (future enhancement). |
| Session created but agent slow to start | Timer armed at construction. If agent takes >5s to produce first output, task briefly shows `needs-input`. Acceptable -- indicates the agent hasn't started working yet. |

## 7. What This Does NOT Do

- No per-agent prompt pattern matching
- No regex heuristics
- No rolling output buffers
- No strategy pattern or agent-specific subclasses
- No inspection of terminal state (cursor position, screen content)
- No PTY write interception

The silence timer is agent-agnostic. It works identically for `claude-code`,
`cursor`, and `codex` with zero agent-specific code.

## 8. Testing Strategy

- **Unit tests** for `SilenceDetector`: use fake timers to verify state
  transitions (`active` -> feed nothing -> `silent`; `silent` -> feed chunk ->
  `active`; rapid chunks keep resetting timer)
- **Integration test**: `TerminalRuntimeManager` with a mock PTY that writes then stops;
  verify `agent-state` frame is broadcast after silence period
- **Timer disposal**: verify no leaked timers after `dispose()`

## 9. Files Changed

| File | Change |
|---|---|
| `src/terminal-runtime/SilenceDetector.ts` | Detector implementation |
| `src/terminal-runtime/protocol.ts` | `agent-state` in `StreamFrame` union |
| `src/main/TerminalRuntimeManager.ts` | Create detector per session, wire `onData`, dispose on stop; fan-out `agent-state` to renderers |
