import React from 'react';
import { Canvas, CanvasUserArgs } from './Canvas';
import { scalefactor_band_indices_long, scalefactor_band_indices_short } from './libmp3';
import { times } from 'lodash-es';
import { ParsedFrame } from './types';

type Data = ParsedFrame | null;

type ScalefacFreqGraphArgs = {
    data: Data;
} & CanvasUserArgs<Data>;

export function ScalefacFreqGraph({ data, ...props }: ScalefacFreqGraphArgs) {
    const onDraw = (ctx: CanvasRenderingContext2D, data: Data) => {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        if (data?.internal?.requantized) {
            let sf_i = 0;
            for (const x of times(576)) {
                // if (scalefactor_band_indices[[44100,48000,32000][data?.maindata.]] <= x)
            }
        }
    };

    return (<Canvas {...props} data={data} onDraw={onDraw} />);
}
