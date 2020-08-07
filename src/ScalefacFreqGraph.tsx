import React from 'react';
import { Canvas, CanvasUserArgs } from './Canvas';
import { sampling_frequencies, scalefactor_band_indices_long, scalefactor_band_indices_short, requantizeSample } from './libmp3';
import { times, range } from 'lodash-es';
import { ParsedFrame } from './types';

type ScalefacFreqGraphArgs = {
    data: ParsedFrame | null;
} & CanvasUserArgs<ParsedFrame | null>;

export function ScalefacFreqGraph({ data, ...props }: ScalefacFreqGraphArgs) {
    const onDraw = (ctx: CanvasRenderingContext2D, data: ParsedFrame | null) => {
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = "white";
        const cw = ctx.canvas.width;
        const ch = ctx.canvas.height;
        ctx.fillRect(0, 0, cw, ch);

        if (data?.internal?.requantized) {
            const line = (x1: number, y1: number, x2: number, y2: number) => {
                ctx.beginPath();
                ctx.moveTo(x1 + 0.5, y1 + 0.5);
                ctx.lineTo(x2 + 0.5, y2 + 0.5);
                ctx.stroke();
            };

            const sampfreq = sampling_frequencies[data.frame.header.sampling_frequency];
            const sfblong = scalefactor_band_indices_long[sampfreq];
            const sfbshort = scalefactor_band_indices_short[sampfreq];
            const drawLongTill = (till: number) => {
                const sideinfo_gr_ch = data.frame.sideinfo.channel[0].granule[0];
                const scale_step = sideinfo_gr_ch.scalefac_scale ? 1 : 0.5;
                const global_gain = sideinfo_gr_ch.global_gain;
                const scalefac_l = data.maindata!.granule[0].channel[0].scalefac.scalefac_l?.concat([0]); // [0] for very last non-encoded sfband.
                const cy = ch / 2;
                for (const i of times(till)) {
                    const x = sfblong[i];
                    ctx.strokeStyle = "#ddd";
                    line(x, 0, x, ch);

                    ctx.strokeStyle = "#eee";
                    const scalefac = scalefac_l![i];
                    const x2 = sfblong[i + 1];
                    let ory: number | null = null;
                    for (const y of range(8191, -1, -128)) {
                        const ry = Math.floor(requantizeSample(y, scale_step, scalefac, global_gain, 0));
                        if (ry < 1) {
                            break;
                        }
                        if (ry === ory) {
                            continue;
                        }
                        ory = ry;
                        line(x, cy - ry, x2, cy - ry);
                        line(x, cy + ry, x2, cy + ry);
                    }
                }
            };
            const drawShortFrom = (from: number) => {
                const sideinfo_gr_ch = data.frame.sideinfo.channel[0].granule[0];
                const scale_step = sideinfo_gr_ch.scalefac_scale ? 1 : 0.5;
                const global_gain = sideinfo_gr_ch.global_gain;
                const scalefac_s = data.maindata!.granule[0].channel[0].scalefac.scalefac_s?.concat([[0, 0, 0]]); // [[0,0,0]] for very last non-encoded sfband.;
                const cy = ch / 2;
                for (const i of range(from, sfbshort.length - 1)) {
                    for (const wi of times(3)) {
                        ctx.strokeStyle = wi === 0 ? "#ddd" : "#eee";
                        const x = sfbshort[i] * 3 + (sfbshort[i + 1] - sfbshort[i]) * wi;
                        line(x, 0, x, ch);

                        ctx.strokeStyle = "#eee";
                        const scalefac = scalefac_s![i][wi];
                        const subblock_gain = sideinfo_gr_ch.subblock_gain![wi];
                        const x2 = sfbshort[i] * 3 + (sfbshort[i + 1] - sfbshort[i]) * (wi + 1);
                        let ory: number | null = null;
                        for (const y of range(8191, -1, -128)) {
                            const ry = Math.floor(requantizeSample(y, scale_step, scalefac, global_gain, subblock_gain));
                            if (ry < 1) {
                                break;
                            }
                            if (ry === ory) {
                                continue;
                            }
                            ory = ry;
                            line(x, cy - ry, x2, cy - ry);
                            line(x, cy + ry, x2, cy + ry);
                        }
                    }
                }
            };

            ctx.strokeStyle = "#ddd";
            line(0, ch / 2, cw, ch / 2);

            const sideinfo = data.frame.sideinfo.channel[0].granule[0];
            drawLongTill(sideinfo.block_type !== 2 ? sfblong.length - 1 : sideinfo.switch_point ? 9 : 0);
            drawShortFrom(sideinfo.block_type !== 2 ? sfbshort.length - 1 : sideinfo.switch_point ? 2 : 0);

            if (sideinfo.block_type === 2 && sideinfo.switch_point) {
                ctx.strokeStyle = "#fdd";
                line(36, 0, 36, ch);
            }

            let sf_i = 0;
            for (const x of times(576)) {
                // if (scalefactor_band_indices[[44100,48000,32000][data?.maindata.]] <= x)
                ctx.strokeStyle = "red";
                line(x, ch / 2, x, (data.internal.requantized.granule[0].channel[0].samples[x] + 1) * ch / 2);
            }
        }
    };

    return (<Canvas {...props} data={data} onDraw={onDraw} />);
}
