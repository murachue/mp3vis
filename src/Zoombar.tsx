import React from 'react';
import { Canvas, CanvasUserArgs } from './Canvas';

export type ZoombarUserArgs<T> = Omit<ZoombarArgs<T>, 'zooming' | 'data' | 'drawWhole' | 'drawZoom' | 'onZoom'>;
type ZoombarArgs<T> = {
    width: string | number;
    height: string | number;
    barHeight: number;
    zoomWidth: number;
    drawWhole: (ctx: CanvasRenderingContext2D, width: number, height: number, data: T) => void;
    drawZoom: (ctx: CanvasRenderingContext2D, offset: number, width: number, height: number, data: T) => void;
    onZoom?: (offset: number | null, pressed: boolean) => void,
    zooming: boolean;
    data: T;
} & CanvasUserArgs<T>;

export function Zoombar<T>({ width, height, barHeight, zoomWidth, drawWhole, drawZoom, onZoom, zooming, data, ...props }: ZoombarArgs<T>) {
    const [pointer, setPointer] = React.useState<{ pos: { x: number, y: number; }; pressed: boolean; }>({ pos: { x: 0, y: 0 }, pressed: false });

    const getOffset = (mox: number, cw: number) => Math.max(0, Math.min(mox, cw));

    const onDraw = (ctx: CanvasRenderingContext2D, data: { data: T, pointer: typeof pointer; }) => {
        const cw = ctx.canvas.width, ch = ctx.canvas.height;

        ctx.clearRect(0, 0, cw, ch);

        ctx.save();
        ctx.translate(0, (ch - barHeight) / 2);
        ctx.beginPath();
        ctx.rect(0, 0, cw + 1, barHeight + 1);
        ctx.clip();
        drawWhole(ctx, cw, barHeight, data.data);
        ctx.restore();

        if (zooming) {
            const mx = getOffset(pointer.pos.x, cw);
            const wx = Math.max(0, Math.min(mx - zoomWidth / 2, cw - zoomWidth));

            ctx.save();
            ctx.translate(wx, 0);
            ctx.beginPath();
            ctx.rect(0, 0, zoomWidth + 1, ch + 1);
            ctx.clip();
            drawZoom(ctx, mx / cw, zoomWidth, ch, data.data);
            ctx.restore();
        }
    };

    // const enterMove = function (e: React.MouseEvent<HTMLDivElement>) {
    //     const canvas = refCanvas.current;
    //     const container = canvas?.parentElement?.parentElement;
    //     if (container) {
    //         setMousepos([e.clientX - container.offsetLeft, e.clientY]);
    //     }
    // };

    // const leave = function (e: React.MouseEvent<HTMLDivElement>) {
    //     setMousepos(null);
    // };

    // return (<div style={{ width, position: "relative" }}>
    //     <div style={{ width: "100%", height: 40 }} onMouseOver={enterMove} onMouseOut={leave} onMouseMove={enterMove}>
    //         <canvas width="1" height={30} ref={refCanvas} style={{ width: "100%", height: 30, position: "relative", top: "50%", transform: "translateY(-50%)" }} />
    //     </div>
    //     <div style={{ display: mousepos ? "block" : "none", width: 200, height: 40, position: "absolute", left: mousepos ? mousepos[0] : 0, top: 0, border: "1px solid red", background: "white" }}></div>
    // </div>);

    const getRelPos = (e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => ({ x: e.clientX - canvas.offsetLeft, y: e.clientY - canvas.offsetTop });

    const enterMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = e.currentTarget;
        const newPointer = { pos: getRelPos(e, canvas), pressed: pointer.pressed };
        setPointer(newPointer);
        onZoom?.(getOffset(newPointer.pos.x, canvas.offsetWidth) / canvas.offsetWidth, newPointer.pressed);
    };

    const leave = (e: React.MouseEvent<HTMLCanvasElement>) => {
        // setMousepos(null);
        onZoom?.(null, false);
    };

    const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);

        const canvas = e.currentTarget;
        const newPointer = { pos: getRelPos(e, canvas), pressed: true };
        setPointer(newPointer);
        onZoom?.(getOffset(newPointer.pos.x, canvas.offsetWidth) / canvas.offsetWidth, newPointer.pressed);
    };

    const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
        e.currentTarget.releasePointerCapture(e.pointerId);

        const canvas = e.currentTarget;
        const newPointer = { pos: getRelPos(e, canvas), pressed: false };
        setPointer(newPointer);
        onZoom?.(getOffset(newPointer.pos.x, canvas.offsetWidth) / canvas.offsetWidth, newPointer.pressed);
    };

    return (<Canvas
        {...props}
        data={{ data, pointer }}
        onDraw={onDraw}
        style={{ width, height }}
        onMouseOver={(e: React.MouseEvent<HTMLCanvasElement>) => { enterMove(e); props.onMouseOver?.(e); }}
        onMouseOut={(e: React.MouseEvent<HTMLCanvasElement>) => { leave(e); props.onMouseOut?.(e); }}
        onMouseMove={(e: React.MouseEvent<HTMLCanvasElement>) => { enterMove(e); props.onMouseMove?.(e); }}
        onPointerDown={(e: React.PointerEvent<HTMLCanvasElement>) => { down(e); props.onPointerDown?.(e); }}
        onPointerUp={(e: React.PointerEvent<HTMLCanvasElement>) => { up(e); props.onPointerUp?.(e); }}
    />);
}
