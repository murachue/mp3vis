import React from 'react';
import './App.css';
import { Checkband } from './Checkband';
import { parsefile, sampling_frequencies } from './libmp3';
import { Dropbox } from './Dropbox';
import { Wavebar } from './Wavebar';
import { MyParsed } from './types';
import { Framebar } from './Framebar';
import { ScalefacFreqGraph } from './ScalefacFreqGraph';

function App() {
  const [bandmask, setBandmask] = React.useState(Array(32).fill(true));
  const [parsed, setParsed] = React.useState<MyParsed>({ sounds: [], parsedFrames: [], });
  const [parsedFrames, setParsedFrames] = React.useState<number | null>(null);
  const [parsedMaindatas, setParsedMaindatas] = React.useState<number | null>(null);
  const [abortable, setAbortable] = React.useState(false);
  const aborted = React.useRef(false); // to be rendered but must not changed between renders (to access older instance referenced by parsefile())
  const [selectedFrame, setSelectedFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState({ ctx: null as AudioContext | null, start: 0, pos: 0, period: 0 });
  const playAnimation = React.useRef<number | null>(null);
  const [autoFollow, setAutoFollow] = React.useState(false);

  async function parse(ab: ArrayBuffer) {
    if (abortable) {
      aborted.current = true;
      await new Promise(r => setTimeout(r, 0));
    }

    setParsedFrames(0);
    setParsedMaindatas(null);
    let parsing: typeof parsed = { sounds: [], parsedFrames: [] };
    setParsed(parsing);
    setAbortable(true);
    aborted.current = false;
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
      return !aborted.current;
    }, bandmask);

    setParsed(parsing);
    setParsedFrames(parsing.parsedFrames.length);
    setParsedMaindatas(parsing.parsedFrames.filter(pf => pf.maindata).length);
    setAbortable(false);
    await new Promise(r => setTimeout(r, 0));

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

  const onDLSample = () => {
    // transposing and integerify
    const s16pcm = new Int16Array(Array(parsed.sounds[0].length).fill(0).flatMap((_, i) => parsed.sounds.map(ch => Math.min(Math.max(ch[i], -1), 1) * 32767)));
    const url = URL.createObjectURL(new Blob([s16pcm.buffer], { type: "application/octet-stream" }));
    const tmpa = document.createElement("a");
    document.body.appendChild(tmpa);
    // tmpa.style = "display: none;";
    tmpa.href = url;
    tmpa.click();
    document.body.removeChild(tmpa);
    URL.revokeObjectURL(url);
  };

  const onPlay = () => {
    const ctx = new AudioContext();
    const buf = ctx.createBuffer(parsed.sounds.length, parsed.sounds[0].length, sampling_frequencies[parsed.parsedFrames[0].frame.header.sampling_frequency]);
    Array(parsed.sounds.length).fill(0).forEach((_, ch) => {
      const chbuf = buf.getChannelData(ch);
      parsed.sounds[ch].forEach((e, i) => {
        chbuf[i] = e;
      });
    });
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => {
      cancelAnimationFrame(playAnimation.current!);
      playAnimation.current = null;

      setPlaying(playing => ({ ...playing, ctx: null }));
    };
    src.start();

    setPlaying({ ctx, start: ctx.currentTime, pos: 0, period: parsed.sounds[0].length / sampling_frequencies[parsed.parsedFrames[0].frame.header.sampling_frequency] });
  };
  if (autoFollow && playing.ctx) {
    const refreshPlaying = () => {
      setPlaying(playing => ({ ...playing, pos: playing.ctx!.currentTime - playing.start }));
      setSelectedFrame(Math.floor(playing.pos / playing.period * parsed.parsedFrames.length));
    };
    if (playAnimation.current) {
      cancelAnimationFrame(playAnimation.current);
    }
    playAnimation.current = requestAnimationFrame(refreshPlaying);
  }

  return (
    <div>
      <p>hello</p>
      <Dropbox onFileDrop={parse}>
        <div style={{ width: "100%", background: "#ccc", color: "#000", padding: "0px 2em", boxSizing: "border-box" }}>
          <p>drag here</p>
          <p>{<button style={{ display: abortable ? "inline" : "none" }} onClick={() => { aborted.current = true; }}>abort</button>}{parsedFrames === null ? "info shown here" : parsedMaindatas === null ? `${parsedFrames}...` : `${parsedFrames} / ${parsedMaindatas}`}</p>
          <p>{(() => {
            const firstFrame = parsed.parsedFrames[0];
            if (!firstFrame) {
              return '';
            }
            const hdr = firstFrame.frame.header;
            return <>{sampling_frequencies[hdr.sampling_frequency]} Hz {hdr.mode === 3 ? 1 : 2} ch</>;
          })()}</p>
          <p><Wavebar style={{ width: "100%", height: 100 }} barHeight={60} zoomWidth={300} data={parsed.sounds} zoomingPos={(autoFollow && playing.ctx) ? playing.pos / playing.period : null} /></p>
          <p>reordered (only short-windows):</p>
          <p><ScalefacFreqGraph style={{ width: "576px", height: "150px", display: "block", margin: "0 0" }} data={parsed.parsedFrames.length <= selectedFrame ? null : parsed.parsedFrames[selectedFrame]} granule={0} channel={0} subgrid={false} samplesFunc={(data, gr, ch) => data.internal!.reordered.granule[gr].channel[ch]} /></p>
          <p>requantized:</p>
          <p><ScalefacFreqGraph style={{ width: "576px", height: "150px", display: "block", margin: "0 0" }} data={parsed.parsedFrames.length <= selectedFrame ? null : parsed.parsedFrames[selectedFrame]} granule={0} channel={0} subgrid={true} samplesFunc={(data, gr, ch) => data.internal!.requantized.granule[gr].channel[ch].samples} /></p>
          <p><Framebar style={{ width: "100%", height: 60 }} barHeight={30} zoomWidth={300} data={parsed.parsedFrames} selectedFrame={selectedFrame} onSelectedFrame={fr => setSelectedFrame(fr || 0)} /></p>
          <p><Checkband checks={bandmask} onChanged={setBandmask} /></p>
          <p><button disabled={parsed.parsedFrames.length < 1} onClick={onDLSample}>download raw sample</button></p>
          <p><button disabled={parsed.parsedFrames.length < 1} onClick={onPlay}>play sample</button> <label><input type="checkbox" checked={autoFollow} onChange={e => setAutoFollow(e.target.checked)} />follow playing</label></p>
          <p style={{ overflow: "hidden", height: "3.5em" }}>{/* ...internals */}</p>
        </div>
      </Dropbox>
    </div >
  );
}

export default App;
