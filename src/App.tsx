import React from 'react';
import { hot } from 'react-hot-loader/root';
import './App.css';
import { Checkband } from './Checkband';
import { parsefile, sampling_frequencies } from './libmp3';
import { Dropbox } from './Dropbox';
import { Wavebar } from './Wavebar';
import { MyParsed } from './types';
import { Framebar } from './Framebar';
import { ScalefacFreqGraph, ScalefacFreqGraphArgs } from './ScalefacFreqGraph';
import { SubbandGraph, SubbandGraphArgs } from './SubbandGraph';
import { FrameBytes } from './FrameBytes';
import { MaindataBytes } from './MaindataBytes';
import { Hexdump, Hilight } from './Hexdump';

interface ChromeFile {
  arrayBuffer(): Promise<ArrayBuffer>;
}

// want to open-state embedded, but controlled-prop in React style forces this.
const Acordion = (props: { open?: boolean; /* onToggle?: (e: React.SyntheticEvent<HTMLElement, Event>) => void; */setOpen?: (open: boolean) => void; summary: React.ReactNode; children?: React.ReactNode; }) => {
  // const [open, setOpen] = React.useState(false);
  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  // return <details open={open} onToggle={e => setOpen(detailsRef.current!.open)} ref={detailsRef}>
  return <details open={props.open} onToggle={e => props.setOpen?.(detailsRef.current!.open)} ref={detailsRef}>
    <summary style={{ cursor: "pointer" }}>{props.summary}</summary>
    {props.open && props.children}
  </details>;
};

const SFGGranuleBox = (props: { parsed: MyParsed; selectedFrame: number | null; granule: number; which: ScalefacFreqGraphArgs["which"]; }) => {
  const data = (props.selectedFrame !== null && props.selectedFrame < props.parsed.parsedFrames.length) ? props.parsed.parsedFrames[props.selectedFrame] : null;
  const graphStyle = { width: "576px", height: "150px", margin: "2px 0" } as const;
  return <div style={{ display: "flex", flexDirection: "column", margin: "10px 5px" }}>
    {
      props.which === "stereoed"
        ? <ScalefacFreqGraph style={graphStyle} data={data} granule={props.granule} channel={null} which={props.which} />
        : <>
          <ScalefacFreqGraph style={graphStyle} data={data} granule={props.granule} channel={0} which={props.which} />
          {1 < props.parsed.sounds.length ? <ScalefacFreqGraph style={graphStyle} data={data} granule={props.granule} channel={1} which={props.which} /> : <></>}
        </>}
  </div>;
};
const SFGBox = (props: { parsed: MyParsed; selectedFrame: number | null; title: string; which: ScalefacFreqGraphArgs["which"]; open?: boolean; /* onToggle?: (e: React.SyntheticEvent<HTMLElement, Event>) => void; */setOpen?: (open: boolean) => void; }) => {
  return <Acordion summary={`${props.title}:`} open={props.open} setOpen={props.setOpen}>
    <div style={{ display: "flex", flexWrap: "wrap", margin: "-10px -5px" }}>
      <SFGGranuleBox parsed={props.parsed} selectedFrame={props.selectedFrame} granule={0} which={props.which} />
      <SFGGranuleBox parsed={props.parsed} selectedFrame={props.selectedFrame} granule={1} which={props.which} />
    </div>
  </Acordion>;
};

const SbGGranuleBox = (props: { parsed: MyParsed; selectedFrame: number | null; granule: number; which: SubbandGraphArgs["which"]; }) => {
  const data = (props.selectedFrame !== null && props.selectedFrame < props.parsed.parsedFrames.length) ? props.parsed.parsedFrames[props.selectedFrame] : null;
  const graphStyle = { width: "576px", height: "150px", margin: "2px 0" } as const;
  return <div style={{ display: "flex", flexDirection: "column", margin: "10px 5px" }}>
    <SubbandGraph style={graphStyle} data={data} granule={props.granule} which={props.which} />
  </div>;
};
const SbGBox = (props: { parsed: MyParsed; selectedFrame: number | null; title: string; which: SubbandGraphArgs["which"]; open?: boolean; /* onToggle?: (e: React.SyntheticEvent<HTMLElement, Event>) => void; */setOpen?: (open: boolean) => void; }) => {
  return <Acordion summary={`${props.title}:`} open={props.open} setOpen={props.setOpen}>
    <div style={{ display: "flex", flexWrap: "wrap", margin: "-10px -5px" }}>
      <SbGGranuleBox parsed={props.parsed} selectedFrame={props.selectedFrame} granule={0} which={props.which} />
      <SbGGranuleBox parsed={props.parsed} selectedFrame={props.selectedFrame} granule={1} which={props.which} />
    </div>
  </Acordion>;
};

