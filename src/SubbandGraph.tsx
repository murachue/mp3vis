import React from 'react';
import { Canvas, CanvasUserArgs } from './Canvas';
import { times, range } from 'lodash-es';
import { ParsedFrame } from './types';

export type SubbandGraphArgs = {
    data: ParsedFrame | null;
    granule: number;
    which: "antialiased" | "hysynthed_timedom" | "freqinved";
} & CanvasUserArgs<ParsedFrame | null>;

export function SubbandGraph({ data, granule, which, ...props }: SubbandGraphArgs) {
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

        // grid
        ctx.fillStyle = "#ddd";
        for (const x of range(0, 576, 18)) {
            vbar(x, 0, ch);
        }

        ctx.strokeStyle = "#ddd";
        hline(0, ch / 2, cw);

        const getChans = () => {
            if (which === "antialiased") {
                return data.internal![which].granule[granule].channel.map(ch => ch.samples);
            }

            const rawChans = data.internal![which].granule[granule].channel;
            return rawChans.map(ch => ch.subband.flat(1));
        };
        const chans: number[][] = getChans();
        const colors = chans.length < 2 ? ["red"] : ["#0c0", "#66f"];
        ctx.globalAlpha = 0.5;
        for (const ch_i in chans) {
            ctx.fillStyle = colors[ch_i];
            const samples = chans[ch_i];
            for (const x of times(576)) {
                vbar(x, ch / 2, (samples[x] + 1) * ch / 2);
            }
        };
    };

    return (<Canvas {...props} data={data} onDraw={onDraw} />);
}
