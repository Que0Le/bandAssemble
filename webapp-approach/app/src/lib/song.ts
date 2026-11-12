// Synthetic stand-in arrangement. Replaced later by the real data model
// (see ../../03-data-model.md).

export interface Marker {
  atSec: number;
  label: string;
}
export interface Line {
  atSec: number;
  chord: string;
  lyric: string;
}
export interface Song {
  lengthSec: number;
  bpm: number;
  markers: Marker[];
  lines: Line[];
}

export const SONG: Song = {
  lengthSec: 48,
  bpm: 100,
  markers: [
    { atSec: 0, label: 'Intro' },
    { atSec: 8, label: 'Verse 1' },
    { atSec: 24, label: 'Chorus' },
    { atSec: 40, label: 'Outro' },
  ],
  lines: [
    { atSec: 0, chord: 'C', lyric: '(intro — 4 bars)' },
    { atSec: 4, chord: 'G', lyric: '(intro — 4 bars)' },
    { atSec: 8, chord: 'C', lyric: 'Here comes the first line of the verse' },
    { atSec: 12, chord: 'Am', lyric: 'singing along to the clicking beat' },
    { atSec: 16, chord: 'F', lyric: 'everybody find your place in time' },
    { atSec: 20, chord: 'G', lyric: 'and we lift into the chorus now' },
    { atSec: 24, chord: 'C', lyric: 'THIS is the chorus, big and bright' },
    { atSec: 28, chord: 'G', lyric: 'all the devices scroll as one' },
    { atSec: 32, chord: 'Am', lyric: 'no conductor, just a shared clock' },
    { atSec: 36, chord: 'F', lyric: 'press start and we are locked in' },
    { atSec: 40, chord: 'C', lyric: '(outro — steady to the end)' },
    { atSec: 44, chord: 'G', lyric: '(outro — end)' },
  ],
};

export function lineIndexAt(head: number): number {
  return SONG.lines.findIndex(
    (l, i) => head >= l.atSec && (i === SONG.lines.length - 1 || head < SONG.lines[i + 1].atSec),
  );
}
