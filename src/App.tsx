import React, { useState } from 'react';
import './App.css';
import { Zoombar } from './Zoombar';
import { Checkband } from './Checkband';
import { parsefile } from './libmp3';
import { Dropbox } from './Dropbox';

function App() {
  const [bandmask, setBandmask] = useState(Array(32).fill(true));
  const [parsed, setParsed] = useState({ frames: [], maindatas: [], soundframes: [[]], internals: [] });
  const [parsedFrames, setParsedFrames] = useState(null as number | null);
  const [parsedMaindatas, setParsedMaindatas] = useState(null as number | null);
  const [onDLSample, setOnDLSample] = useState(null as [() => void] | null);
  const [onPlay, setOnPlay] = useState(null as [() => void] | null);
  const [zoompush, setZoompush] = useState(false);

  async function parse(ab: ArrayBuffer) {
    setParsedFrames(0);
    setParsedMaindatas(null);
    await new Promise(r => setTimeout(r, 0));

    const { frames, maindatas, soundframes, internals } = await parsefile(ab, async (iter) => {
      setParsedFrames(iter.i);
      await new Promise(r => setTimeout(r, 0));
      return true;
    }, bandmask);

    setParsedMaindatas(frames.length);
    setParsedMaindatas(maindatas.length);
    await new Promise(r => setTimeout(r, 0));

    const samples = Array(soundframes[0].length).fill(0).map((_, ch) => soundframes.flatMap(sf => sf[ch]));

    /*
    const canvas = document.getElementById("wavescope");
    const ctx = canvas.getContext("2d");
    canvas.width = samples[0].length;
    canvas.height = 100;
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const param of [{ color: "#cfc", sample: samples[0] }, { color: "#ccf", sample: samples[1] }].slice(0, samples.length)) {
      ctx.strokeStyle = param.color;
      ctx.beginPath();
      ctx.moveTo(0, param.sample[0] * 50 + 50);
      param.sample.forEach((v, i) => {
        ctx.lineTo(i, v * 50 + 50)
      });
      ctx.stroke();
    }
    */

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

  const drawWhole = (ctx: CanvasRenderingContext2D, width: number, height: number, data: typeof parsed) => {
    ctx.fillStyle = "gray";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "white";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(100, 20);
    ctx.stroke();
  };

  const drawZoom = (ctx: CanvasRenderingContext2D, offset: number, width: number, height: number, data: typeof parsed) => {
    ctx.fillStyle = zoompush ? "darkgreen" : "black";
    ctx.fillRect(0.5, 0.5, width, height);
    ctx.strokeStyle = "white";
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.strokeStyle = "red";
    ctx.beginPath();
    ctx.moveTo(offset * width + 0.5, 0 + 0.5);
    ctx.lineTo(offset * width + 0.5, height + 0.5);
    ctx.stroke();
  };

  return (
    <div>
      <p>hello</p>
      <Dropbox onFileDrop={parse}>
        <div style={{ width: "100%", background: "#ccc", color: "#000", padding: "0px 2em", boxSizing: "border-box" }}>
          <p>drag here</p>
          <p>{parsedFrames === null ? "info shown here" : parsedMaindatas === null ? `${parsedFrames}...` : `${parsedFrames} / ${parsedMaindatas}`}</p>
          <canvas id="wavescope" style={{ width: "100%", height: "100px" }}></canvas>
          <Checkband checks={bandmask} onChanged={setBandmask} />
          <p><button disabled={!onDLSample} onClick={onDLSample?.[0]}>download raw sample</button></p>
          <p><button disabled={!onPlay} onClick={onPlay?.[0]}>play sample</button></p>
          <p style={{ overflow: "hidden", height: "3.5em" }}>{/* ...internals */}</p>
        </div>
      </Dropbox>
      <Zoombar width={"50%"} height={40} barHeight={30} zoomWidth={100} drawWhole={drawWhole} drawZoom={drawZoom} data={parsed} onPointerDown={() => setZoompush(true)} onPointerUp={() => setZoompush(false)}></Zoombar>
    </div >
  );
}

export default App;
