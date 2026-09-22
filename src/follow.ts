// Pure logic for a "lyrics follow the playhead" (karaoke) mode: specifically the
// part that CAN be written and tested today. Given a schedule of when each lyric
// line becomes active (in beats) and the current playback position, it returns
// which line is active. Everything missing is on the SDK side (see the two
// BLOCKED notes), not here, so when the SDK catches up, this is ready to drive
// the highlight.
//
// BLOCKED: this feature cannot ship until the Extensions SDK provides:
//   1. Transport read access: a current playhead position (in beats) and a
//      play/stop state, ideally with a change observer. `1.0.0-beta.0` exposes no
//      transport at all, so there is nothing to feed `activeLineAt` a live beat.
//   2. A host→webview channel for an OPEN dialog (or a non-modal panel). The pad
//      is a one-shot modal (`ui.showModalDialog` resolves once, on close), so
//      even with a playhead the host couldn't stream position into the open pad
//      to move the highlight. A persistent/non-modal surface would be needed.
// See the memory note "sdk-timeline-transport-gaps" and the SDK feature request.

export type ScheduleEntry = { beat: number; name: string };

// Assign each lyric line a start beat. Mirrors the one-bar locator spacing used
// when the same lines are written to the arrangement, so a future follow
// highlight and the on-timeline markers line up. spacingBeats defaults to one bar.
export const buildSchedule = (
  lines: string[],
  opts: { startBeat?: number; spacingBeats?: number } = {},
): ScheduleEntry[] => {
  const start = opts.startBeat ?? 0;
  const spacing = opts.spacingBeats && opts.spacingBeats > 0 ? opts.spacingBeats : 4;
  return lines.map((name, i) => ({ beat: start + i * spacing, name }));
};

// Index of the line active at `beat`: the last entry whose start beat is <= beat.
// Returns -1 before the first line begins. Assumes `schedule` is sorted ascending
// by beat (buildSchedule guarantees this).
export const activeLineAt = (schedule: ScheduleEntry[], beat: number): number => {
  let idx = -1;
  for (let i = 0; i < schedule.length; i++) {
    const e = schedule[i];
    if (e && e.beat <= beat) idx = i;
    else break;
  }
  return idx;
};
