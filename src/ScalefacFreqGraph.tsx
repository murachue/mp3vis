import React from 'react';
import { Canvas, CanvasUserArgs } from './Canvas';
import { sampling_frequencies, scalefactor_band_indices_long, scalefactor_band_indices_short } from './libmp3';
import { times, range } from 'lodash-es';
import { ParsedFrame } from './types';

type ScalefacFreqGraphArgs = {
    data: ParsedFrame | null;
} & CanvasUserArgs<ParsedFrame | null>;

export function ScalefacFreqGraph({ data, ...props }: ScalefacFreqGraphArgs) {
    const onDraw = (ctx: CanvasRenderingContext2D, data: ParsedFrame | null) => {
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
            const sflong = scalefactor_band_indices_long[sampfreq];
            const sfshort = scalefactor_band_indices_short[sampfreq];
            const drawLongTill = (till: number) => {
                ctx.globalAlpha = 0.2;
                for (const i of times(till)) {
                    const x = sflong[i];
                    line(x, 0, x, ch);
                }
            };
            const drawShortFrom = (from: number) => {
                for (const i of range(from, sfshort.length - 1)) {
                    for (const wi of times(3)) {
                        ctx.globalAlpha = wi === 0 ? 0.2 : 0.1;
                        const x = sfshort[i] * 3 + (sfshort[i + 1] - sfshort[i]) * wi;
                        line(x, 0, x, ch);
                    }
                }
            };

            ctx.strokeStyle = "black";

            ctx.globalAlpha = 0.2;
            line(0, ch / 2, cw, ch / 2);

            const sideinfo = data.frame.sideinfo.channel[0].granule[0];
            drawLongTill(sideinfo.block_type !== 2 ? sflong.length - 1 : sideinfo.switch_point ? 9 : 0);
            drawShortFrom(sideinfo.block_type !== 2 ? sfshort.length - 1 : sideinfo.switch_point ? 2 : 0);

            ctx.globalAlpha = 1;

            let sf_i = 0;
            for (const x of times(576)) {
                // if (scalefactor_band_indices[[44100,48000,32000][data?.maindata.]] <= x)
                ctx.strokeStyle = "red";
                line(x, ch / 2, x, (data.internal.requantized.granule[0].channel[0][x] + 1) * ch / 2);
            }
        }
    };

    return (<Canvas {...props} data={data} onDraw={onDraw} />);
}
