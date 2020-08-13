import React from 'react';
import { Zoombar, ZoombarUserArgs } from './Zoombar';
import { memoized } from './memoized';

export type WavebarArgs = {
    data: number[][];
    zoomingPos: number | null;
    hilight?: [number, number];
} & ZoombarUserArgs<number[][]>;

export function Wavebar({ data, zoomingPos, hilight, ...props }: WavebarArgs) {
    const peaksMemoRef = React.useRef();
    const [zoomingWave, setZoomingWave] = React.useState(false);

    const drawWholeWave = (ctx: CanvasRenderingContext2D, width: number, height: number, data: { points: number[][], hilight: [number, number] | undefined; }) => {
        ctx.fillStyle = "#222";
        ctx.globalAlpha = 1.0;
        ctx.fillRect(0, 0, width, height);

        if (data.points.length < 1) {
            return;
        }

        const peaks = memoized(peaksMemoRef, () => data.points.map(ch => (Array(width).fill(0) as number[]).map((_, i) => {
            const from = Math.floor(ch.length * i / width);
            const count = Math.max(1, Math.ceil(ch.length / width));
            const peak = ch.slice(from, from + count).reduce((prev, cur) => Math.max(prev, Math.abs(cur)), 0);
            return peak;
        })), [width, data]);

        const drawPeakRange = (color: string, peaks: number[]) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(0, peaks[0]);
            peaks.forEach((peak, x) => ctx.lineTo(x, height / 2 - height / 2 * peak));
            peaks.map((peak, x) => [peak, x]).reverse().forEach(([peak, x]) => ctx.lineTo(x, height / 2 + height / 2 * peak));
            ctx.closePath();
            ctx.fill();
        };
        // const drawPeakLine = (color: string, peaks: number[]) => {
        //     ctx.strokeStyle = color;
        //     ctx.beginPath();
        //     ctx.moveTo(0, peaks[0]);
        //     peaks.forEach((peak, x) => ctx.lineTo(x, height / 2 - height / 2 * peak));
        //     ctx.stroke();
        //     ctx.beginPath();
        //     ctx.moveTo(0, peaks[0]);
        //     peaks.forEach((peak, x) => ctx.lineTo(x, height / 2 + height / 2 * peak));
        //     ctx.stroke();
        // };

        if (data.hilight) {
            ctx.fillStyle = "#228";
            const scalex = width / data.points[0].length;
            ctx.fillRect(data.hilight[0] * scalex, 0, (data.hilight[1] - data.hilight[0]) * scalex, height);
        }

        ctx.globalAlpha = 0.5;

        drawPeakRange("#8f8", peaks[0]);
        // drawPeakLine("#4f4", peaks[0]);
        if (peaks[1]) {
            drawPeakRange("#88f", peaks[1]);
            // drawPeakLine("#44f", peaks[1]);
        }
    };

    const drawZoomWave = (ctx: CanvasRenderingContext2D, offset: number, width: number, height: number, data: { points: number[][], hilight: [number, number] | undefined; }) => {
        ctx.globalAlpha = 1.0;

        ctx.fillStyle = "#222";
        ctx.fillRect(0.5, 0.5, width, height);

        const from = Math.floor((data.points[0].length - width) * offset);

        if (data.hilight) {
            ctx.fillStyle = "#228";
            ctx.fillRect(data.hilight[0] - from, 0, data.hilight[1] - data.hilight[0], height);
        }

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
        drawWave("#8f8", data.points[0].slice(from, from + width));
        if (data.points[1]) {
            drawWave("#88f", data.points[1].slice(from, from + width));
        }

        ctx.strokeStyle = "white";
        ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    };

    return (<Zoombar
        {...props}
        zooming={data.length < 1 ? false : zoomingWave ? true : zoomingPos !== null ? zoomingPos : false}
        data={{ points: data, hilight }}
        drawWhole={drawWholeWave} drawZoom={drawZoomWave}
        onZoom={(_offset, pressed) => zoomingWave !== pressed && setZoomingWave(pressed)}
    />);
}
