import React from 'react';
import { Canvas, CanvasUserArgs } from './Canvas';
import { sampling_frequencies, scalefactor_band_indices_long, scalefactor_band_indices_short, requantizeSample, requantizeMultiplier, powReal } from './libmp3';
import { times, range } from 'lodash-es';
import { ParsedFrame } from './types';

export type ScalefacFreqGraphArgs = {
    data: ParsedFrame | null;
    granule: number;
    channel: number | null;
    which: "requantized" | "reordered" | "stereoed";
} & CanvasUserArgs<ParsedFrame | null>;

export function ScalefacFreqGraph({ data, granule, channel, which, ...props }: ScalefacFreqGraphArgs) {
    const onDraw = (ctx: CanvasRenderingContext2D, data: ParsedFrame | null) => {
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = "white";
        const cw = ctx.canvas.width;
        const ch = ctx.canvas.height;
        ctx.fillRect(0, 0, cw, ch);

        if (!data?.internal?.requantized) {
            return;
        }

        const hline = (x1: number, y: number, x2: number) => {
            const w = cw / 576;
            ctx.beginPath();
            ctx.moveTo(x1 * w + 0.5, y + 0.5);
            ctx.lineTo(x2 * w + 0.5, y + 0.5);
            ctx.stroke();
        };
        const vbar = (xbar: number, y1: number, y2: number) => {
            const [ymin, ymax] = [y1, y2].sort();
            const w = cw / 576;
            ctx.fillRect(w * xbar, ymin, w, ymax - ymin);
        };

        const sampfreq = sampling_frequencies[data.frame.header.sampling_frequency];
        const sfblong = scalefactor_band_indices_long[sampfreq];
        const sfbshort = scalefactor_band_indices_short[sampfreq];

        const sideinfo_gr_ch = data.frame.sideinfo.channel[channel || 0].granule[granule];
        const maindata_gr_ch = data.maindata!.granule[granule].channel[channel || 0];

        const scale_step = sideinfo_gr_ch.scalefac_scale ? 1 : 0.5;
        const global_gain = sideinfo_gr_ch.global_gain;

        const onepixelStep = (zoom: number, scalefac: number, subblock_gain: number) =>
            Math.max(1, powReal((1 / zoom) / requantizeMultiplier(scale_step, scalefac, global_gain, subblock_gain), 3 / 4)); // reverse-requantize 1/zoom

        const drawLongGridTill = (till: number) => {
            ctx.fillStyle = "#ddd";
            for (const i of times(till)) {
                vbar(sfblong[i], 0, ch);
            }

            if (which === "stereoed") {
                return;
            }

            const scalefac_l = maindata_gr_ch.scalefac.scalefac_l?.concat([0]); // [0] for very last non-encoded sfband.
            const cy = ch / 2;

            ctx.strokeStyle = "#eee";
            for (const i of times(till)) {
                const scalefac = scalefac_l![i];
                const x = sfblong[i];
                const x2 = sfblong[i + 1];
                const step = onepixelStep(1, scalefac, 0);
                for (const y of range(0, 8192, step)) {
                    const ry = Math.floor(requantizeSample(y, scale_step, scalefac, global_gain, 0));
                    if (cy < ry) {
                        break;
                    }
                    hline(x, cy - ry, x2);
                    hline(x, cy + ry, x2);
                }

                const ry = Math.floor(requantizeSample(8191, scale_step, scalefac, global_gain, 0));
                hline(x, cy - ry, x2);
                hline(x, cy + ry, x2);
            }
        };
        const drawShortGridFrom = (from: number) => {
            const scalefac_s = maindata_gr_ch.scalefac.scalefac_s?.concat([[0, 0, 0]]); // [[0,0,0]] for very last non-encoded sfband.;
            const cy = ch / 2;

            const subgrid = which === "requantized";
            for (const i of range(from, sfbshort.length - 1)) {
                for (const wi of times(3)) {
                    if (!subgrid && wi !== 0) {
                        continue;
                    }

                    ctx.fillStyle = wi === 0 ? "#ddd" : "#eee";
                    const x = sfbshort[i] * 3 + (sfbshort[i + 1] - sfbshort[i]) * wi;
                    vbar(x, 0, ch);

                    if (!subgrid) {
                        continue;
                    }

                    ctx.strokeStyle = "#eee";
                    const scalefac = scalefac_s![i][wi];
                    const subblock_gain = sideinfo_gr_ch.subblock_gain![wi];
                    const x2 = sfbshort[i] * 3 + (sfbshort[i + 1] - sfbshort[i]) * (wi + 1);
                    const step = onepixelStep(1, scalefac, subblock_gain);
                    for (const y of range(0, 8192, step)) {
                        const ry = Math.floor(requantizeSample(y, scale_step, scalefac, global_gain, subblock_gain));
                        if (cy < ry) {
                            break;
                        }
                        hline(x, cy - ry, x2);
                        hline(x, cy + ry, x2);
                    }
                    const ry = Math.floor(requantizeSample(8191, scale_step, scalefac, global_gain, subblock_gain));
                    hline(x, cy - ry, x2);
                    hline(x, cy + ry, x2);
                }
            }
        };

        const blockStyle = (ch: number) => {
            const sideinfo_gr_ch = data.frame.sideinfo.channel[ch].granule[granule];
            return sideinfo_gr_ch.block_type !== 2 ? "long" : sideinfo_gr_ch.switch_point ? "mixed" : "short";
        };
        if (which !== "stereoed" || data.frame.sideinfo.channel.length < 2 || blockStyle(0) === blockStyle(1)) {
            const style = blockStyle(channel || 0);
            drawLongGridTill({ long: sfblong.length - 1, mixed: 8, short: 0 }[style]);
            drawShortGridFrom({ long: sfbshort.length - 1, mixed: 3, short: 0 }[style]);
        };

        if (sideinfo_gr_ch.block_type === 2 && sideinfo_gr_ch.switch_point) {
            ctx.fillStyle = "#fdd";
            vbar(36, 0, ch);
        }

        ctx.strokeStyle = "#ddd";
        hline(0, ch / 2, cw);

        const chans = data.internal![which].granule[granule].channel;
        if (channel !== null) {
            ctx.fillStyle = "red";
            const samples = chans[channel].samples;
            for (const x of times(576)) {
                vbar(x, ch / 2, (samples[x] + 1) * ch / 2);
            }
        } else {
            const colors = chans.length < 2 ? ["red"] : ["#0c0", "#66f"];
            ctx.globalAlpha = 0.5;
            for (const ch_i in chans) {
                ctx.fillStyle = colors[ch_i];
                const samples = chans[ch_i].samples;
                for (const x of times(576)) {
                    vbar(x, ch / 2, (samples[x] + 1) * ch / 2);
                }
            };
        }
    };

    return (<Canvas {...props} data={data} onDraw={onDraw} />);
}
