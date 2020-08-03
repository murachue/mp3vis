import React, { useState } from 'react';
import './App.css';
import { Checkband } from './Checkband';
import { parsefile } from './libmp3';
import { Dropbox } from './Dropbox';
import { Wavebar } from './Wavebar';
import { MyParsed } from './types';
import { Framebar } from './Framebar';

// FIXME FIXME globalism!!! but defining in App() cause other instance than parse()ing...
let aborted = false;

function App() {
  const [bandmask, setBandmask] = useState(Array(32).fill(true));
  const [parsed, setParsed] = useState<MyParsed>({ frames: [], maindatas: [], sounds: [], internals: [], framerefs: [] });
  const [parsedFrames, setParsedFrames] = useState<number | null>(null);
  const [parsedMaindatas, setParsedMaindatas] = useState<number | null>(null);
  const [onDLSample, setOnDLSample] = useState<[() => void] | null>(null);
  const [onPlay, setOnPlay] = useState<[() => void] | null>(null);
  const [abortable, setAbortable] = useState(false);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);

  async function parse(ab: ArrayBuffer) {
    setParsedFrames(0);
    setParsedMaindatas(null);
    let parsing: typeof parsed = { frames: [], maindatas: [], sounds: [], internals: [], framerefs: [] };
    setParsed(parsing);
    setAbortable(true);
    aborted = false;
    await new Promise(r => setTimeout(r, 0));

    const { frames, maindatas, soundframes, internals } = await parsefile(ab, async (iter) => {
      setParsedFrames(iter.i + 1);
      if (true) {
        parsing = {
          frames: [...parsing.frames, iter.frame],
          maindatas: [...parsing.maindatas],
          sounds: [...parsing.sounds],
          internals: [...parsing.internals],
          framerefs: [...parsing.framerefs, []],
        };
        if (iter.maindata) {
          parsing.maindatas.push(iter.maindata);

          // post-updating referencing reservoir
          // TODO: make more stateless... but hard.

          let mainsize = iter.maindata.main_data.length - iter.maindata.ancillary_bytes.length;
          if (0 < mainsize) {
            // first, find beginning.
            let start = null;
            let i = parsing.frames.length - 1;
            let remain = iter.frame.sideinfo.main_data_end; // defined out of loop only for logging error...
            for (; 0 < remain && 0 <= i;) {
              i--;
              const thatFrame = parsing.frames[i];
              // XXX: what if data including extra bytes after frame?
              const datalen = thatFrame.data.length; // === thatFrame.totalsize - thatFrame.head_side_size;
              const size = Math.min(remain, datalen);
              start = thatFrame.totalsize - size;
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
              const thatFrame = parsing.frames[i];
              // XXX: what if data including extra bytes after frame?
              const offset = start !== null ? start : thatFrame.head_side_size;
              const availThatFrame = thatFrame.totalsize - offset;
              const size = Math.min(mainsize, availThatFrame);

              parsing.framerefs[i].push({
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
          iter.soundframe.forEach((sf, i) => (parsing.sounds[i] || (parsing.sounds[i] = [])).push(...sf));
        }
        if (iter.internal) {
          parsing.internals.push(iter.internal);
        }
        setParsed(parsing);
      }
      await new Promise(r => setTimeout(r, 0));
      return !aborted;
    }, bandmask);

    const samples = Array(soundframes[0].length).fill(0).map((_, ch) => soundframes.flatMap(sf => sf[ch]));
    setParsed({ frames, maindatas, sounds: samples, internals, framerefs: parsing.framerefs });
    setParsedFrames(frames.length);
    setParsedMaindatas(maindatas.length);
    setAbortable(false);
    await new Promise(r => setTimeout(r, 0));

    setOnDLSample([() => {
      const s16pcm = new Int16Array(Array(samples[0].length).fill(0).flatMap((_, i) => samples.map(ch => Math.min(Math.max(ch[i], -1), 1) * 32767)));
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
      const buf = ctx.createBuffer(samples.length, samples[0].length, [44100, 48000, 32000/* , null */][frames[0].header.sampling_frequency]);
      Array(samples.length).fill(0).forEach((_, ch) => {
        const chbuf = buf.getChannelData(ch);
        samples[ch].forEach((e, i) => {
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
          <Wavebar width={"100%"} height={100} barHeight={60} zoomWidth={300} data={parsed.sounds} />
          <Framebar width={"100%"} height={60} barHeight={30} zoomWidth={300} data={parsed} onSelectedFrame={setSelectedFrame} />
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
