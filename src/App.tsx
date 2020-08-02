import React, { useState } from 'react';
import './App.css';
import { Zoombar } from './Zoombar';
import { Checkband } from './Checkband';
import { parsefile, PromiseType } from './libmp3';
import { Dropbox } from './Dropbox';

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
  const [parsedFrames, setParsedFrames] = useState(null as number | null);
  const [parsedMaindatas, setParsedMaindatas] = useState(null as number | null);
  const [onDLSample, setOnDLSample] = useState(null as [() => void] | null);
  const [onPlay, setOnPlay] = useState(null as [() => void] | null);
  const [selectingFrame, setSelectingFrame] = useState(false);
  const [zoomingWave, setZoomingWave] = useState(false);
  const [abortable, setAbortable] = useState(false);

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

  const drawWholeFrame = (ctx: CanvasRenderingContext2D, width: number, height: number, data: typeof parsed) => {
    ctx.fillStyle = "gray";
    ctx.fillRect(0, 0, width, height);

    // ctx.lineCap = "round";
    if (0 < data.frames.length) {
      if (data.frames.length < width) {
        // full
        // TODO: also visualize frame size (for VBR)
        const w = Math.min(width / data.frames.length, 200);
        data.frames.forEach((frame, i) => {
          // whole (at last becomes empty)
          ctx.fillStyle = "white";
          ctx.fillRect(1 + i * w, 1, w - 2, height - 2);
          // header
          ctx.fillStyle = "#cac";
          ctx.fillRect(1 + i * w, 1, (4 / frame.totalsize) * (w - 2), height - 2);
          // sideinfo
          ctx.fillStyle = "#fcf";
          ctx.fillRect(1 + i * w + (4 / frame.totalsize) * (w - 2), 1, (frame.head_side_size - 4) / frame.totalsize * (w - 2), height - 2);
          // maindatas
          const rainbow = ["#afa", "#ffa", "#fca", "#faa", "#faf", "#aaf"]; // at most 3 is enough in spec, but more in the wild.
          for (const ref of data.framerefs[i]) {
            const nback = ref.main_i - i;
            const color_i = nback < 3 ? nback : (((nback - 3) % (rainbow.length - 3)) + 3);
            ctx.fillStyle = rainbow[color_i];
            ctx.fillRect(1 + i * w + (ref.offset / frame.totalsize) * (w - 2), 1, (ref.size) / frame.totalsize * (w - 2), height - 2);
          }
        });
      } else {
        // overview
      }
    }
  };

  const drawZoomFrame = (ctx: CanvasRenderingContext2D, offset: number, width: number, height: number, data: typeof parsed) => {
    // ctx.fillStyle = selectingFrame ? "darkgreen" : "black";
    // ctx.fillRect(0.5, 0.5, width, height);
    // ctx.strokeStyle = "white";
    // ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    // ctx.strokeStyle = "red";
    // ctx.beginPath();
    // ctx.moveTo(offset * width + 0.5, 0 + 0.5);
    // ctx.lineTo(offset * width + 0.5, height + 0.5);
    // ctx.stroke();
  };

  const drawWholeWave = (ctx: CanvasRenderingContext2D, width: number, height: number, data: typeof parsed) => {
    ctx.fillStyle = "#222";
    ctx.globalAlpha = 1.0;
    ctx.fillRect(0, 0, width, height);

    if (0 < data.sounds.length) {
      // FIXME: should do this on data set, not each draw!!!
      const peaksPerCh = data.sounds.map(ch => (Array(width).fill(0) as number[]).map((_, i) => {
        const from = Math.floor(ch.length * i / width);
        const to = Math.min(from + 1, Math.floor(ch.length * (i + 1) / width));
        const peak = ch.slice(from, to).reduce((prev, cur) => Math.max(prev, Math.abs(cur)), 0);
        return peak;
      }));

      ctx.globalAlpha = 0.5;

      const drawPeakRange = (color: string, peaks: number[]) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, peaks[0]);
        peaks.forEach((peak, x) => ctx.lineTo(x, height / 2 - height / 2 * peak));
        peaks.map((peak, x) => [peak, x]).reverse().forEach(([peak, x]) => ctx.lineTo(x, height / 2 + height / 2 * peak));
        ctx.closePath();
        ctx.fill();
      };
      const drawPeakLine = (color: string, peaks: number[]) => {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, peaks[0]);
        peaks.forEach((peak, x) => ctx.lineTo(x, height / 2 - height / 2 * peak));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, peaks[0]);
        peaks.forEach((peak, x) => ctx.lineTo(x, height / 2 + height / 2 * peak));
        ctx.stroke();
      };

      drawPeakRange("#8f8", peaksPerCh[0]);
      drawPeakLine("#4f4", peaksPerCh[0]);
      if (peaksPerCh[1]) {
        drawPeakRange("#88f", peaksPerCh[1]);
        drawPeakLine("#44f", peaksPerCh[1]);
      }
    }
  };
  const drawZoomWave = (ctx: CanvasRenderingContext2D, offset: number, width: number, height: number, data: typeof parsed) => {
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = "#222";
    ctx.fillRect(0.5, 0.5, width, height);

    ctx.strokeStyle = "white";
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    const from = Math.floor((data.sounds[0].length - width) * offset);

    // ctx.globalAlpha = 0.5;

    const drawWave = (color: string, points: number[]) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(1 + 0.5, points[0] * height / 2 + height / 2 + 1 + 0.5);
      points.forEach((point, i) => {
        ctx.lineTo(i + 1 + 0.5, point * height / 2 + height / 2 + 1 + 0.5);
      });
      ctx.stroke();
    };
    drawWave("#8f8", data.sounds[0].slice(from, from + width));
    if (data.sounds[1]) {
      drawWave("#88f", data.sounds[1].slice(from, from + width));
    }
  };

  return (
    <div>
      <p>hello</p>
      <Dropbox onFileDrop={parse}>
        <div style={{ width: "100%", background: "#ccc", color: "#000", padding: "0px 2em", boxSizing: "border-box" }}>
          <p>drag here</p>
          <p>{<button style={{ display: abortable ? "inline" : "none" }} onClick={() => { aborted = true; }}>abort</button>}{parsedFrames === null ? "info shown here" : parsedMaindatas === null ? `${parsedFrames}...` : `${parsedFrames} / ${parsedMaindatas}`}</p>
          <Zoombar
            width={"100%"} height={100} barHeight={60} zoomWidth={300}
            drawWhole={drawWholeWave} drawZoom={drawZoomWave}
            zooming={zoomingWave && !!parsed.sounds[0]} data={parsed}
            onPointerDown={() => setZoomingWave(true)} onPointerUp={() => setZoomingWave(false)}
          />
          <Zoombar width={"100%"} height={40} barHeight={30} zoomWidth={300}
            drawWhole={drawWholeFrame} drawZoom={drawZoomFrame}
            zooming={true} data={parsed}
            onPointerDown={() => setSelectingFrame(true)} onPointerUp={() => setSelectingFrame(false)}
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
