import React from 'react';
import { Zoombar, ZoombarUserArgs } from './Zoombar';
import { MyParsed } from './types';

export type FramebarArgs = {
    data: Pick<MyParsed, 'frames' | 'framerefs'>;
    onSelectedFrame: (frame: number | null) => void;
} & ZoombarUserArgs<Pick<MyParsed, 'frames' | 'framerefs'>>;

export function Framebar({ data: pdata, onSelectedFrame, ...props }: FramebarArgs) {
    const [zoomingFrame, setZoomingFrame] = React.useState(false);
    const [selectingFrame, setSelectingFrame] = React.useState(false);
    const [selectedFrame, setSelectedFrame] = React.useState<number | null>(null);

    const onZoomFrame = (offset: number | null, pressed: boolean) => {
        if (!!offset !== zoomingFrame) {
            setZoomingFrame(!!offset);
        }
        if (pressed !== selectingFrame) {
            setSelectingFrame(pressed);
        }

        if (offset && selectingFrame) {
            const onew = 200;
            const pad = 20;
            const interval = onew + pad;
            const newFrame = Math.floor((pdata.frames.length - onew / interval) * offset + 0.5);
            if (newFrame !== selectedFrame) {
                setSelectedFrame(newFrame);
                onSelectedFrame(newFrame);
            }
        }
    };

    const drawFrame = (ctx: CanvasRenderingContext2D, width: number, height: number, data: typeof pdata, i: number) => {
        const frame = data.frames[i];
        const xscale = width / frame.totalsize;
        // whole (at last becomes empty)
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);
        // header
        ctx.fillStyle = "#cac";
        ctx.fillRect(0, 0, 4 * xscale, height);
        // sideinfo
        ctx.fillStyle = "#fdf";
        ctx.fillRect(4 * xscale, 0, (frame.head_side_size - 4) * xscale, height);
        // maindatas
        const rainbow = ["#afa", "#ffa", "#fca", "#faa", "#faf", "#aaf"]; // at most 3 is enough in spec, but more in the wild.
        for (const ref of data.framerefs[i]) {
            const nback = ref.main_i - i;
            const color_i = nback < 3 ? nback : (((nback - 3) % (rainbow.length - 3)) + 3);
            ctx.fillStyle = rainbow[color_i];
            ctx.fillRect(ref.offset * xscale, 0, ref.size * xscale, height);
        }
    };

    const drawWholeFrame = (ctx: CanvasRenderingContext2D, width: number, height: number, data: typeof pdata & { selectedFrame: typeof selectedFrame; }) => {
        ctx.fillStyle = "gray";
        ctx.fillRect(0, 0, width, height);

        // ctx.lineCap = "round";
        if (0 < data.frames.length) {
            if (data.frames.length < width) {
                // full
                // TODO: also visualize frame size (for VBR)
                const w = Math.min(width / data.frames.length, 200);
                data.frames.forEach((_frame, i) => { // eslint-disable @typescript/unused-variable
                    ctx.save();
                    ctx.translate(1 + i * w, 1);
                    drawFrame(ctx, w - 2, height - 2, data, i);
                    if (i === data.selectedFrame) {
                        ctx.strokeStyle = "red";
                        ctx.strokeRect(0, 0, w - 2, height - 2);
                    }
                    ctx.restore();
                });
            } else {
                // overview
                // TODO; color by max-far-ref?
            }
        }
    };

    const drawZoomFrame = (ctx: CanvasRenderingContext2D, offset: number, width: number, height: number, data: typeof pdata & { selectedFrame: typeof selectedFrame; }) => {
        ctx.fillStyle = "gray";
        ctx.fillRect(0.5, 0.5, width, height);

        const onew = 200;
        const pad = 20;
        const interval = onew + pad;
        const centerlx = (width - onew) / 2;

        // const from = offset * (parsed.frames.length - 1) - (1 - 220 / width) / 2;
        const hi = (data.frames.length - 1) * offset; // including fraction
        const to = Math.min(hi + 3, data.frames.length);
        for (let i_f = hi - 1; i_f < to; i_f++) {
            if (i_f < 0) {
                continue;
            }
            const i = Math.floor(i_f);
            ctx.save();
            ctx.translate((i - hi) * interval + centerlx, 20);
            drawFrame(ctx, 200, height - 25, data, i);
            ctx.fillStyle = "white";
            if (i === data.selectedFrame) {
                ctx.fillStyle = "red";
                ctx.strokeStyle = "red";
                ctx.strokeRect(0, 0, 200, height - 25);
            }
            ctx.font = "15px sans-serif";
            ctx.textBaseline = "top";
            ctx.fillText(`${i}: ${data.frames[i].offset}`, 0, -15);
            ctx.restore();
        }

        ctx.strokeStyle = "black";
        ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    };

    return (<Zoombar
        {...props}
        drawWhole={drawWholeFrame} drawZoom={drawZoomFrame}
        zooming={zoomingFrame} data={{ ...pdata, selectedFrame }}
        onZoom={onZoomFrame}
    />);
}
