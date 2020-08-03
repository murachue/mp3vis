import React, { useState } from 'react';
import './App.css';
import { Zoombar } from './Zoombar';
import { Checkband } from './Checkband';
import { parsefile, PromiseType } from './libmp3';
import { Dropbox } from './Dropbox';
import { Wavebar } from './Wavebar';

type MyParsed = Omit<PromiseType<ReturnType<typeof parsefile>>, "soundframes"> & {
  sounds: number[][];
  framerefs: {
    main_i: number;
    maindata: PromiseType<ReturnType<typeof parsefile>>["maindatas"][number];
    offset: number;
    size: number;
  }[][];
};

// FIXME FIXME globalism!!! but defining in App() cause other instance than parse()ing...
let aborted = false;

function App() {
  const [bandmask, setBandmask] = useState(Array(32).fill(true));
  const [parsed, setParsed] = useState<MyParsed>({ frames: [], maindatas: [], sounds: [], internals: [], framerefs: [] });
  const [parsedFrames, setParsedFrames] = useState<number | null>(null);
  const [parsedMaindatas, setParsedMaindatas] = useState<number | null>(null);
  const [onDLSample, setOnDLSample] = useState<[() => void] | null>(null);
  const [onPlay, setOnPlay] = useState<[() => void] | null>(null);
  const [zoomingFrame, setZoomingFrame] = useState(false);
  const [selectingFrame, setSelectingFrame] = useState(false);
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

  const onZoomFrame = (offset: number | null, pressed: boolean) => {
    if (!!offset !== zoomingFrame) {
      setZoomingFrame(!!offset);
    }
    if (pressed !== selectingFrame) {
      setSelectingFrame(pressed);
    }

    if (offset && selectingFrame) {
      const onew = 200;
      const pad = 20;
      const interval = onew + pad;
      setSelectedFrame(Math.floor((parsed.frames.length - onew / interval) * offset + 0.5));
    }
  };

  const drawFrame = (ctx: CanvasRenderingContext2D, width: number, height: number, data: typeof parsed, i: number) => {
    const frame = data.frames[i];
    const xscale = width / frame.totalsize;
    // whole (at last becomes empty)
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    // header
    ctx.fillStyle = "#cac";
    ctx.fillRect(0, 0, 4 * xscale, height);
    // sideinfo
    ctx.fillStyle = "#fdf";
    ctx.fillRect(4 * xscale, 0, (frame.head_side_size - 4) * xscale, height);
    // maindatas
    const rainbow = ["#afa", "#ffa", "#fca", "#faa", "#faf", "#aaf"]; // at most 3 is enough in spec, but more in the wild.
    for (const ref of data.framerefs[i]) {
      const nback = ref.main_i - i;
      const color_i = nback < 3 ? nback : (((nback - 3) % (rainbow.length - 3)) + 3);
      ctx.fillStyle = rainbow[color_i];
      ctx.fillRect(ref.offset * xscale, 0, ref.size * xscale, height);
    }
  };

  const drawWholeFrame = (ctx: CanvasRenderingContext2D, width: number, height: number, data: typeof parsed & { selectedFrame: number | null; }) => {
    ctx.fillStyle = "gray";
    ctx.fillRect(0, 0, width, height);

    // ctx.lineCap = "round";
    if (0 < data.frames.length) {
      if (data.frames.length < width) {
        // full
        // TODO: also visualize frame size (for VBR)
        const w = Math.min(width / data.frames.length, 200);
        data.frames.forEach((_frame, i) => { // eslint-disable @typescript/unused-variable
          ctx.save();
          ctx.translate(1 + i * w, 1);
          drawFrame(ctx, w - 2, height - 2, data, i);
          if (i === data.selectedFrame) {
            ctx.strokeStyle = "red";
            ctx.strokeRect(0, 0, w - 2, height - 2);
          }
          ctx.restore();
        });
      } else {
        // overview
        // TODO; color by max-far-ref?
      }
    }
  };

  const drawZoomFrame = (ctx: CanvasRenderingContext2D, offset: number, width: number, height: number, data: typeof parsed & { selectedFrame: number | null; }) => {
    ctx.fillStyle = "gray";
    ctx.fillRect(0.5, 0.5, width, height);

    const onew = 200;
    const pad = 20;
    const interval = onew + pad;
    const centerlx = (width - onew) / 2;

    // const from = offset * (parsed.frames.length - 1) - (1 - 220 / width) / 2;
    const hi = (parsed.frames.length - 1) * offset; // including fraction
    const to = Math.min(hi + 3, parsed.frames.length);
    for (let i_f = hi - 1; i_f < to; i_f++) {
      if (i_f < 0) {
        continue;
      }
      const i = Math.floor(i_f);
      ctx.save();
      ctx.translate((i - hi) * interval + centerlx, 20);
      drawFrame(ctx, 200, height - 25, data, i);
      ctx.fillStyle = "white";
      if (i === data.selectedFrame) {
        ctx.fillStyle = "red";
        ctx.strokeStyle = "red";
        ctx.strokeRect(0, 0, 200, height - 25);
      }
      ctx.font = "15px sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(`${i}: ${parsed.frames[i].offset}`, 0, -15);
      ctx.restore();
    }

    ctx.strokeStyle = "black";
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  };


  return (
    <div>
      <p>hello</p>
      <Dropbox onFileDrop={parse}>
        <div style={{ width: "100%", background: "#ccc", color: "#000", padding: "0px 2em", boxSizing: "border-box" }}>
          <p>drag here</p>
          <p>{<button style={{ display: abortable ? "inline" : "none" }} onClick={() => { aborted = true; }}>abort</button>}{parsedFrames === null ? "info shown here" : parsedMaindatas === null ? `${parsedFrames}...` : `${parsedFrames} / ${parsedMaindatas}`}</p>
          <Wavebar width={"100%"} height={100} barHeight={60} zoomWidth={300} data={parsed.sounds} />
          <Zoombar width={"100%"} height={60} barHeight={30} zoomWidth={300}
            drawWhole={drawWholeFrame} drawZoom={drawZoomFrame}
            zooming={zoomingFrame} data={{ ...parsed, selectingFrame, selectedFrame }}
            onZoom={onZoomFrame}
          />
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