function App() {
  const [bandmask, setBandmask] = React.useState(Array(32).fill(true));
  const [parsed, setParsed] = React.useState<MyParsed>({ sounds: [], parsedFrames: [], });
  const [parsedFrames, setParsedFrames] = React.useState<number | null>(null);
  const [parsedMaindatas, setParsedMaindatas] = React.useState<number | null>(null);
  const [abortable, setAbortable] = React.useState(false);
  const aborted = React.useRef(false); // to be rendered but must not changed between renders (to access older instance referenced by parsefile())
  const [selectedFrame, setSelectedFrame] = React.useState<number | null>(null);
  const [playing, setPlaying] = React.useState({ ctx: null as AudioContext | null, start: 0, pos: 0, period: 0 });
  const playAnimation = React.useRef<number | null>(null);
  const [autoFollow, setAutoFollow] = React.useState(false);
  const [frameBytesHilight, setFrameBytesHilight] = React.useState<Hilight | null>(null);
  const [maindataBytesHilight, setMaindataBytesHilight] = React.useState<Hilight | null>(null);

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

            // prepare for sub-ranges
            const ranges = iter.maindata.granule.flatMap((gr, gr_i) =>
              gr.channel.flatMap((ch, ch_i) => [
                {
                  granule: gr_i,
                  channel: ch_i,
                  part: "scalefac" as const,
                  size: ch.part2_length / 8,
                },
                {
                  granule: gr_i,
                  channel: ch_i,
                  part: "huffman" as const,
                  size: ch.part3_length / 8,
                }
              ]));
            mainsize -= iter.maindata.ancillary_nbits;

            // then, insert usage from there.
            for (; 0 < mainsize; i++) {
              const thatParsedFrame = parsing.parsedFrames[i];
              // XXX: what if data including extra bytes after frame?
              let offset = start !== null ? start : thatParsedFrame.frame.head_side_size;
              for (const range of ranges) {
                const availThatFrame = thatParsedFrame.frame.totalsize - offset;
                const size = Math.min(range.size, availThatFrame);
                if (size < 1 / 8) {
                  // note: part2_length===0 but part3_length!==0 in the wild. (scalefac 0 just hit)
                  continue;
                }

                parsing.parsedFrames[i].framerefs.push({
                  main_i: iter.i,
                  maindata: iter.maindata,
                  granule: range.granule,
                  channel: range.channel,
                  part: range.part,
                  offset,
                  size,
                });
                offset += size;
                mainsize -= size;
                range.size -= size;
              }
              while (0 < ranges.length && ranges[0].size < 1 / 8) {
                ranges.shift();
              }

              start = null;
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

  const [freqinvOpened, setFreqinvOpened] = React.useState(false);
  const [hysynthOpened, setHysynthOpened] = React.useState(false);
  const [antialiasOpened, setAntialiasOpened] = React.useState(false);
  const [stereoOpened, setStereoOpened] = React.useState(false);
  const [reorderOpened, setReorderOpened] = React.useState(false);
  const [requantizeOpened, setRequantizeOpened] = React.useState(false);
  const [maindataOpened, setMaindataOpened] = React.useState(false);
  const [frameOpened, setFrameOpened] = React.useState(false);
  const setAllOpen = (open: boolean) => {
    [
      setFreqinvOpened,
      setHysynthOpened,
      setAntialiasOpened,
      setStereoOpened,
      setReorderOpened,
      setRequantizeOpened,
      setMaindataOpened,
      setFrameOpened,
    ].forEach(fn => fn(open));
  };

  const hilight: [number, number] | undefined = selectedFrame === null ? undefined : [selectedFrame * 1152, selectedFrame * 1152 + 1152];
  const fileChooserRef = React.useRef<HTMLInputElement>(null);

  return (
    <Dropbox onFileDrop={parse}>
      <div style={{ width: "100%", background: "#ccc", color: "#000", padding: "0px 2em", boxSizing: "border-box" }}>
        <p>Drop a MP3 file into here, or <button onClick={_ => fileChooserRef.current?.click()}>specify a MP3 file</button><input type="file" style={{ display: "none" }} onChange={e => { (e.currentTarget.files?.[0] as File & ChromeFile | undefined)?.arrayBuffer().then(parse); e.currentTarget.value = ""; }} ref={fileChooserRef} /></p>
        <p>{<button style={{ display: abortable ? "inline" : "none" }} onClick={() => { aborted.current = true; }}>abort</button>}{parsedFrames === null ? "info shown here" : parsedMaindatas === null ? `${parsedFrames}...` : `${parsedFrames} / ${parsedMaindatas}`}</p>
        <p>{(() => {
          const firstFrame = parsed.parsedFrames[0];
          if (!firstFrame) {
            return '';
          }
          const hdr = firstFrame.frame.header;
          return <>{sampling_frequencies[hdr.sampling_frequency]} Hz {hdr.mode === 3 ? 1 : 2} ch</>;
        })()}</p>
        <div>
          <p>Final output:</p>
          <p><Wavebar style={{ width: "100%", height: 100 }} barHeight={60} zoomWidth={300} data={parsed.sounds} zoomingPos={(autoFollow && playing.ctx) ? playing.pos / playing.period : null} hilight={hilight} /></p>
        </div>
        <p><button onClick={e => setAllOpen(true)}>Open all</button><button onClick={e => setAllOpen(false)}>Close all</button></p>
        <SbGBox parsed={parsed} selectedFrame={selectedFrame} title="FreqInverted" which="freqinved" open={freqinvOpened} setOpen={setFreqinvOpened} />
        {/* TODO: prevsound for hybridsynth */}
        <SbGBox parsed={parsed} selectedFrame={selectedFrame} title="HybridSynthed" which="hysynthed_timedom" open={hysynthOpened} setOpen={setHysynthOpened} />
        <SbGBox parsed={parsed} selectedFrame={selectedFrame} title="Antialiased" which="antialiased" open={antialiasOpened} setOpen={setAntialiasOpened} />
        <SFGBox parsed={parsed} selectedFrame={selectedFrame} title="Stereoed" which="stereoed" open={stereoOpened} setOpen={setStereoOpened} />
        <SFGBox parsed={parsed} selectedFrame={selectedFrame} title="Reordered (only short-windows)" which="reordered" open={reorderOpened} setOpen={setReorderOpened} />
        <SFGBox parsed={parsed} selectedFrame={selectedFrame} title="Requantized" which="requantized" open={requantizeOpened} setOpen={setRequantizeOpened} />
        <Acordion summary="Maindata in bytes:" open={maindataOpened} setOpen={setMaindataOpened}>
          <div style={{ width: "100%", display: "flex", flexDirection: "row" }}>
            <div style={{ width: "50%", height: "15em", overflow: "auto", border: "2px inset", boxSizing: "border-box" }}>
              <MaindataBytes
                sideinfo={selectedFrame === null || parsed.parsedFrames.length <= selectedFrame ? null : parsed.parsedFrames[selectedFrame].frame.sideinfo}
                maindata={selectedFrame === null || parsed.parsedFrames.length <= selectedFrame ? null : parsed.parsedFrames[selectedFrame].maindata || null}
                hiOffset={maindataBytesHilight ? maindataBytesHilight.offset : null}
                onClick={(offset, bits) => { bits && setMaindataBytesHilight({ offset, bits }); }} />
            </div>
            <div style={{ width: "50%", height: "15em", border: "2px inset", boxSizing: "border-box", overflow: "auto" }}>
              <Hexdump
                data={selectedFrame === null || parsed.parsedFrames.length <= selectedFrame || parsed.parsedFrames[selectedFrame].maindata === null ? new Uint8Array(0) : parsed.parsedFrames[selectedFrame].maindata!.main_data}
                hilight={maindataBytesHilight} />
            </div>
          </div>
        </Acordion>
        <Acordion summary="Frame header in bytes:" open={frameOpened} setOpen={setFrameOpened}>
          <div style={{ width: "100%", display: "flex", flexDirection: "row" }}>
            <div style={{ width: "50%", height: "15em", overflow: "auto", border: "2px inset", boxSizing: "border-box" }}>
              <FrameBytes
                parsedFrame={selectedFrame === null || parsed.parsedFrames.length <= selectedFrame ? null : parsed.parsedFrames[selectedFrame]}
                hiOffset={frameBytesHilight ? frameBytesHilight.offset : null}
                onClick={(offset, bits) => { bits && setFrameBytesHilight({ offset, bits }); }} />
            </div>
            <div style={{ width: "50%", height: "15em", border: "2px inset", boxSizing: "border-box", overflow: "auto" }}>
              <Hexdump
                data={selectedFrame === null || parsed.parsedFrames.length <= selectedFrame ? new Uint8Array(0) : parsed.parsedFrames[selectedFrame].frame.head_side_bytes}
                hilight={frameBytesHilight} />
            </div>
          </div>
        </Acordion>
        <div>
          <p>Frames:</p>
          <p><Framebar style={{ width: "100%", height: 60 }} barHeight={30} zoomWidth={300} data={parsed.parsedFrames} selectedFrame={selectedFrame} onSelectedFrame={fr => setSelectedFrame(fr /* || 0 */)} /></p>
        </div>
        <Checkband checks={bandmask} onChanged={setBandmask} />
        <p><button disabled={parsed.parsedFrames.length < 1} onClick={onDLSample}>download raw sample</button></p>
        <p><button disabled={parsed.parsedFrames.length < 1} onClick={onPlay}>play sample</button> <label><input type="checkbox" checked={autoFollow} onChange={e => setAutoFollow(e.target.checked)} />follow playing</label></p>
        <p style={{ overflow: "hidden", height: "3.5em" }}>{/* ...internals */}</p>
      </div>
    </Dropbox>
  );
};

// https://medium.com/@hokan_dev/react%E3%81%A7hmr%E3%81%99%E3%82%8B%E6%96%B9%E6%B3%95-aa3d851ce1b5
export default process.env.NODE_ENV === "development" ? hot(App) : App;
