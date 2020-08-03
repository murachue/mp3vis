import React from 'react';
import { Canvas, CanvasUserArgs } from './Canvas';

type ScalefacFreqGraphArgs = {
    data: {};
} & CanvasUserArgs<{}>;

export function ScalefacFreqGraph({ data, ...props }: ScalefacFreqGraphArgs) {
    const onDraw = (ctx: CanvasRenderingContext2D/* , data: {} */) => {
        //
    };
    return (<Canvas {...props} data={data} onDraw={onDraw} />);
}
