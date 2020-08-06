import React, { useState } from 'react';
import './App.css';
import { Checkband } from './Checkband';
import { parsefile, sampling_frequencies } from './libmp3';
import { Dropbox } from './Dropbox';
import { Wavebar } from './Wavebar';
import { MyParsed } from './types';
import { Framebar } from './Framebar';
import { ScalefacFreqGraph } from './ScalefacFreqGraph';

// FIXME: use useRef
let aborted = false;

function App() {
  const [bandmask, setBandmask] = useState(Array(32).fill(true));
  const [parsed, setParsed] = useState<MyParsed>({ sounds: [], parsedFrames: [], });
  const [parsedFrames, setParsedFrames] = useState<number | null>(null);
  const [parsedMaindatas, setParsedMaindatas] = useState<number | null>(null);
  const [onDLSample, setOnDLSample] = useState<[() => void] | null>(null);
  const [onPlay, setOnPlay] = useState<[() => void] | null>(null);
  const [abortable, setAbortable] = useState(false);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);

  async function parse(ab: ArrayBuffer) {
    setParsedFrames(0);
    setParsedMaindatas(null);
    let parsing: typeof parsed = { sounds: [], parsedFrames: [] };
    setParsed(parsing);
    setAbortable(true);
    aborted = false;
    await new Promise(r => setTimeout(r, 0));

    await parsefile(ab, async (iter) => {
      setParsedFrames(iter.i + 1);
      if (true) {
        parsing = {
          sounds: [...parsing.sounds], // note: only inner array (per ch) are changed but to refresh Wavebar recreate outer array too.
          parsedFrames: [...parsing.parsedFrames, {
            frame: iter.frame,
            maindata: iter.maindata,
            internal: iter.internal,
            framerefs: [],
          }],
        };

        if (iter.maindata) {
          // post-updating referencing reservoir
          // TODO: make more stateless... but hard.

          let mainsize = iter.maindata.main_data.length - iter.maindata.ancillary_bytes.length;
          if (0 < mainsize) {
            // first, find beginning.
            let start = null;
            let i = parsing.parsedFrames.length - 1;
            let remain = iter.frame.sideinfo.main_data_end; // defined out of loop only for logging error...
            for (; 0 < remain && 0 <= i;) {
              i--;
              const thatParsedFrame = parsing.parsedFrames[i];
              // XXX: what if data including extra bytes after frame?
              const datalen = thatParsedFrame.frame.data.length; // === thatFrame.totalsize - thatFrame.head_side_size;
              const size = Math.min(remain, datalen);
              start = thatParsedFrame.frame.totalsize - size;
              remain -= size;
              if (remain <= 0) {
                break;
              }
            }
            if (i < 0) {
              // this must not happened... (when this, not decoded at all)
              throw new Error(`ref overruns: frame=${iter.i} remain=${remain}`);
            }
            // then, insert usage from there.
            for (; 0 < mainsize; i++) {
              const thatParsedFrame = parsing.parsedFrames[i];
              // XXX: what if data including extra bytes after frame?
              const offset = start !== null ? start : thatParsedFrame.frame.head_side_size;
              const availThatFrame = thatParsedFrame.frame.totalsize - offset;
              const size = Math.min(mainsize, availThatFrame);

              parsing.parsedFrames[i].framerefs.push({
                main_i: iter.i,
                maindata: iter.maindata,
                offset,
                size,
              });
              start = null;
              mainsize -= size;
            }
          }
        }
        if (iter.soundframe) {
          iter.soundframe.forEach((samples, ch) => (parsing.sounds[ch] || (parsing.sounds[ch] = [])).push(...samples));
        }
        setParsed(parsing);
      }
      await new Promise(r => setTimeout(r, 0));
      return !aborted;
    }, bandmask);

    setParsedFrames(parsing.parsedFrames.length);
    setParsedMaindatas(parsing.parsedFrames.filter(pf => pf.maindata).length);
    setAbortable(false);
    await new Promise(r => setTimeout(r, 0));

    setOnDLSample([() => {
      // transposing and integerify
      const s16pcm = new Int16Array(Array(parsing.sounds[0].length).fill(0).flatMap((_, i) => parsing.sounds.map(ch => Math.min(Math.max(ch[i], -1), 1) * 32767)));
      const url = URL.createObjectURL(new Blob([s16pcm.buffer], { type: "application/octet-stream" }));
      const tmpa = document.createElement("a");
      document.body.appendChild(tmpa);
      // tmpa.style = "display: none;";
      tmpa.href = url;
      tmpa.click();
      document.body.removeChild(tmpa);
      URL.revokeObjectURL(url);
    }]);

    setOnPlay([() => {
      const ctx = new AudioContext();
      const buf = ctx.createBuffer(parsing.sounds.length, parsing.sounds[0].length, sampling_frequencies[parsing.parsedFrames[0].frame.header.sampling_frequency]);
      Array(parsing.sounds.length).fill(0).forEach((_, ch) => {
        const chbuf = buf.getChannelData(ch);
        parsing.sounds[ch].forEach((e, i) => {
          chbuf[i] = e;
        });
      });
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    }]);

    /*
    const internals_box = document.getElementById("internals");
    internals_box.innerText = internals.map(e => JSON.stringify(e) + "\n").join("");
    internals_box.onclick = function () {
      const selection = getSelection();
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(internals_box);
      selection.addRange(range);
    };
    */
  }

  return (
    <div>
      <p>hello</p>
      <Dropbox onFileDrop={parse}>
        <div style={{ width: "100%", background: "#ccc", color: "#000", padding: "0px 2em", boxSizing: "border-box" }}>
          <p>drag here</p>
          <p>{<button style={{ display: abortable ? "inline" : "none" }} onClick={() => { aborted = true; }}>abort</button>}{parsedFrames === null ? "info shown here" : parsedMaindatas === null ? `${parsedFrames}...` : `${parsedFrames} / ${parsedMaindatas}`}</p>
          <Wavebar width="100%" height={100} barHeight={60} zoomWidth={300} data={parsed.sounds} />
          <ScalefacFreqGraph style={{ width: "576px", height: "150px", display: "block", margin: "0 0" }} data={selectedFrame ? parsed.parsedFrames[selectedFrame] || null : null} />
          <Framebar width="100%" height={60} barHeight={30} zoomWidth={300} data={parsed.parsedFrames} onSelectedFrame={setSelectedFrame} />
          <Checkband checks={bandmask} onChanged={setBandmask} />
          <p><button disabled={!onDLSample} onClick={onDLSample?.[0]}>download raw sample</button></p>
          <p><button disabled={!onPlay} onClick={onPlay?.[0]}>play sample</button></p>
          <p style={{ overflow: "hidden", height: "3.5em" }}>{/* ...internals */}</p>
        </div>
      </Dropbox>
    </div >
  );
}

export default App;
