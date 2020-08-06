import React from 'react';
import { Canvas, CanvasUserArgs } from './Canvas';
import { sampling_frequencies, scalefactor_band_indices_long, scalefactor_band_indices_short } from './libmp3';
import { times, range } from 'lodash-es';
import { ParsedFrame } from './types';

type Data = ParsedFrame | null;

type ScalefacFreqGraphArgs = {
    data: Data;
} & CanvasUserArgs<Data>;

export function ScalefacFreqGraph({ data, ...props }: ScalefacFreqGraphArgs) {
    const onDraw = (ctx: CanvasRenderingContext2D, data: Data) => {
        ctx.fillStyle = "white";
        const cw = ctx.canvas.width;
        const ch = ctx.canvas.height;
        ctx.fillRect(0, 0, cw, ch);

        if (data?.internal?.requantized) {
            const sampfreq = sampling_frequencies[data.frame.header.sampling_frequency];
            const sflong = scalefactor_band_indices_long[sampfreq];
            const sfshort = scalefactor_band_indices_short[sampfreq];
            const drawLongTill = (till: number) => {
                ctx.globalAlpha = 0.2;
                for (const i of times(till)) {
                    const x = sflong[i];
                    ctx.beginPath();
                    ctx.moveTo(x + 0.5, 0);
                    ctx.lineTo(x + 0.5, ch);
                    ctx.stroke();
                }
            };
            const drawShortFrom = (from: number) => {
                for (const i of range(from, sfshort.length - 1)) {
                    for (const wi of times(3)) {
                        ctx.globalAlpha = wi === 2 ? 0.2 : 0.1;
                        const x = sfshort[i] * 3 + (sfshort[i + 1] - sfshort[i]) * wi;
                        ctx.beginPath();
                        ctx.moveTo(x + 0.5, 0);
                        ctx.lineTo(x + 0.5, ch);
                        ctx.stroke();
                    }
                }
            };

            ctx.strokeStyle = "black";

            const sideinfo = data.frame.sideinfo.channel[0].granule[0];
            drawLongTill(sideinfo.block_type !== 2 ? sflong.length - 1 : sideinfo.switch_point ? 9 : 0);
            drawShortFrom(sideinfo.block_type !== 2 ? sfshort.length - 1 : sideinfo.switch_point ? 2 : 0);

            ctx.globalAlpha = 1;

            let sf_i = 0;
            for (const x of times(576)) {
                // if (scalefactor_band_indices[[44100,48000,32000][data?.maindata.]] <= x)
                ctx.strokeStyle = "red";
                ctx.beginPath();
                ctx.moveTo(x + 0.5, ch);
                ctx.lineTo(x + 0.5, (1 - data.internal.requantized.granule[0].channel[0][x]) * ch);
                ctx.stroke();
            }
        }
    };

    return (<Canvas {...props} data={data} onDraw={onDraw} />);
}
