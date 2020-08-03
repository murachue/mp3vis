import React from 'react';

export function Zoombar<T>({ width, height, barHeight, zoomWidth, drawWhole, drawZoom, onZoom, zooming, data, ...props }: {
    width: string | number;
    height: string | number;
    barHeight: number;
    zoomWidth: number;
    drawWhole: (ctx: CanvasRenderingContext2D, width: number, height: number, data: T) => void;
    drawZoom: (ctx: CanvasRenderingContext2D, offset: number, width: number, height: number, data: T) => void;
    onZoom?: (offset: number | null, pressed: boolean) => void,
    zooming: boolean;
    data: T;
} & JSX.IntrinsicElements["canvas"]) {
    const refCanvas = React.createRef<HTMLCanvasElement>();

    const [pointer, setPointer] = React.useState<{ pos: { x: number, y: number; }; pressed: boolean; }>({ pos: { x: 0, y: 0 }, pressed: false });

    const getOffset = (mox: number, cw: number) => Math.max(0, Math.min(mox, cw));

    React.useEffect(() => {
        const canvas = refCanvas.current;

        if (!canvas) {
            return;
        }

        // https://stackoverflow.com/a/10214971
        const cw = canvas.width = canvas.offsetWidth;
        const ch = canvas.height = canvas.offsetHeight;

        const ctx = canvas.getContext("2d")!;

        // seems not required...
        // ctx.clearRect(0, 0, cw, ch);

        ctx.save();
        ctx.translate(0, (ch - barHeight) / 2);
        ctx.beginPath();
        ctx.rect(0, 0, cw + 1, barHeight + 1);
        ctx.clip();
        drawWhole(ctx, cw, barHeight, data);
        ctx.restore();

        if (zooming) {
            const mx = getOffset(pointer.pos.x, cw);
            const wx = Math.max(0, Math.min(mx - zoomWidth / 2, cw - zoomWidth));

            ctx.save();
            ctx.translate(wx, 0);
            ctx.beginPath();
            ctx.rect(0, 0, zoomWidth + 1, ch + 1);
            ctx.clip();
            drawZoom(ctx, mx / cw, zoomWidth, ch, data);
            ctx.restore();
        }
    });

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
        const canvas = refCanvas.current;
        if (canvas) {
            const newPointer = { pos: getRelPos(e, canvas), pressed: pointer.pressed };
            setPointer(newPointer);
            onZoom?.(getOffset(newPointer.pos.x, canvas.offsetWidth) / canvas.offsetWidth, newPointer.pressed);
        }
    };

    const leave = (e: React.MouseEvent<HTMLCanvasElement>) => {
        // setMousepos(null);
        onZoom?.(null, false);
    };

    const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
        (e.target as Element).setPointerCapture(e.pointerId);

        const canvas = refCanvas.current;
        if (canvas) {
            const newPointer = { pos: getRelPos(e, canvas), pressed: true };
            setPointer(newPointer);
            onZoom?.(getOffset(newPointer.pos.x, canvas.offsetWidth) / canvas.offsetWidth, newPointer.pressed);
        }
    };

    const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
        (e.target as Element).releasePointerCapture(e.pointerId);

        const canvas = refCanvas.current;
        if (canvas) {
            const newPointer = { pos: getRelPos(e, canvas), pressed: false };
            setPointer(newPointer);
            onZoom?.(getOffset(newPointer.pos.x, canvas.offsetWidth) / canvas.offsetWidth, newPointer.pressed);
        }
    };

    return (<canvas
        {...props}
        width="1"
        height="1"
        ref={refCanvas}
        style={{ width, height }}
        onMouseOver={(e: React.MouseEvent<HTMLCanvasElement>) => { enterMove(e); props.onMouseOver?.(e); }}
        onMouseOut={(e: React.MouseEvent<HTMLCanvasElement>) => { leave(e); props.onMouseOut?.(e); }}
        onMouseMove={(e: React.MouseEvent<HTMLCanvasElement>) => { enterMove(e); props.onMouseMove?.(e); }}
        onPointerDown={(e: React.PointerEvent<HTMLCanvasElement>) => { down(e); props.onPointerDown?.(e); }}
        onPointerUp={(e: React.PointerEvent<HTMLCanvasElement>) => { up(e); props.onPointerUp?.(e); }}
    />);
}
